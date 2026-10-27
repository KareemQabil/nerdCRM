package com.ioeti.training.service;

import com.axelor.apps.account.db.Invoice;
import com.axelor.apps.account.db.InvoicePayment;
import com.axelor.apps.account.db.repo.InvoicePaymentRepository;
import com.axelor.apps.account.db.repo.InvoiceRepository;
import com.axelor.apps.base.db.Partner;
import com.axelor.auth.AuthUtils;
import com.axelor.db.JPA;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.fasterxml.jackson.databind.JsonNode;
import com.google.inject.Inject;
import com.google.inject.persist.Transactional;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.Locks;
import com.ioeti.core.db.PolicyVersion;
import com.ioeti.core.notify.Notifier;
import com.ioeti.core.policy.PolicyService;
import com.ioeti.training.db.TrainingCertificate;
import com.ioeti.training.db.TrainingCohort;
import com.ioeti.training.db.TrainingEnrollment;
import com.ioeti.training.db.TrainingFee;
import com.ioeti.training.db.TrainingRefund;
import com.ioeti.training.db.repo.TrainingCertificateRepository;
import com.ioeti.training.db.repo.TrainingCohortRepository;
import com.ioeti.training.db.repo.TrainingEnrollmentRepository;
import com.ioeti.training.db.repo.TrainingRefundRepository;
import jakarta.persistence.LockModeType;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * D-03 (signed 2026-10-25), cancellations and refunds. The refund is computed from the cancellation policy
 * ({@code training.cancellation}, per business line) and from what was actually paid for the enrolment; finance
 * approves it and the money is refunded only by a credit note issued in Axelor accounting (D-06).
 *
 * <p>Training fees are invoiced through finance's own flow. Finance links the enrolment to its issued invoice (with the
 * enrolment's share, including tax): without that link nothing was invoiced for the enrolment and no refund can be
 * requested ({@code INVOICE_REQUIRED}). What was paid is the money received on the invoice (validated payments, never
 * credit notes), shared in proportion to the enrolment's part.
 *
 * <p>Approving needs the credit note: finance issues it with the existing D-06 service ({@code POST
 * /ws/ioeti/finance/invoices/{id}/credit-notes}, for the refund's share of the invoice) and approves the refund with it;
 * the refund checks that it is a ventilated credit note of the same invoice, for that share, not used by another refund.
 * A refund is never marked refunded without its credit note.
 */
public class RefundService {

  public static final String POLICY = "training.cancellation";
  static final Set<Integer> RECEIVED = Set.of(InvoicePaymentRepository.TYPE_PAYMENT, InvoicePaymentRepository.TYPE_ADVANCEPAYMENT);

  private final PolicyService policies;
  private final TrainingService training;

  @Inject
  public RefundService(PolicyService policies, TrainingService training) {
    this.policies = policies;
    this.training = training;
  }

  // --- what a cancellation would refund -----------------------------------------------------------------------

  /**
   * The refund a cancellation gives. {@code outcome}: REFUND, NO_REFUND_DUE (the policy's share is 0), NOT_INVOICED (no
   * invoice is linked), NOTHING_PAID, POLICY_NOT_SET, START_DATE_MISSING, ALREADY_REQUESTED.
   */
  public record Plan(String outcome, int cause, TrainingFee fee, BigDecimal paid, Long daysBeforeStart, BigDecimal percent,
      BigDecimal amount, BigDecimal creditPercent, PolicyService.Applied policy) {

    public boolean refunds() {
      return "REFUND".equals(outcome);
    }

    /** A cancellation cannot go ahead: money was paid but the rule to refund it is missing. */
    void enforce() {
      switch (outcome) {
        case "POLICY_NOT_SET" -> throw new ApiException(422, "POLICY_NOT_SET", cause == TrainingRefundRepository.CAUSE_COHORT_CANCELLED
            ? "The policy 'training.cancellation' does not say what is refunded when we cancel a cohort; a policy owner sets it under Policies."
            : "The policy 'training.cancellation' is not set; a policy owner sets it under Policies.", null);
        case "START_DATE_MISSING" -> throw new ApiException(422, "START_DATE_MISSING",
            "The cohort has no start date, so the refund cannot be computed from the cancellation policy.", null);
        default -> { }
      }
    }
  }

  public static TrainingFee fee(TrainingEnrollment enrollment) {
    return Query.of(TrainingFee.class).filter("self.enrollment = ?1", enrollment).fetchOne();
  }

  public static TrainingRefund refund(TrainingEnrollment enrollment) {
    return Query.of(TrainingRefund.class).filter("self.enrollment = ?1", enrollment).fetchOne();
  }

  /** The refund for cancelling this enrolment on that date, for that cause, under the policy in force then. */
  public Plan plan(TrainingEnrollment enrollment, int cause, LocalDate on) {
    TrainingCohort cohort = enrollment.getCohort();
    Long days = cohort.getStartDate() == null ? null : TrainingRules.daysBeforeStart(cohort.getStartDate(), on);
    BigDecimal zero = BigDecimal.ZERO.setScale(2);
    if (refund(enrollment) != null) return new Plan("ALREADY_REQUESTED", cause, fee(enrollment), zero, days, null, zero, zero, null);
    TrainingFee fee = fee(enrollment);
    if (fee == null) return new Plan("NOT_INVOICED", cause, null, zero, days, null, zero, zero, null);
    Invoice invoice = fee.getInvoice();
    BigDecimal paid = TrainingRules.paidShare(received(invoice), fee.getAmount(), invoice.getInTaxTotal());
    if (paid.signum() <= 0) return new Plan("NOTHING_PAID", cause, fee, zero, days, null, zero, zero, null);
    String line = cohort.getCourse().getBusinessLine() == null ? null : cohort.getCourse().getBusinessLine().getCode();
    Optional<PolicyService.Applied> applied = policies.current(POLICY, line, on);
    if (applied.isEmpty()) return new Plan("POLICY_NOT_SET", cause, fee, paid, days, null, zero, zero, null);
    JsonNode value = applied.get().value();
    BigDecimal percent;
    if (cause == TrainingRefundRepository.CAUSE_COHORT_CANCELLED) {
      if (!value.hasNonNull("cohortCancelledRefundPercent")) return new Plan("POLICY_NOT_SET", cause, fee, paid, days, null, zero, zero, applied.get());
      percent = value.get("cohortCancelledRefundPercent").decimalValue().setScale(2, RoundingMode.HALF_UP);
    } else {
      if (days == null) return new Plan("START_DATE_MISSING", cause, fee, paid, null, null, zero, zero, applied.get());
      percent = TrainingRules.refundPercent(TrainingRules.steps(value), days);
    }
    BigDecimal amount = TrainingRules.refundAmount(paid, percent);
    BigDecimal credit = TrainingRules.creditPercent(amount, invoice.getInTaxTotal());
    return new Plan(credit.signum() > 0 ? "REFUND" : "NO_REFUND_DUE", cause, fee, paid, days, percent, amount, credit, applied.get());
  }

  /** Money received on an invoice: validated payments (and advance payments), never credit notes. */
  public static BigDecimal received(Invoice invoice) {
    BigDecimal total = BigDecimal.ZERO;
    if (invoice.getInvoicePaymentList() == null) return total;
    for (InvoicePayment p : invoice.getInvoicePaymentList()) {
      if (Integer.valueOf(InvoicePaymentRepository.STATUS_VALIDATED).equals(p.getStatusSelect()) && RECEIVED.contains(p.getTypeSelect())) {
        total = total.add(p.getAmount());
      }
    }
    return total;
  }

  /** An issued customer invoice: ventilated, of a client sale. */
  public static boolean issued(Invoice invoice) {
    return invoice.getOperationTypeSelect() == InvoiceRepository.OPERATION_TYPE_CLIENT_SALE
        && invoice.getStatusSelect() == InvoiceRepository.STATUS_VENTILATED;
  }

  // --- cancelling -----------------------------------------------------------------------------------------------

  /**
   * Cancels an enrolment. When it was paid, the refund the policy gives is requested from finance in the same step;
   * when money was paid but the policy is missing, nothing is cancelled (POLICY_NOT_SET).
   */
  @Transactional(rollbackOn = {Exception.class})
  public TrainingEnrollment cancelEnrollment(TrainingEnrollment enrollment, LocalDate today) {
    if (Integer.valueOf(TrainingEnrollmentRepository.STATUS_CANCELLED).equals(enrollment.getStatusSelect())) {
      throw new ApiException(422, "ALREADY_CANCELLED", "This enrolment is already cancelled.", null);
    }
    Plan plan = plan(enrollment, TrainingRefundRepository.CAUSE_ENROLMENT_CANCELLED, today);
    plan.enforce();
    training.cancel(enrollment, today);
    if (plan.refunds()) request(enrollment, plan);
    return enrollment;
  }

  /**
   * Cancels a cohort: every trainee still enrolled is cancelled, and each paid enrolment gets the refund the policy
   * gives when we cancel. A cohort with issued certificates is not cancelled.
   */
  @Transactional(rollbackOn = {Exception.class})
  public List<TrainingRefund> cancelCohort(TrainingCohort cohort, LocalDate today) {
    JPA.em().lock(cohort, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    if (Integer.valueOf(TrainingCohortRepository.STATUS_CANCELLED).equals(cohort.getStatusSelect())) {
      throw new ApiException(422, "COHORT_STATE", "This cohort is already cancelled.", null);
    }
    if (certificates(cohort) > 0) {
      throw new ApiException(422, "CERTIFICATES_ISSUED", "Certificates were issued for this cohort; revoke them before cancelling it.", null);
    }
    List<TrainingEnrollment> active = TrainingService.active(cohort);
    List<Plan> plans = new ArrayList<>();
    for (TrainingEnrollment e : active) {
      Plan plan = plan(e, TrainingRefundRepository.CAUSE_COHORT_CANCELLED, today);
      plan.enforce();
      plans.add(plan);
    }
    List<TrainingRefund> refunds = new ArrayList<>();
    for (int i = 0; i < active.size(); i++) {
      TrainingEnrollment e = active.get(i);
      e.setStatusSelect(TrainingEnrollmentRepository.STATUS_CANCELLED);
      e.setWaitlistPosition(null);
      e.setCancelledOn(today);
      JPA.save(e);
      if (plans.get(i).refunds()) refunds.add(request(e, plans.get(i)));
    }
    cohort.setStatusSelect(TrainingCohortRepository.STATUS_CANCELLED);
    JPA.save(cohort);
    return refunds;
  }

  /**
   * The refund as it stands: for an active enrolment, what cancelling it today would give; for a cancelled one, what
   * its cancellation gave (on the day it was cancelled, for the cohort's cancellation if the cohort was cancelled).
   */
  public Plan current(TrainingEnrollment enrollment, LocalDate today) {
    if (!Integer.valueOf(TrainingEnrollmentRepository.STATUS_CANCELLED).equals(enrollment.getStatusSelect())) {
      return plan(enrollment, TrainingRefundRepository.CAUSE_ENROLMENT_CANCELLED, today);
    }
    int cause = Integer.valueOf(TrainingCohortRepository.STATUS_CANCELLED).equals(enrollment.getCohort().getStatusSelect())
        ? TrainingRefundRepository.CAUSE_COHORT_CANCELLED : TrainingRefundRepository.CAUSE_ENROLMENT_CANCELLED;
    return plan(enrollment, cause, cancelledOn(enrollment));
  }

  /** What cancelling the cohort today would do: per active enrolment, the refund. */
  public List<Plan> cohortPlans(TrainingCohort cohort, LocalDate today) {
    return TrainingService.active(cohort).stream().map(e -> plan(e, TrainingRefundRepository.CAUSE_COHORT_CANCELLED, today)).toList();
  }

  public static long certificates(TrainingCohort cohort) {
    return Query.of(TrainingCertificate.class).filter("self.enrollment.cohort = ?1 AND self.statusSelect = ?2", cohort,
        TrainingCertificateRepository.STATUS_ISSUED).count();
  }

  /**
   * Requests the refund of an enrolment cancelled before finance linked its invoice: computed as on the day it was
   * cancelled, under the policy in force then.
   */
  @Transactional(rollbackOn = {Exception.class})
  public TrainingRefund requestLater(TrainingEnrollment enrollment) {
    Locks.parent(enrollment.getCohort());
    if (!Integer.valueOf(TrainingEnrollmentRepository.STATUS_CANCELLED).equals(enrollment.getStatusSelect())) {
      throw new ApiException(422, "NOT_CANCELLED", "A refund is requested for a cancelled enrolment; cancel it first.", null);
    }
    Plan plan = current(enrollment, CompletionService.today());
    switch (plan.outcome()) {
      case "ALREADY_REQUESTED" -> throw new ApiException(409, "ALREADY_REQUESTED", "A refund was already requested for this enrolment.", null);
      case "NOT_INVOICED" -> throw new ApiException(422, "INVOICE_REQUIRED",
          "No invoice is linked to this enrolment, so nothing can be refunded; finance links the enrolment to its invoice first.", null);
      case "NOTHING_PAID" -> throw new ApiException(422, "NOTHING_PAID", "Nothing was received on this enrolment's invoice, so there is nothing to refund.", null);
      case "NO_REFUND_DUE" -> throw new ApiException(422, "NO_REFUND_DUE", "The cancellation policy gives no refund for this cancellation.", null);
      default -> plan.enforce();
    }
    return request(enrollment, plan);
  }

  /** The day an enrolment was cancelled; enrolments cancelled before that was recorded use their last change. */
  public static LocalDate cancelledOn(TrainingEnrollment enrollment) {
    if (enrollment.getCancelledOn() != null) return enrollment.getCancelledOn();
    LocalDateTime changed = enrollment.getUpdatedOn() != null ? enrollment.getUpdatedOn() : enrollment.getCreatedOn();
    return changed == null ? CompletionService.today() : changed.toLocalDate();
  }

  private TrainingRefund request(TrainingEnrollment enrollment, Plan plan) {
    TrainingRefund refund = new TrainingRefund();
    refund.setEnrollment(enrollment);
    refund.setInvoice(plan.fee().getInvoice());
    refund.setCauseSelect(plan.cause());
    refund.setPaidAmount(plan.paid());
    refund.setDaysBeforeStart(plan.daysBeforeStart() == null ? null : Math.toIntExact(plan.daysBeforeStart()));
    refund.setRefundPercent(plan.percent());
    refund.setAmount(plan.amount());
    refund.setCreditPercent(plan.creditPercent());
    refund.setPolicyVersion(JPA.find(PolicyVersion.class, plan.policy().versionId()));
    refund.setStatusSelect(TrainingRefundRepository.STATUS_REQUESTED);
    refund.setRequestedBy(AuthUtils.getUser());
    refund.setRequestedAt(LocalDateTime.now());
    TrainingRefund saved = JPA.save(refund);
    // finance must act: the person who linked the invoice is told (in-app only)
    Beans.get(Notifier.class).notify(plan.fee().getLinkedBy(), "TRAINING_REFUND_REQUESTED", "TRAINING_REFUND", saved.getId(),
        "Training refund to approve: cohort " + enrollment.getCohort().getCode());
    return saved;
  }

  // --- linking the invoice ------------------------------------------------------------------------------------

  /**
   * Links an enrolment to the issued customer invoice that bills it, with the enrolment's share including tax. The
   * invoice must be the trainee's or the sponsoring client's, and the shares linked to one invoice never exceed it.
   */
  @Transactional(rollbackOn = {Exception.class})
  public TrainingFee link(TrainingEnrollment enrollment, Invoice invoice, BigDecimal rawAmount) {
    Locks.key("ioeti-training-fee-invoice", String.valueOf(invoice.getId()));
    Locks.key("ioeti-training-fee-enrollment", String.valueOf(enrollment.getId()));
    if (fee(enrollment) != null) throw new ApiException(409, "ALREADY_LINKED", "This enrolment is already linked to an invoice.", null);
    if (!issued(invoice)) throw ApiException.invalidField("invoiceId", "INVOICE_STATE", "Choose an issued customer invoice.");
    Partner partner = invoice.getPartner();
    if (partner == null || !(partner.equals(enrollment.getTrainee()) || partner.equals(enrollment.getClient()))) {
      throw ApiException.invalidField("invoiceId", "PARTNER_MISMATCH", "Choose an invoice of the trainee or of the sponsoring account.");
    }
    BigDecimal open = unlinked(invoice);
    BigDecimal amount = rawAmount == null ? open : rawAmount;
    if (amount.signum() <= 0 || amount.stripTrailingZeros().scale() > 2 || amount.compareTo(open) > 0) {
      throw ApiException.invalidField("amount", "RANGE", "The amount must be above 0 and at most the part of the invoice not linked yet, with up to 2 decimals.");
    }
    TrainingFee fee = new TrainingFee();
    fee.setEnrollment(enrollment);
    fee.setInvoice(invoice);
    fee.setAmount(amount.setScale(2, RoundingMode.UNNECESSARY));
    fee.setLinkedBy(AuthUtils.getUser());
    fee.setLinkedAt(LocalDateTime.now());
    return JPA.save(fee);
  }

  /** The part of an invoice (including tax) no enrolment is linked to yet. */
  public static BigDecimal unlinked(Invoice invoice) {
    BigDecimal linked = Query.of(TrainingFee.class).filter("self.invoice = ?1", invoice).fetch().stream()
        .map(TrainingFee::getAmount).reduce(BigDecimal.ZERO, BigDecimal::add);
    BigDecimal total = invoice.getInTaxTotal() == null ? BigDecimal.ZERO : invoice.getInTaxTotal();
    return total.subtract(linked).max(BigDecimal.ZERO).setScale(2, RoundingMode.DOWN);
  }

  /** Removes a wrong link, as long as no refund was requested on it. */
  @Transactional(rollbackOn = {Exception.class})
  public void unlink(TrainingFee fee) {
    if (refund(fee.getEnrollment()) != null) {
      throw new ApiException(422, "REFUND_EXISTS", "A refund was requested on this link; it stays as the refund's record.", null);
    }
    JPA.remove(fee);
  }

  // --- finance's decision -------------------------------------------------------------------------------------

  /**
   * Approves a requested refund with the credit note finance issued for it: a ventilated credit note of the same
   * invoice, for the refund's share, not used by another refund. The refund records it and what it credited.
   */
  @Transactional(rollbackOn = {Exception.class})
  public TrainingRefund approve(TrainingRefund refund, Invoice creditNote) {
    requested(refund);
    Locks.key("ioeti-training-credit-note", String.valueOf(creditNote.getId()));
    boolean ofInvoice = creditNote.getOperationTypeSelect() == InvoiceRepository.OPERATION_TYPE_CLIENT_REFUND
        && creditNote.getStatusSelect() == InvoiceRepository.STATUS_VENTILATED
        && refund.getInvoice().equals(creditNote.getOriginalInvoice());
    if (!ofInvoice) {
      throw ApiException.invalidField("creditInvoiceId", "CREDIT_NOTE_MISMATCH", "Choose a credit note issued against this refund's invoice.");
    }
    if (!TrainingRules.creditMatches(creditNote.getInTaxTotal(), refund.getInvoice().getInTaxTotal(), refund.getCreditPercent())) {
      throw ApiException.invalidField("creditInvoiceId", "CREDIT_NOTE_MISMATCH",
          "The credit note's amount does not match this refund's share of the invoice.");
    }
    if (Query.of(TrainingRefund.class).filter("self.creditNote = ?1 AND self.id <> ?2", creditNote, refund.getId()).count() > 0) {
      throw new ApiException(409, "CREDIT_NOTE_USED", "This credit note already settles another refund.", null);
    }
    refund.setCreditNote(creditNote);
    refund.setCreditedAmount(creditNote.getInTaxTotal().setScale(2, RoundingMode.HALF_UP));
    return decide(refund, TrainingRefundRepository.STATUS_CREDITED, "TRAINING_REFUND_CREDITED");
  }

  /** Rejects a requested refund with the reason; nothing is credited. */
  @Transactional(rollbackOn = {Exception.class})
  public TrainingRefund reject(TrainingRefund refund, String rawReason) {
    requested(refund);
    String reason = rawReason == null ? "" : rawReason.strip();
    if (reason.isEmpty()) throw ApiException.invalidField("reason", "REQUIRED", "Say why the refund is rejected.");
    if (reason.length() > 500) throw ApiException.invalidField("reason", "TOO_LONG", "Keep the reason under 500 characters.");
    refund.setRejectReason(reason);
    return decide(refund, TrainingRefundRepository.STATUS_REJECTED, "TRAINING_REFUND_REJECTED");
  }

  private static void requested(TrainingRefund refund) {
    if (!Integer.valueOf(TrainingRefundRepository.STATUS_REQUESTED).equals(refund.getStatusSelect())) {
      throw new ApiException(422, "REFUND_STATE", "This refund was already decided.", null);
    }
  }

  private static TrainingRefund decide(TrainingRefund refund, int status, String notice) {
    refund.setStatusSelect(status);
    refund.setDecidedBy(AuthUtils.getUser());
    refund.setDecidedAt(LocalDateTime.now());
    TrainingRefund saved = JPA.save(refund);
    Beans.get(Notifier.class).notify(refund.getRequestedBy(), notice, "TRAINING_REFUND", saved.getId(),
        "Training refund decided: cohort " + refund.getEnrollment().getCohort().getCode());
    return saved;
  }
}
