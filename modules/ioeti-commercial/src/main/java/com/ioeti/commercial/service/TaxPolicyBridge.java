package com.ioeti.commercial.service;

import com.axelor.apps.account.db.Tax;
import com.axelor.apps.account.db.TaxLine;
import com.axelor.apps.account.db.TaxType;
import com.axelor.apps.account.db.repo.TaxTypeRepository;
import com.axelor.apps.base.AxelorException;
import com.axelor.apps.crm.db.Opportunity;
import com.axelor.apps.sale.db.SaleOrder;
import com.axelor.apps.sale.db.SaleOrderLine;
import com.axelor.apps.sale.db.repo.SaleOrderLineRepository;
import com.axelor.apps.sale.service.saleorder.SaleOrderComputeService;
import com.axelor.apps.sale.service.saleorderline.SaleOrderLineComputeService;
import com.axelor.db.JPA;
import com.axelor.db.Query;
import com.fasterxml.jackson.databind.JsonNode;
import com.google.inject.Inject;
import com.ioeti.commercial.db.PolicyTaxLine;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.db.PolicyVersion;
import com.ioeti.core.policy.PolicyService;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;

/**
 * D-06 (signed 2026-10-25): the tax on quotations comes from the {@code finance.tax} policy the owners set,
 * per business line or as a default, never from code. Each applied policy version becomes one native AOS
 * tax version (TaxLine) with the same rate and dates, under a native Tax per scope ({@code IOETI-<line>} or
 * {@code IOETI-DEFAULT}), so the native quotation, invoice and accounting services compute and post it.
 * Without a policy in force the quotation carries no tax and is marked as such; nothing is guessed.
 */
public class TaxPolicyBridge {

  public static final String KEY = "finance.tax";

  private final PolicyService policies;
  private final SaleOrderLineComputeService lineCompute;
  private final SaleOrderComputeService orderCompute;

  @Inject
  public TaxPolicyBridge(PolicyService policies, SaleOrderLineComputeService lineCompute, SaleOrderComputeService orderCompute) {
    this.policies = policies;
    this.lineCompute = lineCompute;
    this.orderCompute = orderCompute;
  }

  /** The business line code a quotation's tax is looked up for (its opportunity's line), or null for the default. */
  public static String scopeOf(SaleOrder quote) {
    Opportunity opportunity = quote.getOpportunity();
    return opportunity == null || opportunity.getIoetiBusinessLine() == null ? null : opportunity.getIoetiBusinessLine().getCode();
  }

  /** The policy version in force for this quotation on a date, if the owners set one. */
  public Optional<PolicyService.Applied> inForce(SaleOrder quote, LocalDate on) {
    return policies.current(KEY, scopeOf(quote), on);
  }

  /**
   * Applies the tax in force on {@code on} to every normal line of a draft quotation and recomputes it with
   * the native services; without a policy the lines carry no tax. The quotation records the version used.
   * Runs inside the caller's transaction.
   */
  public void apply(SaleOrder quote, LocalDate on) throws AxelorException {
    Optional<PolicyService.Applied> applied = inForce(quote, on);
    TaxLine taxLine = applied.map(this::taxLine).orElse(null);
    if (quote.getSaleOrderLineList() != null) {
      for (SaleOrderLine line : quote.getSaleOrderLineList()) {
        if (!Objects.equals(line.getTypeSelect(), SaleOrderLineRepository.TYPE_NORMAL)) continue;
        Set<TaxLine> taxes = new HashSet<>();
        if (taxLine != null) taxes.add(taxLine);
        line.setTaxLineSet(taxes);
        lineCompute.computeValues(quote, line);
      }
    }
    quote.setIoetiTaxPolicy(applied.map(a -> JPA.find(PolicyVersion.class, a.versionId())).orElse(null));
    orderCompute.computeSaleOrder(quote);
  }

  /**
   * The native tax version for a policy version, created on first use. Its dates follow the policy: from the
   * version's effective date to the day before the next version of the same scope (open-ended otherwise).
   */
  public TaxLine taxLine(PolicyService.Applied applied) {
    PolicyVersion version = JPA.find(PolicyVersion.class, applied.versionId());
    PolicyTaxLine link = Query.of(PolicyTaxLine.class).filter("self.policyVersion = ?1", version).fetchOne();
    JsonNode value = applied.value();
    Tax tax = tax(applied.scope(), value);
    TaxLine line;
    if (link == null) {
      line = new TaxLine();
      line.setTax(tax);
      line.setStartDate(version.getEffectiveFrom());
      line.setValue(new BigDecimal(value.get("ratePercent").asText()));
      line = JPA.save(line);
      link = new PolicyTaxLine();
      link.setPolicyVersion(version);
      link.setTaxLine(line);
      JPA.save(link);
    } else {
      line = link.getTaxLine();
    }
    line.setEndDate(endOf(version));
    tax.setActiveTaxLine(line);
    return line;
  }

  /** The day before the next version of the same key and scope takes effect, or null when none follows. */
  private static LocalDate endOf(PolicyVersion version) {
    String scope = version.getScopeKey();
    List<PolicyVersion> later = (scope == null
        ? Query.of(PolicyVersion.class).filter("self.policyKey = ?1 AND self.scopeKey IS NULL AND self.effectiveFrom > ?2", KEY, version.getEffectiveFrom())
        : Query.of(PolicyVersion.class).filter("self.policyKey = ?1 AND self.scopeKey = ?2 AND self.effectiveFrom > ?3", KEY, scope, version.getEffectiveFrom()))
        .order("effectiveFrom").fetch(1);
    return later.isEmpty() ? null : later.get(0).getEffectiveFrom().minusDays(1);
  }

  /** The native tax for a scope, named after the policy's latest value; created on first use. */
  private static Tax tax(String scope, JsonNode value) {
    String code = "IOETI-" + (scope == null ? "DEFAULT" : scope);
    Tax tax = Query.of(Tax.class).filter("self.code = ?1", code).fetchOne();
    if (tax == null) {
      tax = new Tax();
      tax.setCode(code);
    }
    String type = value.path("type").asText("");
    if (!type.equals("VAT") && !type.equals("OTHER")) {
      // a version recorded before the type was part of the policy: the owners have to set it again
      throw new ApiException(422, "POLICY_NOT_SET", "The policy 'finance.tax' needs its tax type; a policy owner sets it under Policies.", null);
    }
    tax.setName(value.get("name").asText());
    tax.setTaxType(taxType(type));
    return JPA.save(tax);
  }

  private static TaxType taxType(String type) {
    String code = "IOETI-" + type;
    TaxType taxType = Query.of(TaxType.class).filter("self.code = ?1", code).fetchOne();
    if (taxType != null) return taxType;
    taxType = new TaxType();
    taxType.setCode(code);
    taxType.setName("VAT".equals(type) ? "VAT" : "Other tax");
    taxType.setTypeSelect("VAT".equals(type) ? TaxTypeRepository.TYPE_VAT : TaxTypeRepository.TYPE_OTHER);
    return JPA.save(taxType);
  }
}
