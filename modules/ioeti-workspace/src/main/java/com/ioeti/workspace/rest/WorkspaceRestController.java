package com.ioeti.workspace.rest;

import com.axelor.apps.account.db.Invoice;
import com.axelor.apps.account.db.repo.InvoiceRepository;
import com.axelor.apps.base.db.Partner;
import com.axelor.apps.contract.db.Contract;
import com.axelor.apps.contract.db.ContractLine;
import com.axelor.apps.contract.db.repo.ContractRepository;
import com.axelor.apps.crm.db.Opportunity;
import com.axelor.apps.intervention.db.Intervention;
import com.axelor.apps.project.db.Project;
import com.axelor.apps.quality.db.QualityImprovement;
import com.axelor.apps.quality.db.repo.QualityImprovementRepository;
import com.axelor.apps.sale.db.SaleOrder;
import com.axelor.apps.sale.db.repo.SaleOrderRepository;
import com.axelor.apps.supplychain.db.Timetable;
import com.axelor.apps.base.service.app.AppBaseService;
import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.AuditableModel;
import com.axelor.auth.db.User;
import com.axelor.db.JPA;
import com.axelor.db.JpaSecurity;
import com.axelor.db.Model;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.axelor.rpc.filter.Filter;
import com.axelor.rpc.filter.JPQLFilter;
import com.axelor.utils.api.ConflictChecker;
import com.axelor.utils.api.ResponseConstructor;
import com.axelor.utils.api.SecurityCheck;
import com.ioeti.certification.db.CertificationCycle;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.IoetiEndpoint;
import com.ioeti.core.api.NativeCommands;
import com.ioeti.core.api.RecordAccess;
import com.ioeti.core.web.OptimisticLockConflicts;
import com.ioeti.fundraising.db.DonorProfile;
import com.ioeti.operations.db.HandoverRequest;
import com.ioeti.recruitment.db.ClientJobOrder;
import com.ioeti.training.db.TrainingEnrollment;
import com.ioeti.workspace.db.InvoiceRequest;
import com.ioeti.commercial.service.QuoteApprovalService;
import com.ioeti.workspace.service.CommitmentService;
import com.ioeti.content.db.repo.RecordDocumentRepository;
import com.ioeti.workspace.db.ReviewEvent;
import com.ioeti.workspace.db.ReviewRequest;
import com.ioeti.workspace.db.repo.InvoiceRequestRepository;
import com.ioeti.workspace.db.repo.ReviewRequestRepository;
import com.ioeti.workspace.service.InvoicingService;
import com.ioeti.workspace.service.WorkspaceService;
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
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * Cross-domain workflows (Wave 5b): review requests for quotations and contracts, invoice requests
 * for milestones, contract renewals, and the authorized Account 360 summary. Approval and rejection
 * (D-11) and invoice issue (D-06) fail closed.
 */
@Path("/ioeti/workspace")
@Produces(MediaType.APPLICATION_JSON)
public class WorkspaceRestController {

  static final String[] REVIEW_STATUSES = {"PENDING", "CHANGES_REQUESTED", "WITHDRAWN", "APPROVED", "REJECTED"};
  static final String[] REVIEW_EVENTS = {"REQUESTED", "CHANGES_REQUESTED", "WITHDRAWN", "APPROVED", "REJECTED"};
  static final String[] REASONS = {"PRICING", "SCOPE", "TERMS", "DOCUMENTS", "OTHER"};

  // --- review requests -----------------------------------------------------------------------------

  @GET
  @Path("/reviews")
  @Operation(summary = "Review history of a quotation or a contract, newest first; or, with pending=true, the pending reviews"
      + " the caller may see and did not request (a reviewer's queue)", tags = {"IOETI workspace"})
  @IoetiEndpoint
  public Response reviews(@QueryParam("quoteId") Long quoteId, @QueryParam("contractId") Long contractId,
      @QueryParam("pending") Boolean pending) {
    new SecurityCheck().readAccess(ReviewRequest.class).check();
    Filter where;
    if (Boolean.TRUE.equals(pending) && quoteId == null && contractId == null) {
      where = new JPQLFilter("self.statusSelect = ? AND (self.requestedBy IS NULL OR self.requestedBy != ?)",
          ReviewRequestRepository.STATUS_PENDING, AuthUtils.getUser());
    } else if (quoteId != null) {
      RecordAccess.readable(SaleOrder.class, quoteId);
      where = new JPQLFilter("self.quote.id = ?", quoteId);
    } else if (contractId != null) {
      RecordAccess.readable(Contract.class, contractId);
      where = new JPQLFilter("self.contract.id = ?", contractId);
    } else {
      throw ApiException.badRequest("Give quoteId or contractId.");
    }
    List<ReviewView> rows = readable(ReviewRequest.class, where).order("-id").fetch(100).stream()
        .map(WorkspaceRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Reviews", rows);
  }

  @POST
  @Path("/reviews")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Ask for a review of a draft quotation (at its current version) or a draft contract", tags = {"IOETI workspace"})
  @IoetiEndpoint
  public Response requestReview(RequestReview command) {
    if (command == null || (command.quoteId() == null) == (command.contractId() == null)) {
      throw ApiException.badRequest("Give either quoteId or contractId.");
    }
    new SecurityCheck().createAccess(ReviewRequest.class).check();
    SaleOrder quote = command.quoteId() == null ? null : writable(SaleOrder.class, command.quoteId(), command.version());
    Contract contract = command.contractId() == null ? null : writable(Contract.class, command.contractId(), command.version());
    ReviewRequest[] saved = new ReviewRequest[1];
    write(() -> saved[0] = Beans.get(WorkspaceService.class).requestReview(quote, contract));
    return ResponseConstructor.build(Response.Status.CREATED, "Review requested", view(saved[0]));
  }

  @POST
  @Path("/reviews/{id}/changes")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Send the record back for changes, with a reason", tags = {"IOETI workspace"})
  @IoetiEndpoint
  public Response requestChanges(@PathParam("id") Long id, Decision command) {
    ReviewRequest review = writable(ReviewRequest.class, id, command == null ? null : command.version());
    int reason = select("reason", command.reason(), REASONS);
    write(() -> Beans.get(WorkspaceService.class).requestChanges(review, reason));
    return ResponseConstructor.build(Response.Status.OK, "Changes requested", view(review));
  }

  @POST
  @Path("/reviews/{id}/withdraw")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Withdraw a pending review request", tags = {"IOETI workspace"})
  @IoetiEndpoint
  public Response withdraw(@PathParam("id") Long id, VersionOnly command) {
    ReviewRequest review = writable(ReviewRequest.class, id, command == null ? null : command.version());
    write(() -> Beans.get(WorkspaceService.class).withdraw(review));
    return ResponseConstructor.build(Response.Status.OK, "Withdrawn", view(review));
  }

  @POST
  @Path("/reviews/{id}/approve")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Approve a quotation review and finalize the quotation natively under its approval tier (D-11);"
      + " contracts stay closed until contract activation", tags = {"IOETI workspace"})
  @IoetiEndpoint
  public Response approve(@PathParam("id") Long id, Approval command) {
    ReviewRequest review = writable(ReviewRequest.class, id, command == null ? null : command.version());
    if (review.getQuote() == null) throw contractDecision();
    // finalizing changes the quotation: the approver needs native write access to it
    new SecurityCheck().writeAccess(SaleOrder.class).check();
    RecordAccess.writable(SaleOrder.class, review.getQuote().getId());
    NativeCommands.run(() -> Beans.get(WorkspaceService.class).approve(review, command.rationale()), "QUOTE_REJECTED",
        "The quotation cannot be finalized this way.");
    return ResponseConstructor.build(Response.Status.OK, "Approved", view(review));
  }

  @POST
  @Path("/reviews/{id}/reject")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Reject a quotation review with a reason (D-11); the quotation stays a draft", tags = {"IOETI workspace"})
  @IoetiEndpoint
  public Response reject(@PathParam("id") Long id, Rejection command) {
    ReviewRequest review = writable(ReviewRequest.class, id, command == null ? null : command.version());
    if (review.getQuote() == null) throw contractDecision();
    RecordAccess.readable(SaleOrder.class, review.getQuote().getId());
    int reason = select("reason", command.reason(), REASONS);
    write(() -> Beans.get(WorkspaceService.class).reject(review, reason, command.rationale()));
    return ResponseConstructor.build(Response.Status.OK, "Rejected", view(review));
  }

  /** D-11: a contract is not approved through a review; its signatory activates it on signature evidence. */
  private static ApiException contractDecision() {
    return new ApiException(422, "USE_CONTRACT_ACTIVATION",
        "A contract is approved by activating it on its signature evidence, by the business line's signatory.", null);
  }

  // --- binding commitments (D-11) -----------------------------------------------------------------

  @POST
  @Path("/quotes/{id}/accept")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Record the client's acceptance of a finalized quotation on its uploaded evidence (a signed quotation or a"
      + " purchase order filed on the quotation); confirms the order natively (D-11)", tags = {"IOETI workspace"})
  @IoetiEndpoint
  public Response accept(@PathParam("id") Long id, AcceptQuote command) {
    if (command == null || command.version() == null) throw ApiException.badRequest("Record version is required.");
    new SecurityCheck().writeAccess(SaleOrder.class).check();
    SaleOrder quote = writable(SaleOrder.class, id, command.version());
    String kind = acceptanceKind(command.kind());
    String reference = command.reference() == null ? "" : command.reference().strip();
    if (reference.length() > 100) throw ApiException.invalidField("reference", "TOO_LONG", "At most 100 characters.");
    if (CommitmentService.PURCHASE_ORDER.equals(kind) && reference.isEmpty()) {
      throw ApiException.invalidField("reference", "REQUIRED", "Give the purchase order number.");
    }
    CommitmentService.Evidence evidence = CommitmentService.evidence(command.documentId(), RecordDocumentRepository.SUBJECT_QUOTE, quote.getId());
    CommitmentService.checkAcceptable(quote, command.acceptedOn(), Beans.get(AppBaseService.class).getTodayDate(quote.getCompany()));
    NativeCommands.run(() -> Beans.get(CommitmentService.class).accept(quote, kind, reference.isEmpty() ? null : reference,
        command.acceptedOn(), evidence), "QUOTE_REJECTED", "The order cannot be confirmed this way.");
    return ResponseConstructor.build(Response.Status.OK, "Acceptance recorded", Map.of("quoteId", quote.getId(), "status", "CONFIRMED"));
  }

  static String acceptanceKind(String value) {
    if (CommitmentService.SIGNED_QUOTE.equals(value) || CommitmentService.PURCHASE_ORDER.equals(value)) return value;
    throw ApiException.invalidField("kind", "UNAVAILABLE", "Use SIGNED_QUOTE or PURCHASE_ORDER.");
  }

  @POST
  @Path("/contracts/{id}/activate")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Activate a draft contract on its uploaded signature evidence (a signed copy filed on the contract), by a"
      + " holder of the business line's signatory role; native AOS activation (D-11)", tags = {"IOETI workspace"})
  @IoetiEndpoint
  public Response activate(@PathParam("id") Long id, ActivateContract command) {
    if (command == null || command.version() == null) throw ApiException.badRequest("Record version is required.");
    new SecurityCheck().writeAccess(Contract.class).check();
    Contract contract = writable(Contract.class, id, command.version());
    CommitmentService.Evidence evidence = CommitmentService.evidence(command.documentId(), RecordDocumentRepository.SUBJECT_CONTRACT, contract.getId());
    NativeCommands.run(() -> Beans.get(CommitmentService.class).activate(contract, command.signedOn(), command.startOn(), evidence),
        "CONTRACT_REJECTED", "The contract cannot be activated this way.");
    return ResponseConstructor.build(Response.Status.OK, "Contract activated", Map.of("contractId", contract.getId(), "status", "ACTIVE"));
  }

  // --- invoice requests ----------------------------------------------------------------------------

  @GET
  @Path("/invoice-requests")
  @Operation(summary = "Invoice requests of an order", tags = {"IOETI workspace"})
  @IoetiEndpoint
  public Response invoiceRequests(@QueryParam("quoteId") Long quoteId) {
    if (quoteId == null) throw ApiException.badRequest("Give quoteId.");
    RecordAccess.readable(SaleOrder.class, quoteId);
    new SecurityCheck().readAccess(InvoiceRequest.class).check();
    List<InvoiceRequestView> rows = readable(InvoiceRequest.class, new JPQLFilter("self.quote.id = ?", quoteId))
        .order("-id").fetch(200).stream().map(WorkspaceRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Invoice requests", rows);
  }

  @POST
  @Path("/invoice-requests")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Ask finance to invoice one milestone of a confirmed order (no invoice is issued)", tags = {"IOETI workspace"})
  @IoetiEndpoint
  public Response requestInvoice(RequestInvoice command) {
    if (command == null) throw ApiException.badRequest("Milestone details are required.");
    new SecurityCheck().createAccess(InvoiceRequest.class).check();
    Timetable milestone = RecordAccess.writable(Timetable.class, command.milestoneId());
    // the plan the user looked at is versioned by its quotation; the milestone row itself is locked
    if (milestone.getSaleOrder() == null) throw ApiException.invalidField("milestoneId", "UNAVAILABLE", "Choose a milestone of an order.");
    writable(SaleOrder.class, milestone.getSaleOrder().getId(), command.quoteVersion());
    InvoiceRequest[] saved = new InvoiceRequest[1];
    write(() -> saved[0] = Beans.get(WorkspaceService.class).requestInvoice(milestone));
    return ResponseConstructor.build(Response.Status.CREATED, "Invoice requested", view(saved[0]));
  }

  @POST
  @Path("/invoice-requests/{id}/cancel")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Cancel an open invoice request", tags = {"IOETI workspace"})
  @IoetiEndpoint
  public Response cancel(@PathParam("id") Long id, VersionOnly command) {
    InvoiceRequest request = writable(InvoiceRequest.class, id, command == null ? null : command.version());
    write(() -> Beans.get(WorkspaceService.class).cancel(request));
    return ResponseConstructor.build(Response.Status.OK, "Cancelled", view(request));
  }

  @POST
  @Path("/invoice-requests/{id}/issue")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Issue the invoice in Axelor accounting (finance: native rights to create invoices); refused with what is missing until the accounting set-up and the payment-terms policy are in place (D-06)", tags = {"IOETI workspace"})
  @IoetiEndpoint
  public Response issue(@PathParam("id") Long id, VersionOnly command) {
    if (command == null || command.version() == null) throw ApiException.badRequest("Record version is required.");
    // issuing is finance's: native rights to create and validate invoices, on a request the person may read
    new SecurityCheck().createAccess(Invoice.class).writeAccess(Invoice.class).check();
    InvoiceRequest request = RecordAccess.readable(InvoiceRequest.class, id);
    ConflictChecker.checkVersion(request, command.version());
    User me = AuthUtils.getUser();
    NativeCommands.run(() -> Beans.get(InvoicingService.class).issue(request, me,
        Beans.get(AppBaseService.class).getTodayDate(request.getQuote().getCompany())), "INVOICE_REJECTED", "The invoice could not be issued.");
    return ResponseConstructor.build(Response.Status.OK, "Invoice issued", view(request));
  }

  // --- renewals ------------------------------------------------------------------------------------

  @POST
  @Path("/contracts/{id}/renewal")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Open the renewal opportunity of an active or closed contract", tags = {"IOETI workspace"})
  @IoetiEndpoint
  public Response renew(@PathParam("id") Long id, VersionOnly command) {
    Contract contract = writable(Contract.class, id, command == null ? null : command.version());
    new SecurityCheck().createAccess(Opportunity.class).check();
    Opportunity[] saved = new Opportunity[1];
    write(() -> saved[0] = Beans.get(WorkspaceService.class).renew(contract));
    return ResponseConstructor.build(Response.Status.CREATED, "Renewal opened",
        new RenewalView(saved[0].getId(), saved[0].getName(), contract.getId()));
  }

  // --- Account 360 ---------------------------------------------------------------------------------

  @GET
  @Path("/account360/{id}")
  @Operation(summary = "What the caller may see about one client account across every domain, with money kept apart", tags = {"IOETI workspace"})
  @IoetiEndpoint
  public Response account360(@PathParam("id") Long id) {
    Partner account = RecordAccess.readable(Partner.class, id);
    if (!Boolean.TRUE.equals(account.getIsCustomer()) && !Boolean.TRUE.equals(account.getIsProspect())) {
      throw new ApiException(404, "NOT_FOUND", "Record not found.", null);
    }
    List<Section> sections = new ArrayList<>();
    sections.add(section("OPPORTUNITIES", Opportunity.class, "self.partner.id = ?", id));
    sections.add(section("QUOTES", SaleOrder.class, "self.clientPartner.id = ? AND self.statusSelect < 5", id));
    sections.add(section("CONTRACTS", Contract.class, "self.partner.id = ?", id));
    sections.add(section("HANDOVERS", HandoverRequest.class, "self.contract.partner.id = ?", id));
    sections.add(section("ENGAGEMENTS", Project.class, "self.clientPartner.id = ? AND self.ioetiHandover IS NOT NULL", id));
    sections.add(section("CERTIFICATION_CYCLES", CertificationCycle.class, "self.client.id = ?", id));
    sections.add(section("TRAINING_ENROLLMENTS", TrainingEnrollment.class, "self.client.id = ?", id));
    sections.add(section("JOB_ORDERS", ClientJobOrder.class, "self.client.id = ?", id));
    sections.add(section("DONOR_PROFILE", DonorProfile.class, "self.partner.id = ?", id));
    sections.add(section("FIELD_VISITS", Intervention.class, "self.deliveredPartner.id = ?", id));
    sections.add(section("QUALITY_ISSUES", QualityImprovement.class,
        "self.type = ? AND (self.qiIdentification.customerPartner.id = ? OR self.qiIdentification.supplierPartner.id = ?)",
        QualityImprovementRepository.TYPE_SYSTEM, id, id));
    return ResponseConstructor.build(Response.Status.OK, "Account 360",
        new Account360View(account.getId(), account.getName(), sections.stream().filter(Section::permitted).toList(), money(id)));
  }

  /** A section the caller has no read right on is left out entirely (not shown as zero). */
  private static <T extends Model> Section section(String key, Class<T> type, String condition, Object... params) {
    if (!Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, type)) return new Section(key, 0, false);
    return new Section(key, readable(type, new JPQLFilter(condition, params)).count(), true);
  }

  /** Money per currency in separate stages; a stage the caller may not read is null, never zero. */
  private static List<MoneyRow> money(Long accountId) {
    JpaSecurity security = Beans.get(JpaSecurity.class);
    Map<String, BigDecimal[]> rows = new TreeMap<>();
    boolean quotes = security.isPermitted(JpaSecurity.CAN_READ, SaleOrder.class);
    boolean contracts = security.isPermitted(JpaSecurity.CAN_READ, Contract.class);
    boolean requests = security.isPermitted(JpaSecurity.CAN_READ, InvoiceRequest.class);
    boolean invoices = security.isPermitted(JpaSecurity.CAN_READ, Invoice.class);
    if (quotes) {
      for (SaleOrder q : readable(SaleOrder.class, new JPQLFilter("self.clientPartner.id = ? AND self.statusSelect = ?",
          accountId, SaleOrderRepository.STATUS_DRAFT_QUOTATION)).fetch(1000)) {
        add(rows, code(q.getCurrency()), 0, q.getExTaxTotal());
      }
    }
    if (contracts) {
      for (Contract c : readable(Contract.class, new JPQLFilter("self.partner.id = ? AND self.statusSelect = ?",
          accountId, ContractRepository.ACTIVE_CONTRACT)).fetch(1000)) {
        List<ContractLine> lines = c.getCurrentContractVersion() == null || c.getCurrentContractVersion().getContractLineList() == null
            ? List.of() : c.getCurrentContractVersion().getContractLineList();
        for (ContractLine l : lines) add(rows, code(c.getCurrency()), 1, l.getExTaxTotal());
      }
    }
    if (requests) {
      for (InvoiceRequest r : readable(InvoiceRequest.class, new JPQLFilter("self.quote.clientPartner.id = ? AND self.statusSelect = ?",
          accountId, InvoiceRequestRepository.STATUS_REQUESTED)).fetch(1000)) {
        add(rows, code(r.getQuote().getCurrency()), 2, r.getAmountBeforeTax());
      }
    }
    if (invoices) {
      for (Invoice i : readable(Invoice.class, new JPQLFilter("self.partner.id = ? AND self.operationTypeSelect = ? AND self.statusSelect = ?",
          accountId, InvoiceRepository.OPERATION_TYPE_CLIENT_SALE, InvoiceRepository.STATUS_VENTILATED)).fetch(1000)) {
        add(rows, code(i.getCurrency()), 3, i.getExTaxTotal());
        add(rows, code(i.getCurrency()), 4, i.getAmountPaid());
      }
    }
    List<MoneyRow> out = new ArrayList<>();
    rows.forEach((currency, t) -> out.add(new MoneyRow(currency, quotes ? t[0] : null, contracts ? t[1] : null,
        requests ? t[2] : null, invoices ? t[3] : null, invoices ? t[4] : null)));
    return out;
  }

  private static void add(Map<String, BigDecimal[]> rows, String currency, int stage, BigDecimal value) {
    BigDecimal[] t = rows.computeIfAbsent(currency, k -> new BigDecimal[] {BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO,
        BigDecimal.ZERO, BigDecimal.ZERO});
    if (value != null) t[stage] = t[stage].add(value);
  }

  private static String code(com.axelor.apps.base.db.Currency currency) {
    return currency == null ? "—" : currency.getCodeISO();
  }

  // --- helpers -------------------------------------------------------------------------------------

  private static <T extends Model> Query<T> readable(Class<T> type, Filter condition) {
    Filter security = Beans.get(JpaSecurity.class).getFilter(JpaSecurity.CAN_READ, type);
    Filter combined = security == null ? condition : condition == null ? security : Filter.and(security, condition);
    return combined == null ? Query.of(type) : combined.build(type);
  }

  private static <T extends AuditableModel> T writable(Class<T> type, Long id, Integer version) {
    if (version == null) throw ApiException.badRequest("Record version is required.");
    T record = RecordAccess.writable(type, id);
    ConflictChecker.checkVersion(record, version);
    return record;
  }

  private static void write(Runnable command) {
    OptimisticLockConflicts.translate(command::run);
  }

  static int select(String field, String value, String... names) {
    for (int i = 0; i < names.length; i++) if (names[i].equals(value)) return i + 1;
    throw ApiException.invalidField(field, "UNAVAILABLE", "Use one of " + String.join(", ", names) + ".");
  }

  static String name(Integer select, String... names) {
    return select == null || select < 1 || select > names.length ? null : names[select - 1];
  }

  private static String userName(User user) {
    return user == null ? null : user.getName();
  }

  static ReviewView view(ReviewRequest r) {
    List<ReviewEventView> events = Query.of(ReviewEvent.class).filter("self.review = ?1", r).order("occurredAt").order("id").fetch().stream()
        .map(e -> new ReviewEventView(name(e.getKindSelect(), REVIEW_EVENTS), name(e.getReasonSelect(), REASONS),
            userName(e.getActor()), e.getOccurredAt())).toList();
    return new ReviewView(r.getId(), r.getVersion(), r.getQuote() == null ? null : r.getQuote().getId(),
        r.getContract() == null ? null : r.getContract().getId(), r.getSubjectVersionNumber(), name(r.getStatusSelect(), REVIEW_STATUSES),
        userName(r.getRequestedBy()), r.getRequestedAt(), userName(r.getReviewedBy()), name(r.getReasonSelect(), REASONS),
        r.getQuote() == null ? "BLOCKED_BY_POLICY" : "OPEN", r.getRequestedBy() != null && r.getRequestedBy().equals(AuthUtils.getUser()), events,
        r.getQuote() != null && r.getQuote().getOpportunity() != null ? r.getQuote().getOpportunity().getId()
            : r.getContract() != null && r.getContract().getOpportunity() != null ? r.getContract().getOpportunity().getId() : null,
        r.getQuote() != null ? r.getQuote().getSaleOrderSeq() : r.getContract() != null ? r.getContract().getContractId() : null,
        r.getApproverCode(), canDecide(r), r.getDecidedAt(), r.getDecisionNote());
  }

  /** D-11: whether the caller may approve or reject this review (pending quotation, not theirs, holds the tier's role). */
  static boolean canDecide(ReviewRequest r) {
    User me = AuthUtils.getUser();
    return r.getQuote() != null && r.getStatusSelect() == ReviewRequestRepository.STATUS_PENDING && r.getApproverCode() != null
        && (r.getRequestedBy() == null || !r.getRequestedBy().equals(me))
        && (QuoteApprovalService.NONE.equals(r.getApproverCode()) || QuoteApprovalService.holds(me, r.getApproverCode()));
  }

  static InvoiceRequestView view(InvoiceRequest r) {
    Timetable m = r.getMilestone();
    return new InvoiceRequestView(r.getId(), r.getVersion(), r.getQuote().getId(), m.getId(), m.getTitle(), m.getEstimatedDate(),
        r.getAmountBeforeTax(), code(r.getQuote().getCurrency()),
        status(r), userName(r.getRequestedBy()), r.getRequestedAt(), r.getInvoice() == null ? null : r.getInvoice().getInvoiceId());
  }

  static String status(InvoiceRequest r) {
    return switch (r.getStatusSelect()) {
      case InvoiceRequestRepository.STATUS_REQUESTED -> "REQUESTED";
      case InvoiceRequestRepository.STATUS_ISSUED -> "ISSUED";
      default -> "CANCELLED";
    };
  }

  public record VersionOnly(Integer version) {}
  public record RequestReview(Long quoteId, Long contractId, Integer version) {}
  public record Decision(Integer version, String reason) {}
  /** D-11: why the approver decided (optional, at most 500 characters). */
  public record Approval(Integer version, String rationale) {}
  /** D-11: the client's acceptance: SIGNED_QUOTE or PURCHASE_ORDER (with its number), when, and the evidence document. */
  public record AcceptQuote(Integer version, String kind, String reference, java.time.LocalDate acceptedOn, Long documentId) {}
  /** D-11: the signature date, the start date (defaults to the signature date) and the signature evidence document. */
  public record ActivateContract(Integer version, java.time.LocalDate signedOn, java.time.LocalDate startOn, Long documentId) {}
  public record Rejection(Integer version, String reason, String rationale) {}
  public record RequestInvoice(Long milestoneId, Integer quoteVersion) {}
  public record ReviewEventView(String kind, String reason, String actorName, LocalDateTime at) {}
  public record ReviewView(
      Long id, Integer version, Long quoteId, Long contractId, Integer quoteVersionNumber, String status, String requestedBy,
      LocalDateTime requestedAt, String reviewedBy, String reason, String decisionStatus, boolean requestedByMe,
      List<ReviewEventView> events, Long opportunityId, String subjectReference, String approver, boolean canDecide,
      LocalDateTime decidedAt, String rationale) {}
  public record InvoiceRequestView(
      Long id, Integer version, Long quoteId, Long milestoneId, String milestoneTitle, java.time.LocalDate dueDate,
      BigDecimal amountBeforeTax, String currency, String status, String requestedBy, LocalDateTime requestedAt, String invoiceNumber) {}
  public record RenewalView(Long opportunityId, String name, Long contractId) {}
  public record Section(String key, long count, boolean permitted) {}
  public record MoneyRow(
      String currency, BigDecimal quotedDraft, BigDecimal bookedActive, BigDecimal invoiceRequested, BigDecimal invoiced,
      BigDecimal collected) {}
  public record Account360View(Long id, String name, List<Section> sections, List<MoneyRow> money) {}
}
