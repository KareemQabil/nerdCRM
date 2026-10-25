package com.ioeti.commercial.service;

import com.axelor.apps.base.AxelorException;
import com.axelor.apps.base.db.repo.PriceListLineRepository;
import com.axelor.apps.base.db.repo.SequenceRepository;
import com.axelor.apps.base.service.administration.SequenceService;
import com.axelor.apps.base.service.app.AppBaseService;
import com.axelor.apps.sale.db.SaleOrder;
import com.axelor.apps.sale.db.SaleOrderLine;
import com.axelor.apps.sale.db.repo.SaleOrderLineRepository;
import com.axelor.apps.sale.db.repo.SaleOrderRepository;
import com.axelor.apps.sale.service.saleorder.status.SaleOrderFinalizeService;
import com.axelor.auth.db.Role;
import com.axelor.auth.db.User;
import com.axelor.db.JPA;
import com.axelor.db.Query;
import com.fasterxml.jackson.databind.JsonNode;
import com.google.inject.Inject;
import com.google.inject.persist.Transactional;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.db.PolicyVersion;
import com.ioeti.core.policy.PolicyService;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.stream.Stream;

/**
 * D-11 (signed 2026-10-25): quotation approval is tiered. The owners set the tiers per business line
 * ({@code sales.quote-approval}: up to a discount %, optionally up to a value in the company currency, and who
 * approves) and how long a finalized quotation stays valid ({@code sales.quote-validity}). The quotation's discount
 * and value select the first tier that covers them; a tier approved by {@code NONE} finalizes at once, otherwise a
 * holder of the tier's role, never the requester, approves. Finalizing is the native AOS finalize. The rep sends
 * the quotation themselves and records it; the platform does not e-mail it.
 */
public class QuoteApprovalService {

  public static final String APPROVAL = "sales.quote-approval";
  public static final String VALIDITY = "sales.quote-validity";
  public static final String NONE = "NONE";
  static final BigDecimal HUNDRED = new BigDecimal("100");

  /** The tier a quotation falls in under the policy version in force. */
  public record Tier(String approver, BigDecimal discountPercent, BigDecimal amount, Long policyVersionId) {}

  private final PolicyService policies;
  private final SaleOrderFinalizeService finalizeService;
  private final AppBaseService appBaseService;
  private final SequenceService sequences;

  @Inject
  public QuoteApprovalService(PolicyService policies, SaleOrderFinalizeService finalizeService, AppBaseService appBaseService,
      SequenceService sequences) {
    this.policies = policies;
    this.finalizeService = finalizeService;
    this.appBaseService = appBaseService;
    this.sequences = sequences;
  }

  /** The Axelor role that holds an approver code: SALES_MANAGER → ioeti-sales-manager, GM → ioeti-gm. */
  public static String roleOf(String approver) {
    return "ioeti-" + approver.toLowerCase(Locale.ROOT).replace('_', '-');
  }

  /** Whether a person holds an approver's role, directly or through their group. */
  public static boolean holds(User user, String approver) {
    if (user == null || approver == null || NONE.equals(approver)) return false;
    String role = roleOf(approver);
    Stream<Role> mine = user.getRoles() == null ? Stream.empty() : user.getRoles().stream();
    Stream<Role> group = user.getGroup() == null || user.getGroup().getRoles() == null ? Stream.empty() : user.getGroup().getRoles().stream();
    return Stream.concat(mine, group).anyMatch(r -> role.equals(r.getName()));
  }

  /** Active people holding an approver's role directly or through their group (who gets the approval notice). */
  public static List<User> holders(String approver) {
    return Query.of(User.class).filter("(self.blocked IS NULL OR self.blocked = false) AND EXISTS (SELECT r FROM Role r WHERE r.name = ?1"
        + " AND (r MEMBER OF self.roles OR (self.group IS NOT NULL AND r MEMBER OF self.group.roles)))", roleOf(approver)).order("id").fetch(50);
  }

  /**
   * The discount the quotation gives against its lines' unit prices, in %. Each line's discounted price is taken from its
   * native discount (percent or fixed amount off the unit price, as AOS computes it), not from the stored discounted price,
   * which reads as 0 before the line is computed and would count as a 100% discount.
   */
  public static BigDecimal discountPercent(SaleOrder quote) {
    BigDecimal list = BigDecimal.ZERO;
    BigDecimal sold = BigDecimal.ZERO;
    for (SaleOrderLine line : quote.getSaleOrderLineList() == null ? List.<SaleOrderLine>of() : quote.getSaleOrderLineList()) {
      if (!Objects.equals(line.getTypeSelect(), SaleOrderLineRepository.TYPE_NORMAL) || line.getQty() == null || line.getPrice() == null) continue;
      list = list.add(line.getQty().multiply(line.getPrice()));
      sold = sold.add(line.getQty().multiply(discounted(line)));
    }
    if (list.signum() <= 0) return BigDecimal.ZERO;
    return BigDecimal.ONE.subtract(sold.divide(list, 8, RoundingMode.HALF_UP)).multiply(HUNDRED).setScale(2, RoundingMode.HALF_UP).max(BigDecimal.ZERO);
  }

  /** A line's unit price after its native discount (never below 0). */
  static BigDecimal discounted(SaleOrderLine line) {
    BigDecimal price = line.getPrice();
    BigDecimal amount = line.getDiscountAmount() == null ? BigDecimal.ZERO : line.getDiscountAmount();
    Integer type = line.getDiscountTypeSelect();
    if (Integer.valueOf(PriceListLineRepository.AMOUNT_TYPE_PERCENT).equals(type)) {
      return price.multiply(BigDecimal.ONE.subtract(amount.divide(HUNDRED, 10, RoundingMode.HALF_UP))).max(BigDecimal.ZERO);
    }
    if (Integer.valueOf(PriceListLineRepository.AMOUNT_TYPE_FIXED).equals(type)) return price.subtract(amount).max(BigDecimal.ZERO);
    return price;
  }

  /**
   * The first tier (smallest first) that covers the quotation's discount and value; refused when the policy is not set
   * or when no tier covers it (the owners have to add one).
   */
  public Tier tier(SaleOrder quote, LocalDate on) {
    PolicyService.Applied applied = policies.require(APPROVAL, TaxPolicyBridge.scopeOf(quote), on);
    BigDecimal discount = discountPercent(quote);
    BigDecimal amount = quote.getCompanyExTaxTotal() == null ? quote.getExTaxTotal() : quote.getCompanyExTaxTotal();
    for (JsonNode tier : applied.value().path("tiers")) {
      boolean discountOk = discount.compareTo(new BigDecimal(tier.path("maxDiscountPercent").asText("0"))) <= 0;
      JsonNode max = tier.path("maxAmount");
      boolean amountOk = max.isMissingNode() || max.isNull() || max.asText().isBlank() || amount.compareTo(new BigDecimal(max.asText())) <= 0;
      if (discountOk && amountOk) return new Tier(tier.path("approver").asText(), discount, amount, applied.versionId());
    }
    throw new ApiException(422, "OUTSIDE_APPROVAL_TIERS",
        "No approval tier covers this discount and value; the policy owners have to add one.", null);
  }

  /**
   * Checks a draft quotation can be finalized: lines, the owners' current tax, the validity policy, and the company's
   * quotation number sequence. Returns the validity policy in force.
   */
  public PolicyService.Applied checkFinalizable(SaleOrder quote, LocalDate on, TaxPolicyBridge taxes) {
    if (!Integer.valueOf(SaleOrderRepository.STATUS_DRAFT_QUOTATION).equals(quote.getStatusSelect())) {
      throw new ApiException(422, "QUOTE_NOT_DRAFT", "Only a draft quotation can be finalized.", null);
    }
    if (quote.getSaleOrderLineList() == null || quote.getSaleOrderLineList().isEmpty()) {
      throw new ApiException(422, "NO_LINES", "Add at least one line before finalizing.", null);
    }
    PolicyService.Applied tax = taxes.inForce(quote, on).orElse(null);
    if (quote.getIoetiTaxPolicy() == null || tax == null) {
      throw new ApiException(422, "POLICY_NOT_SET", "The policy 'finance.tax' is not set for this quotation; a policy owner sets it under Policies.", null);
    }
    if (!tax.versionId().equals(quote.getIoetiTaxPolicy().getId())) {
      throw new ApiException(422, "TAX_OUTDATED", "The tax policy changed since this quotation was computed; apply the current tax first.", null);
    }
    PolicyService.Applied validity = policies.require(VALIDITY, TaxPolicyBridge.scopeOf(quote), on);
    // the native finalize numbers the quotation from the company's sale order sequence; say so instead of a native error
    if (quote.getCompany() == null || !sequences.hasSequence(SequenceRepository.SALES_ORDER, quote.getCompany())) {
      throw new ApiException(422, "SALES_SEQUENCE_MISSING",
          "This company has no quotation number sequence in Axelor yet; an administrator sets it up.", null);
    }
    return validity;
  }

  /**
   * Finalizes natively under a tier: the quotation records the approval policy version, the tier, the discount it was
   * judged on, who approved and when, and its end of validity from the validity policy.
   */
  @Transactional(rollbackOn = {Exception.class})
  public SaleOrder finalizeUnder(SaleOrder quote, Tier tier, PolicyService.Applied validity, User approver, LocalDate on)
      throws AxelorException {
    quote.setIoetiApprovalPolicy(JPA.find(PolicyVersion.class, tier.policyVersionId()));
    quote.setIoetiApprovalTier(tier.approver());
    quote.setIoetiDiscountPercent(tier.discountPercent());
    quote.setIoetiApprovedBy(approver);
    quote.setIoetiApprovedAt(LocalDateTime.now());
    quote.setIoetiValidityPolicy(JPA.find(PolicyVersion.class, validity.versionId()));
    quote.setEndOfValidityDate(on.plusDays(validity.value().path("days").asInt()));
    finalizeService.finalizeQuotation(quote);
    return quote;
  }

  /** The rep records that they sent the finalized quotation to the client themselves (no e-mail from here). */
  @Transactional(rollbackOn = {Exception.class})
  public SaleOrder markSent(SaleOrder quote, User me, String note, LocalDate today) {
    if (!Integer.valueOf(SaleOrderRepository.STATUS_FINALIZED_QUOTATION).equals(quote.getStatusSelect())) {
      throw new ApiException(422, "QUOTE_NOT_FINALIZED", "Only a finalized quotation is sent.", null);
    }
    if (quote.getEndOfValidityDate() != null && quote.getEndOfValidityDate().isBefore(today)) {
      throw new ApiException(422, "QUOTE_EXPIRED", "This quotation is no longer valid.", null);
    }
    String how = note == null ? "" : note.strip();
    if (how.length() > 300) throw ApiException.invalidField("via", "TOO_LONG", "Keep the note under 300 characters.");
    quote.setIoetiSentBy(me);
    quote.setIoetiSentAt(LocalDateTime.now());
    quote.setIoetiSentNote(how.isEmpty() ? null : how);
    return JPA.save(quote);
  }

  public LocalDate today(SaleOrder quote) {
    return appBaseService.getTodayDate(quote.getCompany());
  }
}
