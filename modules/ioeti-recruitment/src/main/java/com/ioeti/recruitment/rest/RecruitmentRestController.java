package com.ioeti.recruitment.rest;

import com.axelor.apps.base.db.Partner;
import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.AuditableModel;
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
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.IoetiEndpoint;
import com.ioeti.core.api.RecordAccess;
import com.ioeti.core.web.OptimisticLockConflicts;
import com.ioeti.recruitment.db.CandidateApplication;
import com.ioeti.recruitment.db.CandidateConsent;
import com.ioeti.recruitment.db.CandidatePrivateProfile;
import com.ioeti.recruitment.db.ClientInterview;
import com.ioeti.recruitment.db.ClientJobOrder;
import com.ioeti.recruitment.db.Placement;
import com.ioeti.recruitment.db.RecruitmentCandidate;
import com.ioeti.recruitment.db.RecruitmentFeeMilestone;
import com.ioeti.recruitment.db.repo.CandidateApplicationRepository;
import com.ioeti.recruitment.db.repo.CandidateConsentRepository;
import com.ioeti.recruitment.db.repo.ClientInterviewRepository;
import com.ioeti.recruitment.db.repo.ClientJobOrderRepository;
import com.ioeti.recruitment.db.repo.RecruitmentFeeMilestoneRepository;
import com.ioeti.recruitment.service.RecruitmentService;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Recruitment for external clients (Wave 4D): job orders, candidates, consent, pipeline,
 * submission, client interviews, offers, placements and fee milestones. Every record goes through
 * native permissions and record filters; unknown and unreadable ids answer the same 404.
 *
 * <p>Candidate contact data, pay expectations and CV references are written through a separate
 * entity and never returned (G-007 RESTRICTED); reading them needs D-04 and D-07. Fail closed until
 * D-04 (and D-06 for invoicing): disclosing the private profile or CV to a client, fee amounts and
 * invoicing, guarantee terms and replacement claims.
 */
@Path("/ioeti/recruitment")
@Produces(MediaType.APPLICATION_JSON)
public class RecruitmentRestController {

  static final Pattern REFERENCE = Pattern.compile("[A-Z0-9][A-Z0-9-]{1,29}");
  static final Pattern EMAIL = Pattern.compile("[^@\\s]{1,64}@[^@\\s]{1,190}\\.[A-Za-z]{2,}");
  static final Pattern PHONE = Pattern.compile("\\+?[0-9 ()-]{7,20}");
  static final String[] STAGES = {
      "SOURCED", "SCREENED", "SHORTLISTED", "SUBMITTED", "INTERVIEWING", "OFFERED", "PLACED", "REJECTED", "WITHDRAWN"};
  static final Map<String, Integer> MOVABLE = Map.of(
      "SCREENED", CandidateApplicationRepository.STAGE_SCREENED,
      "SHORTLISTED", CandidateApplicationRepository.STAGE_SHORTLISTED,
      "INTERVIEWING", CandidateApplicationRepository.STAGE_INTERVIEWING,
      "REJECTED", CandidateApplicationRepository.STAGE_REJECTED,
      "WITHDRAWN", CandidateApplicationRepository.STAGE_WITHDRAWN);
  static final Map<String, Integer> CONSENT_METHODS = Map.of(
      "WRITTEN", CandidateConsentRepository.METHOD_WRITTEN, "EMAIL", CandidateConsentRepository.METHOD_EMAIL,
      "RECORDED_CALL", CandidateConsentRepository.METHOD_RECORDED_CALL);
  static final Map<String, Integer> OUTCOMES = Map.of(
      "PASSED", ClientInterviewRepository.OUTCOME_PASSED, "FAILED", ClientInterviewRepository.OUTCOME_FAILED,
      "NO_SHOW", ClientInterviewRepository.OUTCOME_NO_SHOW);
  static final Map<String, Integer> ORDER_STATUS = Map.of(
      "ON_HOLD", ClientJobOrderRepository.STATUS_ON_HOLD, "OPEN", ClientJobOrderRepository.STATUS_OPEN,
      "CLOSED", ClientJobOrderRepository.STATUS_CLOSED);

  // --- job orders ----------------------------------------------------------------------------------

  @GET
  @Path("/job-orders")
  @Operation(summary = "Job orders the caller may read, optionally of one client", tags = {"IOETI recruitment"})
  @IoetiEndpoint
  public Response jobOrders(@QueryParam("clientId") Long clientId, @QueryParam("q") String q) {
    new SecurityCheck().readAccess(ClientJobOrder.class).check();
    List<String> conditions = new ArrayList<>();
    List<Object> params = new ArrayList<>();
    if (clientId != null) {
      conditions.add("self.client.id = ?");
      params.add(clientId);
    }
    String search = checkedText("q", q, 100, false);
    if (search != null) {
      conditions.add("(LOWER(self.reference) LIKE ? OR LOWER(self.title) LIKE ?)");
      String like = "%" + search.toLowerCase().replace("%", "").replace("_", "") + "%";
      params.add(like);
      params.add(like);
    }
    Filter where = conditions.isEmpty() ? null : new JPQLFilter(String.join(" AND ", conditions), params.toArray());
    List<JobOrderView> rows = readable(ClientJobOrder.class, where).order("-id").fetch(100).stream()
        .map(RecruitmentRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Job orders", rows);
  }

  @GET
  @Path("/job-orders/{id}")
  @Operation(summary = "One job order with its pipeline counts", tags = {"IOETI recruitment"})
  @IoetiEndpoint
  public Response jobOrder(@PathParam("id") Long id) {
    return ResponseConstructor.build(Response.Status.OK, "Job order", view(RecordAccess.readable(ClientJobOrder.class, id)));
  }

  @POST
  @Path("/job-orders")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Open a job order for a client account; the caller is its recruiter", tags = {"IOETI recruitment"})
  @IoetiEndpoint
  public Response createJobOrder(CreateJobOrder command) {
    if (command == null) throw ApiException.badRequest("Job order details are required.");
    new SecurityCheck().createAccess(ClientJobOrder.class).check();
    String reference = command.reference() == null ? "" : command.reference().strip().toUpperCase();
    if (!REFERENCE.matcher(reference).matches()) {
      throw ApiException.invalidField("reference", "FORMAT", "Use 2 to 30 letters, digits or dashes.");
    }
    if (Query.of(ClientJobOrder.class).filter("self.reference = ?", reference).count() > 0) {
      throw ApiException.invalidField("reference", "DUPLICATE", "Another job order already uses this reference.");
    }
    Partner client = command.clientId() == null || command.clientId() <= 0 ? null : JPA.find(Partner.class, command.clientId());
    if (client == null || !Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, Partner.class, client.getId())) {
      throw ApiException.invalidField("clientId", "UNAVAILABLE", "Choose a client account you can see.");
    }
    if (command.headcount() == null || command.headcount() < 1 || command.headcount() > 500) {
      throw ApiException.invalidField("headcount", "RANGE", "Positions must be between 1 and 500.");
    }
    ClientJobOrder order = new ClientJobOrder();
    order.setReference(reference);
    order.setClient(client);
    order.setTitle(checkedText("title", command.title(), 255, true));
    order.setHeadcount(command.headcount());
    order.setLocation(checkedText("location", command.location(), 255, false));
    order.setRequirements(checkedText("requirements", command.requirements(), 4000, false));
    order.setStatusSelect(ClientJobOrderRepository.STATUS_OPEN);
    order.setRecruiter(AuthUtils.getUser());
    ClientJobOrder[] saved = new ClientJobOrder[1];
    write(() -> saved[0] = Beans.get(RecruitmentService.class).create(order));
    return ResponseConstructor.build(Response.Status.CREATED, "Job order opened", view(saved[0]));
  }

  @POST
  @Path("/job-orders/{id}/status")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Put a job order on hold, reopen or close it", tags = {"IOETI recruitment"})
  @IoetiEndpoint
  public Response orderStatus(@PathParam("id") Long id, ChangeStatus command) {
    ClientJobOrder order = writable(ClientJobOrder.class, id, command == null ? null : command.version());
    Integer status = command.status() == null ? null : ORDER_STATUS.get(command.status());
    if (status == null) throw ApiException.invalidField("status", "UNAVAILABLE", "Use OPEN, ON_HOLD or CLOSED.");
    if (order.getStatusSelect() == ClientJobOrderRepository.STATUS_FILLED || order.getStatusSelect() == ClientJobOrderRepository.STATUS_CLOSED) {
      throw new ApiException(422, "ORDER_STATE", "A filled or closed job order cannot change status.", null);
    }
    order.setStatusSelect(status);
    write(() -> Beans.get(RecruitmentService.class).create(order));
    return ResponseConstructor.build(Response.Status.OK, "Job order updated", view(order));
  }

  // --- candidates ----------------------------------------------------------------------------------

  @GET
  @Path("/candidates")
  @Operation(summary = "Candidates the caller may read (non-restricted profile only)", tags = {"IOETI recruitment"})
  @IoetiEndpoint
  public Response candidates(@QueryParam("q") String q) {
    new SecurityCheck().readAccess(RecruitmentCandidate.class).check();
    String search = checkedText("q", q, 100, false);
    Filter where = search == null ? null : new JPQLFilter("LOWER(self.displayName) LIKE ?",
        "%" + search.toLowerCase().replace("%", "").replace("_", "") + "%");
    List<CandidateView> rows = readable(RecruitmentCandidate.class, where).order("displayName").fetch(200).stream()
        .map(RecruitmentRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Candidates", rows);
  }

  @GET
  @Path("/candidates/{id}")
  @Operation(summary = "One candidate: profile, consents and applications the caller may read", tags = {"IOETI recruitment"})
  @IoetiEndpoint
  public Response candidate(@PathParam("id") Long id) {
    return ResponseConstructor.build(Response.Status.OK, "Candidate", view(RecordAccess.readable(RecruitmentCandidate.class, id)));
  }

  @POST
  @Path("/candidates")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Add a candidate (non-restricted profile)", tags = {"IOETI recruitment"})
  @IoetiEndpoint
  public Response createCandidate(CreateCandidate command) {
    if (command == null) throw ApiException.badRequest("Candidate details are required.");
    new SecurityCheck().createAccess(RecruitmentCandidate.class).check();
    if (command.yearsExperience() != null && (command.yearsExperience() < 0 || command.yearsExperience() > 60)) {
      throw ApiException.invalidField("yearsExperience", "RANGE", "Years of experience must be between 0 and 60.");
    }
    RecruitmentCandidate candidate = new RecruitmentCandidate();
    candidate.setDisplayName(checkedText("displayName", command.displayName(), 255, true));
    candidate.setHeadline(checkedText("headline", command.headline(), 255, false));
    candidate.setYearsExperience(command.yearsExperience());
    candidate.setOwner(AuthUtils.getUser());
    RecruitmentCandidate[] saved = new RecruitmentCandidate[1];
    write(() -> saved[0] = Beans.get(RecruitmentService.class).create(candidate));
    return ResponseConstructor.build(Response.Status.CREATED, "Candidate added", view(saved[0]));
  }

  @PUT
  @Path("/candidates/{id}/private")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Record the candidate's contact data, pay expectation and CV reference (write-only)", tags = {"IOETI recruitment"})
  @IoetiEndpoint
  public Response savePrivate(@PathParam("id") Long id, SavePrivate command) {
    RecruitmentCandidate candidate = writable(RecruitmentCandidate.class, id, command == null ? null : command.version());
    new SecurityCheck().createAccess(CandidatePrivateProfile.class).writeAccess(CandidatePrivateProfile.class).check();
    String email = checkedText("email", command.email(), 255, false);
    if (email != null && !EMAIL.matcher(email).matches()) throw ApiException.invalidField("email", "FORMAT", "Enter a valid e-mail address.");
    String phone = checkedText("phone", command.phone(), 20, false);
    if (phone != null && !PHONE.matcher(phone).matches()) throw ApiException.invalidField("phone", "FORMAT", "Enter a valid phone number.");
    if (command.expectedSalary() != null && (command.expectedSalary().signum() < 0 || command.expectedSalary().scale() > 2)) {
      throw ApiException.invalidField("expectedSalary", "RANGE", "Enter a positive amount with up to 2 decimals.");
    }
    CandidatePrivateProfile values = new CandidatePrivateProfile();
    values.setEmail(email);
    values.setPhone(phone);
    values.setExpectedSalary(command.expectedSalary());
    values.setCvReference(checkedText("cvReference", command.cvReference(), 255, false));
    write(() -> Beans.get(RecruitmentService.class).savePrivate(candidate, values));
    // the restricted values are never echoed back
    return ResponseConstructor.build(Response.Status.OK, "Private profile recorded", view(candidate));
  }

  @GET
  @Path("/candidates/{id}/private")
  @Operation(summary = "Read the restricted profile: blocked until D-04 and D-07", tags = {"IOETI recruitment"})
  @IoetiEndpoint
  public Response readPrivate(@PathParam("id") Long id) {
    RecordAccess.readable(RecruitmentCandidate.class, id);
    throw ApiException.policyBlocked("D-04 and D-07");
  }

  // --- consent -------------------------------------------------------------------------------------

  @GET
  @Path("/candidates/{id}/consents")
  @Operation(summary = "Consents recorded for a candidate", tags = {"IOETI recruitment"})
  @IoetiEndpoint
  public Response consents(@PathParam("id") Long id) {
    RecruitmentCandidate candidate = RecordAccess.readable(RecruitmentCandidate.class, id);
    new SecurityCheck().readAccess(CandidateConsent.class).check();
    List<ConsentView> rows = readable(CandidateConsent.class, new JPQLFilter("self.candidate.id = ?", candidate.getId()))
        .order("-id").fetch(200).stream().map(RecruitmentRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Consents", rows);
  }

  @POST
  @Path("/candidates/{id}/consents")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Record the candidate's consent to be submitted for one job order", tags = {"IOETI recruitment"})
  @IoetiEndpoint
  public Response recordConsent(@PathParam("id") Long id, RecordConsent command) {
    RecruitmentCandidate candidate = writable(RecruitmentCandidate.class, id, command == null ? null : command.version());
    new SecurityCheck().createAccess(CandidateConsent.class).check();
    ClientJobOrder order = readableOrder(command.jobOrderId());
    Integer method = command.method() == null ? null : CONSENT_METHODS.get(command.method());
    if (method == null) throw ApiException.invalidField("method", "UNAVAILABLE", "Use WRITTEN, EMAIL or RECORDED_CALL.");
    LocalDate givenOn = requiredDate("givenOn", command.givenOn());
    if (givenOn.isAfter(LocalDate.now())) throw ApiException.invalidField("givenOn", "RANGE", "Consent cannot be dated in the future.");
    CandidateConsent consent = new CandidateConsent();
    consent.setCandidate(candidate);
    consent.setJobOrder(order);
    consent.setMethodSelect(method);
    consent.setGivenOn(givenOn);
    consent.setEvidenceReference(checkedText("evidenceReference", command.evidenceReference(), 255, false));
    CandidateConsent[] saved = new CandidateConsent[1];
    write(() -> saved[0] = Beans.get(RecruitmentService.class).create(consent));
    return ResponseConstructor.build(Response.Status.CREATED, "Consent recorded", view(saved[0]));
  }

  @POST
  @Path("/consents/{id}/revoke")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Record that the candidate withdrew consent", tags = {"IOETI recruitment"})
  @IoetiEndpoint
  public Response revoke(@PathParam("id") Long id, VersionOnly command) {
    CandidateConsent consent = writable(CandidateConsent.class, id, command == null ? null : command.version());
    write(() -> Beans.get(RecruitmentService.class).revoke(consent));
    return ResponseConstructor.build(Response.Status.OK, "Consent revoked", view(consent));
  }

  // --- pipeline ------------------------------------------------------------------------------------

  @GET
  @Path("/job-orders/{id}/applications")
  @Operation(summary = "The job order's pipeline", tags = {"IOETI recruitment"})
  @IoetiEndpoint
  public Response applications(@PathParam("id") Long id) {
    ClientJobOrder order = RecordAccess.readable(ClientJobOrder.class, id);
    new SecurityCheck().readAccess(CandidateApplication.class).check();
    List<ApplicationView> rows = readable(CandidateApplication.class, new JPQLFilter("self.jobOrder.id = ?", order.getId()))
        .order("stageSelect").order("id").fetch(500).stream().map(RecruitmentRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Applications", rows);
  }

  @POST
  @Path("/job-orders/{id}/applications")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Add a candidate to the job order's pipeline", tags = {"IOETI recruitment"})
  @IoetiEndpoint
  public Response attach(@PathParam("id") Long id, Attach command) {
    ClientJobOrder order = writable(ClientJobOrder.class, id, command == null ? null : command.version());
    new SecurityCheck().createAccess(CandidateApplication.class).check();
    RecruitmentCandidate candidate = command.candidateId() == null || command.candidateId() <= 0
        ? null : JPA.find(RecruitmentCandidate.class, command.candidateId());
    if (candidate == null
        || !Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, RecruitmentCandidate.class, candidate.getId())) {
      throw ApiException.invalidField("candidateId", "UNAVAILABLE", "Choose a candidate you can see.");
    }
    CandidateApplication[] saved = new CandidateApplication[1];
    write(() -> saved[0] = Beans.get(RecruitmentService.class).attach(order, candidate));
    return ResponseConstructor.build(Response.Status.CREATED, "Added to pipeline", view(saved[0]));
  }

  @POST
  @Path("/applications/{id}/stage")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Screen, shortlist, reject or withdraw", tags = {"IOETI recruitment"})
  @IoetiEndpoint
  public Response move(@PathParam("id") Long id, MoveApplication command) {
    CandidateApplication application = writable(CandidateApplication.class, id, command == null ? null : command.version());
    Integer stage = command.stage() == null ? null : MOVABLE.get(command.stage());
    if (stage == null) throw ApiException.invalidField("stage", "UNAVAILABLE", "Choose a stage this command can set.");
    write(() -> Beans.get(RecruitmentService.class).move(application, stage));
    return ResponseConstructor.build(Response.Status.OK, "Stage changed", view(application));
  }

  @POST
  @Path("/applications/{id}/submit")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Record the submission of a shortlisted, consenting candidate to the client", tags = {"IOETI recruitment"})
  @IoetiEndpoint
  public Response submit(@PathParam("id") Long id, VersionOnly command) {
    CandidateApplication application = writable(CandidateApplication.class, id, command == null ? null : command.version());
    write(() -> Beans.get(RecruitmentService.class).submit(application));
    return ResponseConstructor.build(Response.Status.OK, "Submitted", view(application));
  }

  @POST
  @Path("/applications/{id}/share-cv")
  @Operation(summary = "Send the CV or private profile to the client: blocked until D-04", tags = {"IOETI recruitment"})
  @IoetiEndpoint
  public Response shareCv(@PathParam("id") Long id) {
    RecordAccess.writable(CandidateApplication.class, id);
    throw ApiException.policyBlocked("D-04");
  }

  @GET
  @Path("/applications/{id}/interviews")
  @Operation(summary = "Client interviews of an application", tags = {"IOETI recruitment"})
  @IoetiEndpoint
  public Response interviews(@PathParam("id") Long id) {
    CandidateApplication application = RecordAccess.readable(CandidateApplication.class, id);
    new SecurityCheck().readAccess(ClientInterview.class).check();
    List<InterviewView> rows = readable(ClientInterview.class, new JPQLFilter("self.application.id = ?", application.getId()))
        .order("round").fetch(50).stream().map(RecruitmentRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Interviews", rows);
  }

  @POST
  @Path("/applications/{id}/interviews")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Schedule a client interview", tags = {"IOETI recruitment"})
  @IoetiEndpoint
  public Response scheduleInterview(@PathParam("id") Long id, ScheduleInterview command) {
    CandidateApplication application = writable(CandidateApplication.class, id, command == null ? null : command.version());
    new SecurityCheck().createAccess(ClientInterview.class).check();
    if (command.round() == null || command.round() < 1 || command.round() > 10) {
      throw ApiException.invalidField("round", "RANGE", "Round must be between 1 and 10.");
    }
    LocalDateTime at;
    try {
      at = command.scheduledAt() == null ? null : LocalDateTime.parse(command.scheduledAt());
    } catch (DateTimeParseException e) {
      at = null;
    }
    if (at == null) throw ApiException.invalidField("scheduledAt", "FORMAT", "Use a date and time like 2026-11-01T10:00.");
    LocalDateTime when = at;
    ClientInterview[] saved = new ClientInterview[1];
    write(() -> saved[0] = Beans.get(RecruitmentService.class).interview(application, command.round(), when));
    return ResponseConstructor.build(Response.Status.CREATED, "Interview scheduled", view(saved[0]));
  }

  @POST
  @Path("/interviews/{id}/outcome")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Record the client's interview outcome", tags = {"IOETI recruitment"})
  @IoetiEndpoint
  public Response outcome(@PathParam("id") Long id, RecordOutcome command) {
    ClientInterview interview = writable(ClientInterview.class, id, command == null ? null : command.version());
    Integer outcome = command.outcome() == null ? null : OUTCOMES.get(command.outcome());
    if (outcome == null) throw ApiException.invalidField("outcome", "UNAVAILABLE", "Use PASSED, FAILED or NO_SHOW.");
    write(() -> Beans.get(RecruitmentService.class).outcome(interview, outcome));
    return ResponseConstructor.build(Response.Status.OK, "Outcome recorded", view(interview));
  }

  @POST
  @Path("/applications/{id}/offer")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Record the client's offer (terms are not stored: D-04)", tags = {"IOETI recruitment"})
  @IoetiEndpoint
  public Response offer(@PathParam("id") Long id, RecordOffer command) {
    CandidateApplication application = writable(CandidateApplication.class, id, command == null ? null : command.version());
    LocalDate on = requiredDate("offerDate", command.offerDate());
    write(() -> Beans.get(RecruitmentService.class).offer(application, on));
    return ResponseConstructor.build(Response.Status.OK, "Offer recorded", view(application));
  }

  @POST
  @Path("/applications/{id}/offer-answer")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Record the candidate's answer to the offer", tags = {"IOETI recruitment"})
  @IoetiEndpoint
  public Response offerAnswer(@PathParam("id") Long id, OfferAnswer command) {
    CandidateApplication application = writable(CandidateApplication.class, id, command == null ? null : command.version());
    if (command.accepted() == null) throw ApiException.invalidField("accepted", "REQUIRED", "Say whether the offer was accepted.");
    write(() -> Beans.get(RecruitmentService.class).offerAnswer(application, command.accepted()));
    return ResponseConstructor.build(Response.Status.OK, "Answer recorded", view(application));
  }

  // --- placements ----------------------------------------------------------------------------------

  @POST
  @Path("/applications/{id}/placement")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Confirm the placement of a candidate who accepted the offer", tags = {"IOETI recruitment"})
  @IoetiEndpoint
  public Response place(@PathParam("id") Long id, ConfirmPlacement command) {
    CandidateApplication application = writable(CandidateApplication.class, id, command == null ? null : command.version());
    new SecurityCheck().createAccess(Placement.class).check();
    LocalDate start = requiredDate("startDate", command.startDate());
    Placement[] saved = new Placement[1];
    write(() -> saved[0] = Beans.get(RecruitmentService.class).place(application, start));
    return ResponseConstructor.build(Response.Status.CREATED, "Placement confirmed", view(saved[0]));
  }

  @GET
  @Path("/job-orders/{id}/placements")
  @Operation(summary = "Placements of a job order with guarantee status and fee milestones", tags = {"IOETI recruitment"})
  @IoetiEndpoint
  public Response placements(@PathParam("id") Long id) {
    ClientJobOrder order = RecordAccess.readable(ClientJobOrder.class, id);
    new SecurityCheck().readAccess(Placement.class).check();
    List<PlacementView> rows = readable(Placement.class, new JPQLFilter("self.application.jobOrder.id = ?", order.getId()))
        .order("id").fetch(500).stream().map(RecruitmentRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Placements", rows);
  }

  @POST
  @Path("/placements/{id}/started")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Record that the candidate started work (fee milestone, idempotent)", tags = {"IOETI recruitment"})
  @IoetiEndpoint
  public Response started(@PathParam("id") Long id, RecordStart command) {
    Placement placement = RecordAccess.writable(Placement.class, id);
    LocalDate on = requiredDate("startedOn", command == null ? null : command.startedOn());
    RecruitmentFeeMilestone[] saved = new RecruitmentFeeMilestone[1];
    write(() -> saved[0] = Beans.get(RecruitmentService.class)
        .recordMilestone(placement, RecruitmentFeeMilestoneRepository.KIND_CANDIDATE_STARTED, on));
    return ResponseConstructor.build(Response.Status.OK, "Start recorded", view(placement));
  }

  @POST
  @Path("/placements/{id}/invoice")
  @Operation(summary = "Invoice the recruitment fee: blocked until D-04 and D-06", tags = {"IOETI recruitment"})
  @IoetiEndpoint
  public Response invoice(@PathParam("id") Long id) {
    RecordAccess.writable(Placement.class, id);
    throw ApiException.policyBlocked("D-04 and D-06");
  }

  @POST
  @Path("/placements/{id}/replacement")
  @Operation(summary = "Claim a guarantee replacement: blocked until D-04", tags = {"IOETI recruitment"})
  @IoetiEndpoint
  public Response replacement(@PathParam("id") Long id) {
    RecordAccess.writable(Placement.class, id);
    throw ApiException.policyBlocked("D-04");
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

  /** Unknown and unreadable job orders are refused identically. */
  private static ClientJobOrder readableOrder(Long id) {
    ClientJobOrder order = id == null || id <= 0 ? null : JPA.find(ClientJobOrder.class, id);
    if (order == null || !Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, ClientJobOrder.class, order.getId())) {
      throw ApiException.invalidField("jobOrderId", "UNAVAILABLE", "Choose a job order you can see.");
    }
    return order;
  }

  private static void write(Runnable command) {
    OptimisticLockConflicts.translate(command::run);
  }

  static String checkedText(String field, String value, int max, boolean required) {
    String text = value == null ? null : value.strip();
    if (text == null || text.isEmpty()) {
      if (required) throw ApiException.invalidField(field, "REQUIRED", "This field is required.");
      return null;
    }
    if (text.length() > max) {
      throw ApiException.invalidField(field, "TOO_LONG", "This field can have at most " + max + " characters.");
    }
    return text;
  }

  static LocalDate requiredDate(String field, String value) {
    try {
      if (value != null && !value.isBlank()) return LocalDate.parse(value);
    } catch (DateTimeParseException e) {
      // falls through to the field error
    }
    throw ApiException.invalidField(field, "FORMAT", "Use a date like 2026-11-01.");
  }

  static String name(Integer select, String... names) {
    return select == null || select < 1 || select > names.length ? null : names[select - 1];
  }

  static JobOrderView view(ClientJobOrder order) {
    JpaSecurity security = Beans.get(JpaSecurity.class);
    Partner client = order.getClient();
    boolean canReadClient = security.isPermitted(JpaSecurity.CAN_READ, Partner.class, client.getId());
    List<CandidateApplication> pipeline = Query.of(CandidateApplication.class).filter("self.jobOrder = ?1", order).fetch();
    long placed = pipeline.stream().filter(a -> a.getStageSelect() == CandidateApplicationRepository.STAGE_PLACED).count();
    long active = pipeline.stream().filter(a -> !RecruitmentService.isClosed(a.getStageSelect())).count();
    return new JobOrderView(order.getId(), order.getVersion(), order.getReference(),
        canReadClient ? client.getId() : null, canReadClient ? client.getName() : null, order.getTitle(), order.getHeadcount(),
        order.getLocation(), order.getRequirements(), name(order.getStatusSelect(), "OPEN", "ON_HOLD", "FILLED", "CLOSED"),
        active, placed, order.getRecruiter() != null && order.getRecruiter().equals(AuthUtils.getUser()),
        order.getRecruiter() == null ? null : order.getRecruiter().getName());
  }

  static CandidateView view(RecruitmentCandidate candidate) {
    return new CandidateView(candidate.getId(), candidate.getVersion(), candidate.getDisplayName(), candidate.getHeadline(),
        candidate.getYearsExperience(), RecruitmentService.privateProfile(candidate) != null,
        candidate.getOwner() != null && candidate.getOwner().equals(AuthUtils.getUser()));
  }

  static ConsentView view(CandidateConsent consent) {
    ClientJobOrder order = consent.getJobOrder();
    return new ConsentView(consent.getId(), consent.getVersion(), order.getId(), order.getReference(),
        name(consent.getMethodSelect(), "WRITTEN", "EMAIL", "RECORDED_CALL"), consent.getGivenOn(),
        consent.getEvidenceReference(), consent.getRevokedAt(), consent.getRevokedAt() == null);
  }

  static ApplicationView view(CandidateApplication application) {
    RecruitmentCandidate candidate = application.getCandidate();
    return new ApplicationView(application.getId(), application.getVersion(), application.getJobOrder().getId(),
        candidate.getId(), candidate.getDisplayName(), candidate.getHeadline(),
        name(application.getStageSelect(), STAGES), application.getSubmittedAt(), application.getOfferDate(),
        name(application.getOfferStatusSelect(), "PENDING", "ACCEPTED", "DECLINED"),
        RecruitmentService.validConsent(candidate, application.getJobOrder()) != null);
  }

  static InterviewView view(ClientInterview interview) {
    return new InterviewView(interview.getId(), interview.getVersion(), interview.getRound(), interview.getScheduledAt(),
        name(interview.getOutcomeSelect(), "PENDING", "PASSED", "FAILED", "NO_SHOW"));
  }

  static PlacementView view(Placement placement) {
    CandidateApplication application = placement.getApplication();
    List<String> milestones = Query.of(RecruitmentFeeMilestone.class).filter("self.placement = ?1", placement)
        .order("kindSelect").fetch().stream()
        .map(m -> name(m.getKindSelect(), "OFFER_ACCEPTED", "CANDIDATE_STARTED")).toList();
    return new PlacementView(placement.getId(), placement.getVersion(), application.getId(),
        application.getCandidate().getDisplayName(), placement.getStartDate(), "TERMS_PENDING_POLICY", milestones,
        "BLOCKED_BY_POLICY");
  }

  public record VersionOnly(Integer version) {}
  public record ChangeStatus(Integer version, String status) {}
  public record CreateJobOrder(
      String reference, Long clientId, String title, Integer headcount, String location, String requirements) {}
  public record CreateCandidate(String displayName, String headline, Integer yearsExperience) {}
  public record SavePrivate(Integer version, String email, String phone, BigDecimal expectedSalary, String cvReference) {}
  public record RecordConsent(Integer version, Long jobOrderId, String method, String givenOn, String evidenceReference) {}
  public record Attach(Integer version, Long candidateId) {}
  public record MoveApplication(Integer version, String stage) {}
  public record ScheduleInterview(Integer version, Integer round, String scheduledAt) {}
  public record RecordOutcome(Integer version, String outcome) {}
  public record RecordOffer(Integer version, String offerDate) {}
  public record OfferAnswer(Integer version, Boolean accepted) {}
  public record ConfirmPlacement(Integer version, String startDate) {}
  public record RecordStart(String startedOn) {}
  public record JobOrderView(
      Long id, Integer version, String reference, Long clientId, String clientName, String title, Integer headcount,
      String location, String requirements, String status, long activeCandidates, long placed, boolean recruitedByMe,
      String recruiterName) {}
  public record CandidateView(
      Long id, Integer version, String displayName, String headline, Integer yearsExperience, boolean privateProfileOnFile,
      boolean ownedByMe) {}
  public record ConsentView(
      Long id, Integer version, Long jobOrderId, String jobOrderReference, String method, LocalDate givenOn,
      String evidenceReference, LocalDateTime revokedAt, boolean active) {}
  public record ApplicationView(
      Long id, Integer version, Long jobOrderId, Long candidateId, String candidateName, String candidateHeadline,
      String stage, LocalDateTime submittedAt, LocalDate offerDate, String offerStatus, boolean consentOnFile) {}
  public record InterviewView(Long id, Integer version, Integer round, LocalDateTime scheduledAt, String outcome) {}
  public record PlacementView(
      Long id, Integer version, Long applicationId, String candidateName, LocalDate startDate, String guaranteeStatus,
      List<String> feeMilestones, String invoicingStatus) {}
}
