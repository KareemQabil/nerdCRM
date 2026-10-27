package com.ioeti.training.rest;

import com.axelor.apps.account.db.Invoice;
import com.axelor.apps.account.db.repo.InvoiceRepository;
import com.axelor.auth.db.User;
import com.axelor.db.JPA;
import com.axelor.db.JpaSecurity;
import com.axelor.inject.Beans;
import com.axelor.rpc.filter.Filter;
import com.axelor.rpc.filter.JPQLFilter;
import com.axelor.utils.api.ResponseConstructor;
import com.axelor.utils.api.SecurityCheck;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.IoetiEndpoint;
import com.ioeti.core.api.RecordAccess;
import com.ioeti.training.db.TrainingCohort;
import com.ioeti.training.db.TrainingEnrollment;
import com.ioeti.training.db.TrainingFee;
import com.ioeti.training.db.TrainingRefund;
import com.ioeti.training.db.repo.TrainingRefundRepository;
import com.ioeti.training.service.CompletionService;
import com.ioeti.training.service.RefundService;
import com.ioeti.training.service.RefundService.Plan;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * D-03 (signed 2026-10-25), money side of training: finance links an enrolment to the issued invoice that bills it,
 * the coordinator sees what a cancellation would refund before confirming it, and finance approves a requested refund
 * with the credit note it issued through the D-06 finance service, or rejects it. Money is never marked as refunded
 * without that credit note.
 */
@Path("/ioeti/training")
@Produces(MediaType.APPLICATION_JSON)
public class TrainingRefundRestController {

  static final Map<String, Integer> STATUSES = Map.of("REQUESTED", TrainingRefundRepository.STATUS_REQUESTED,
      "CREDITED", TrainingRefundRepository.STATUS_CREDITED, "REJECTED", TrainingRefundRepository.STATUS_REJECTED);

  // --- invoice link -------------------------------------------------------------------------------------------

  @GET
  @Path("/enrollments/{id}/invoices")
  @Operation(summary = "Issued invoices of the trainee or the sponsoring account that can be linked to the enrolment", tags = {"IOETI training"})
  @IoetiEndpoint
  public Response invoices(@PathParam("id") Long id) {
    TrainingEnrollment enrollment = RecordAccess.readable(TrainingEnrollment.class, id);
    new SecurityCheck().readAccess(Invoice.class).check();
    String partners = enrollment.getTrainee().getId() + (enrollment.getClient() == null ? "" : "," + enrollment.getClient().getId());
    Filter of = new JPQLFilter("self.operationTypeSelect = " + InvoiceRepository.OPERATION_TYPE_CLIENT_SALE + " AND self.statusSelect = "
        + InvoiceRepository.STATUS_VENTILATED + " AND self.partner.id IN (" + partners + ")");
    List<TrainingInvoiceChoiceView> rows = TrainingRestController.readable(Invoice.class, of).order("-invoiceDate").order("-id").fetch(50).stream()
        .map(i -> new TrainingInvoiceChoiceView(i.getId(), i.getInvoiceId(), i.getInvoiceDate(), currency(i), i.getInTaxTotal(),
            RefundService.received(i), RefundService.unlinked(i)))
        .toList();
    return ResponseConstructor.build(Response.Status.OK, "Invoices", rows);
  }

  @POST
  @Path("/enrollments/{id}/fee")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Finance links the enrolment to the issued invoice that bills it, with the enrolment's share including tax (D-03, D-06)",
      tags = {"IOETI training"})
  @IoetiEndpoint
  public Response link(@PathParam("id") Long id, LinkTrainingFee command) {
    if (command == null) throw ApiException.badRequest("The invoice is required.");
    TrainingEnrollment enrollment = RecordAccess.readable(TrainingEnrollment.class, id);
    new SecurityCheck().createAccess(TrainingFee.class).readAccess(Invoice.class).check();
    Invoice invoice = command.invoiceId() == null || command.invoiceId() <= 0 ? null : JPA.find(Invoice.class, command.invoiceId());
    if (invoice == null || !Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, Invoice.class, invoice.getId())) {
      throw ApiException.invalidField("invoiceId", "UNAVAILABLE", "Choose an issued invoice you can see.");
    }
    TrainingFee[] saved = new TrainingFee[1];
    TrainingRestController.write(() -> saved[0] = Beans.get(RefundService.class).link(enrollment, invoice, command.amount()));
    return ResponseConstructor.build(Response.Status.CREATED, "Invoice linked", view(saved[0]));
  }

  @POST
  @Path("/fees/{id}/unlink")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Remove a wrong invoice link, while no refund was requested on it", tags = {"IOETI training"})
  @IoetiEndpoint
  public Response unlink(@PathParam("id") Long id, TrainingRestController.VersionOnly command) {
    TrainingFee fee = TrainingRestController.writable(TrainingFee.class, id, command == null ? null : command.version());
    new SecurityCheck().removeAccess(TrainingFee.class).check();
    TrainingRestController.write(() -> Beans.get(RefundService.class).unlink(fee));
    return ResponseConstructor.build(Response.Status.OK, "Invoice link removed", null);
  }

  // --- cancellation preview -----------------------------------------------------------------------------------

  @GET
  @Path("/enrollments/{id}/cancellation")
  @Operation(summary = "What cancelling the enrolment today would refund, and its invoice link and refund (D-03)", tags = {"IOETI training"})
  @IoetiEndpoint
  public Response enrollmentCancellation(@PathParam("id") Long id) {
    TrainingEnrollment enrollment = RecordAccess.readable(TrainingEnrollment.class, id);
    RefundService refunds = Beans.get(RefundService.class);
    TrainingRefund refund = RefundService.refund(enrollment);
    Plan plan = refunds.current(enrollment, CompletionService.today());
    TrainingFee fee = plan.fee();
    JpaSecurity security = Beans.get(JpaSecurity.class);
    boolean canLink = security.isPermitted(JpaSecurity.CAN_CREATE, TrainingFee.class) && security.isPermitted(JpaSecurity.CAN_READ, Invoice.class);
    return ResponseConstructor.build(Response.Status.OK, "Cancellation", new TrainingCancellationView(enrollment.getId(), enrollment.getVersion(),
        TrainingRestController.status(enrollment.getStatusSelect(), "CONFIRMED", "WAITLISTED", "CANCELLED"), plan.outcome(),
        fee == null ? null : view(fee), plan.paid(), plan.daysBeforeStart(), plan.percent(), plan.amount(),
        fee == null ? null : currency(fee.getInvoice()), canLink,
        refund == null || !security.isPermitted(JpaSecurity.CAN_READ, TrainingRefund.class, refund.getId()) ? null : view(refund)));
  }

  @GET
  @Path("/cohorts/{id}/cancellation")
  @Operation(summary = "What cancelling the cohort today would do: trainees cancelled and the refunds requested (D-03)", tags = {"IOETI training"})
  @IoetiEndpoint
  public Response cohortCancellation(@PathParam("id") Long id) {
    TrainingCohort cohort = RecordAccess.readable(TrainingCohort.class, id);
    List<Plan> plans = Beans.get(RefundService.class).cohortPlans(cohort, CompletionService.today());
    List<Plan> paid = plans.stream().filter(p -> p.paid().signum() > 0).toList();
    String outcome = paid.stream().map(Plan::outcome).filter(o -> "POLICY_NOT_SET".equals(o)).findFirst()
        .orElse(paid.stream().anyMatch(Plan::refunds) ? "REFUND" : "NO_REFUND");
    BigDecimal total = plans.stream().filter(Plan::refunds).map(Plan::amount).reduce(BigDecimal.ZERO, BigDecimal::add);
    List<String> currencies = plans.stream().filter(Plan::refunds).map(p -> currency(p.fee().getInvoice())).distinct().toList();
    return ResponseConstructor.build(Response.Status.OK, "Cohort cancellation", new CohortCancellationView(cohort.getId(), cohort.getVersion(),
        plans.size(), paid.size(), (int) plans.stream().filter(Plan::refunds).count(), total, currencies.size() == 1 ? currencies.get(0) : null,
        paid.stream().map(Plan::percent).filter(p -> p != null).findFirst().orElse(null), outcome, RefundService.certificates(cohort)));
  }

  // --- refunds ------------------------------------------------------------------------------------------------

  @POST
  @Path("/enrollments/{id}/refund")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Request the refund of an enrolment cancelled before its invoice was linked (D-03)", tags = {"IOETI training"})
  @IoetiEndpoint
  public Response requestRefund(@PathParam("id") Long id, TrainingRestController.VersionOnly command) {
    TrainingEnrollment enrollment = TrainingRestController.writable(TrainingEnrollment.class, id, command == null ? null : command.version());
    new SecurityCheck().createAccess(TrainingRefund.class).check();
    TrainingRefund[] saved = new TrainingRefund[1];
    TrainingRestController.write(() -> saved[0] = Beans.get(RefundService.class).requestLater(enrollment));
    return ResponseConstructor.build(Response.Status.CREATED, "Refund requested", view(saved[0]));
  }

  @GET
  @Path("/refunds")
  @Operation(summary = "Training refunds the caller may read: requested (default), credited, rejected or all", tags = {"IOETI training"})
  @IoetiEndpoint
  public Response refunds(@QueryParam("status") String status) {
    new SecurityCheck().readAccess(TrainingRefund.class).check();
    String wanted = status == null || status.isBlank() ? "REQUESTED" : status.strip().toUpperCase();
    Filter of = null;
    if (!"ALL".equals(wanted)) {
      Integer select = STATUSES.get(wanted);
      if (select == null) throw ApiException.invalidField("status", "UNAVAILABLE", "Use REQUESTED, CREDITED, REJECTED or ALL.");
      of = new JPQLFilter("self.statusSelect = " + select);
    }
    List<TrainingRefundView> rows = TrainingRestController.readable(TrainingRefund.class, of).order("-requestedAt").order("-id").fetch(200)
        .stream().map(TrainingRefundRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Refunds", rows);
  }

  @GET
  @Path("/cohorts/{id}/refunds")
  @Operation(summary = "Refunds of a cohort's enrolments", tags = {"IOETI training"})
  @IoetiEndpoint
  public Response cohortRefunds(@PathParam("id") Long id) {
    TrainingCohort cohort = RecordAccess.readable(TrainingCohort.class, id);
    new SecurityCheck().readAccess(TrainingRefund.class).check();
    List<TrainingRefundView> rows = TrainingRestController.readable(TrainingRefund.class, new JPQLFilter("self.enrollment.cohort.id = " + cohort.getId()))
        .order("-requestedAt").order("-id").fetch(TrainingRestController.MAX_CAPACITY * 2).stream().map(TrainingRefundRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Refunds", rows);
  }

  @POST
  @Path("/refunds/{id}/approve")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Finance approves a refund with the credit note it issued for it through the finance service (D-03, D-06)",
      tags = {"IOETI training"})
  @IoetiEndpoint
  public Response approve(@PathParam("id") Long id, ApproveTrainingRefund command) {
    TrainingRefund refund = TrainingRestController.writable(TrainingRefund.class, id, command == null ? null : command.version());
    new SecurityCheck().createAccess(Invoice.class).writeAccess(Invoice.class).check();
    Invoice creditNote = command.creditInvoiceId() == null || command.creditInvoiceId() <= 0 ? null : JPA.find(Invoice.class, command.creditInvoiceId());
    if (creditNote == null || !Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, Invoice.class, creditNote.getId())) {
      throw ApiException.invalidField("creditInvoiceId", "UNAVAILABLE", "Choose a credit note you can see.");
    }
    TrainingRestController.write(() -> Beans.get(RefundService.class).approve(refund, creditNote));
    return ResponseConstructor.build(Response.Status.OK, "Refund credited", view(refund));
  }

  @POST
  @Path("/refunds/{id}/reject")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Finance rejects a refund with the reason; nothing is credited (D-03)", tags = {"IOETI training"})
  @IoetiEndpoint
  public Response reject(@PathParam("id") Long id, RejectTrainingRefund command) {
    TrainingRefund refund = TrainingRestController.writable(TrainingRefund.class, id, command == null ? null : command.version());
    new SecurityCheck().createAccess(Invoice.class).writeAccess(Invoice.class).check();
    TrainingRestController.write(() -> Beans.get(RefundService.class).reject(refund, command.reason()));
    return ResponseConstructor.build(Response.Status.OK, "Refund rejected", view(refund));
  }

  // --- views --------------------------------------------------------------------------------------------------

  static String currency(Invoice invoice) {
    return invoice.getCurrency() == null ? null : invoice.getCurrency().getCodeISO();
  }

  static TrainingFeeView view(TrainingFee fee) {
    Invoice i = fee.getInvoice();
    return new TrainingFeeView(fee.getId(), fee.getVersion(), i.getId(), i.getInvoiceId(), fee.getAmount(), currency(i),
        com.ioeti.training.service.TrainingRules.paidShare(RefundService.received(i), fee.getAmount(), i.getInTaxTotal()));
  }

  static TrainingRefundView view(TrainingRefund r) {
    JpaSecurity security = Beans.get(JpaSecurity.class);
    TrainingEnrollment e = r.getEnrollment();
    Invoice invoice = r.getInvoice();
    Invoice credit = r.getCreditNote();
    boolean canDecide = Integer.valueOf(TrainingRefundRepository.STATUS_REQUESTED).equals(r.getStatusSelect())
        && security.isPermitted(JpaSecurity.CAN_WRITE, TrainingRefund.class, r.getId())
        && security.isPermitted(JpaSecurity.CAN_CREATE, Invoice.class) && security.isPermitted(JpaSecurity.CAN_WRITE, Invoice.class);
    return new TrainingRefundView(r.getId(), r.getVersion(), e.getId(), TrainingCompletionRestController.traineeName(e),
        e.getCohort().getId(), e.getCohort().getCode(), e.getCohort().getCourse().getName(),
        Integer.valueOf(TrainingRefundRepository.CAUSE_COHORT_CANCELLED).equals(r.getCauseSelect()) ? "COHORT_CANCELLED" : "ENROLMENT_CANCELLED",
        TrainingRestController.status(r.getStatusSelect(), "REQUESTED", "CREDITED", "REJECTED"),
        invoice.getId(), invoice.getInvoiceId(), invoice.getVersion(), currency(invoice), invoice.getInTaxTotal(), r.getPaidAmount(),
        r.getDaysBeforeStart(), r.getRefundPercent(), r.getAmount(), r.getCreditPercent(),
        r.getRequestedAt(), name(r.getRequestedBy()), r.getDecidedAt(), name(r.getDecidedBy()), r.getRejectReason(),
        credit == null ? null : credit.getId(), credit == null ? null : credit.getInvoiceId(), r.getCreditedAmount(), canDecide,
        canDecide ? RefundService.pendingCredit(r) : null);
  }

  static String name(User user) {
    return user == null ? null : user.getName();
  }

  /** amount: the enrolment's share of the invoice including tax; omitted, the part of the invoice not linked yet. */
  public record LinkTrainingFee(Long invoiceId, BigDecimal amount) {}
  /** creditInvoiceId: the credit note finance issued for this refund (a native invoice of type client refund). */
  public record ApproveTrainingRefund(Integer version, Long creditInvoiceId) {}
  public record RejectTrainingRefund(Integer version, String reason) {}
  public record TrainingInvoiceChoiceView(Long id, String number, LocalDate date, String currency, BigDecimal totalWithTax,
      BigDecimal received, BigDecimal unlinked) {}
  /** paid: what was received for this enrolment (its share of the payments on the invoice). */
  public record TrainingFeeView(Long id, Integer version, Long invoiceId, String invoiceNumber, BigDecimal amount, String currency,
      BigDecimal paid) {}
  /**
   * outcome: REFUND, NO_REFUND_DUE, NOT_INVOICED, NOTHING_PAID, POLICY_NOT_SET, START_DATE_MISSING or ALREADY_REQUESTED;
   * the amounts are what cancelling today would refund.
   */
  public record TrainingCancellationView(Long enrollmentId, Integer version, String status, String outcome, TrainingFeeView fee,
      BigDecimal paid, Long daysBeforeStart, BigDecimal refundPercent, BigDecimal refundAmount, String currency, boolean canLinkInvoice,
      TrainingRefundView refund) {}
  /** outcome: REFUND, NO_REFUND (nothing paid or nothing due) or POLICY_NOT_SET (money was paid and the rule is missing). */
  public record CohortCancellationView(Long cohortId, Integer version, int enrollments, int paidEnrollments, int refunds,
      BigDecimal refundTotal, String currency, BigDecimal refundPercent, String outcome, long certificatesIssued) {}
  public record TrainingRefundView(Long id, Integer version, Long enrollmentId, String traineeName, Long cohortId, String cohortCode,
      String courseName, String cause, String status, Long invoiceId, String invoiceNumber, Integer invoiceVersion, String currency,
      BigDecimal invoiceTotal, BigDecimal paidAmount, Integer daysBeforeStart, BigDecimal refundPercent, BigDecimal amount,
      BigDecimal creditPercent, LocalDateTime requestedAt, String requestedBy, LocalDateTime decidedAt, String decidedBy,
      String rejectReason, Long creditId, String creditNumber, BigDecimal creditedAmount, boolean canDecide, Long pendingCreditId) {}
}
