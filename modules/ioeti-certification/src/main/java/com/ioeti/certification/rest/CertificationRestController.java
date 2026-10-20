package com.ioeti.certification.rest;

import com.axelor.apps.base.db.Partner;
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
import com.ioeti.businessline.db.BusinessLine;
import com.ioeti.certification.db.AuditorQualification;
import com.ioeti.certification.db.CertificationAudit;
import com.ioeti.certification.db.CertificationCycle;
import com.ioeti.certification.db.Nonconformity;
import com.ioeti.certification.db.repo.CertificationAuditRepository;
import com.ioeti.certification.db.repo.NonconformityRepository;
import com.ioeti.certification.service.CertificationService;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.IoetiEndpoint;
import com.ioeti.core.api.RecordAccess;
import com.ioeti.core.web.OptimisticLockConflicts;
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
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Client certification (Wave 4b): auditor qualifications, certification cycles, the Stage 1 and
 * Stage 2 audit programme and nonconformities. Every record goes through native permissions and
 * record filters; unknown and unreadable ids answer the same 404.
 *
 * <p>Fail closed until policy D-02 is signed: the certification decision, certificate issue and
 * numbering, surveillance and recertification audits (their intervals depend on the scheme), and
 * impartiality rules beyond the competence check.
 */
@Path("/ioeti/certification")
@Produces(MediaType.APPLICATION_JSON)
public class CertificationRestController {

  static final Pattern REFERENCE = Pattern.compile("[A-Z0-9][A-Z0-9-]{1,29}");
  static final Map<String, Integer> AUDIT_TYPES = Map.of(
      "STAGE1", CertificationAuditRepository.TYPE_STAGE1, "STAGE2", CertificationAuditRepository.TYPE_STAGE2);
  static final List<String> POLICY_AUDIT_TYPES = List.of("SURVEILLANCE", "RECERTIFICATION");
  static final Map<String, Integer> GRADES = Map.of(
      "MAJOR", NonconformityRepository.GRADE_MAJOR, "MINOR", NonconformityRepository.GRADE_MINOR,
      "OBSERVATION", NonconformityRepository.GRADE_OBSERVATION);
  static final int MAX_TEXT = 4000;

  // --- auditor competence --------------------------------------------------------------------------

  @GET
  @Path("/qualifications")
  @Operation(summary = "Auditor qualifications the caller may read", tags = {"IOETI certification"})
  @IoetiEndpoint
  public Response qualifications() {
    new SecurityCheck().readAccess(AuditorQualification.class).check();
    List<QualificationView> rows = readable(AuditorQualification.class, null).order("validUntil").fetch(500).stream()
        .map(CertificationRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Qualifications", rows);
  }

  @GET
  @Path("/qualifications/candidates")
  @Operation(summary = "Active users who can be recorded as auditors (callers who may record qualifications)", tags = {"IOETI certification"})
  @IoetiEndpoint
  public Response auditorCandidates() {
    // only people allowed to record qualifications see this internal directory (id and name only)
    new SecurityCheck().createAccess(AuditorQualification.class).check();
    List<AuditorView> rows = Query.of(User.class).filter("self.blocked IS NULL OR self.blocked = false")
        .order("name").fetch(500).stream().map(u -> new AuditorView(u.getId(), u.getName())).toList();
    return ResponseConstructor.build(Response.Status.OK, "Auditor candidates", rows);
  }

  @POST
  @Path("/qualifications")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Record an auditor's qualification for a standard", tags = {"IOETI certification"})
  @IoetiEndpoint
  public Response createQualification(CreateQualification command) {
    if (command == null) throw ApiException.badRequest("Qualification details are required.");
    new SecurityCheck().createAccess(AuditorQualification.class).check();
    User auditor = command.auditorId() == null || command.auditorId() <= 0 ? null : JPA.find(User.class, command.auditorId());
    if (auditor == null || Boolean.TRUE.equals(auditor.getBlocked())) {
      throw ApiException.invalidField("auditorId", "UNAVAILABLE", "Choose an active user.");
    }
    BusinessLine standard = standard(command.standardCode());
    LocalDate from = requiredDate("validFrom", command.validFrom());
    LocalDate until = requiredDate("validUntil", command.validUntil());
    if (until.isBefore(from)) {
      throw ApiException.invalidField("validUntil", "RANGE", "The end of validity cannot be before its start.");
    }
    AuditorQualification qualification = new AuditorQualification();
    qualification.setAuditor(auditor);
    qualification.setBusinessLine(standard);
    qualification.setValidFrom(from);
    qualification.setValidUntil(until);
    qualification.setEvidenceReference(checkedText("evidenceReference", command.evidenceReference(), 255, false));
    AuditorQualification[] saved = new AuditorQualification[1];
    write(() -> saved[0] = Beans.get(CertificationService.class).create(qualification));
    return ResponseConstructor.build(Response.Status.CREATED, "Qualification recorded", view(saved[0]));
  }

  // --- cycles --------------------------------------------------------------------------------------

  static final List<String> PHASES = List.of("STAGE1_PENDING", "STAGE2_PENDING", "FINDINGS_OPEN", "READY_FOR_DECISION");

  @GET
  @Path("/cycles")
  @Operation(summary = "Certification cycles the caller may read: search, filters and paging", tags = {"IOETI certification"})
  @IoetiEndpoint
  public Response cycles(
      @QueryParam("q") String q, @QueryParam("standardCode") String standardCode,
      @QueryParam("phase") String phase, @QueryParam("mine") Boolean mine,
      @QueryParam("limit") Integer requestedLimit, @QueryParam("offset") Integer requestedOffset) {
    new SecurityCheck().readAccess(CertificationCycle.class).check();
    int limit = requestedLimit == null ? 25 : requestedLimit;
    int offset = requestedOffset == null ? 0 : requestedOffset;
    if (limit < 1 || limit > 100 || offset < 0 || offset > 10000) {
      throw ApiException.badRequest("Invalid pagination parameters.");
    }
    if (phase != null && !PHASES.contains(phase)) {
      throw ApiException.invalidField("phase", "UNAVAILABLE", "Unknown phase.");
    }
    String search = checkedText("q", q, 100, false);
    // positional "?" parameters: Axelor renumbers them together with the permission filter's own
    List<String> conditions = new ArrayList<>();
    List<Object> params = new ArrayList<>();
    if (search != null) {
      conditions.add("(LOWER(self.reference) LIKE ? OR LOWER(self.client.name) LIKE ?)");
      String like = "%" + search.toLowerCase().replace("%", "").replace("_", "") + "%";
      params.add(like);
      params.add(like);
    }
    if (standardCode != null && !standardCode.isBlank()) {
      conditions.add("self.businessLine.code = ?");
      params.add(standardCode.strip());
    }
    if (Boolean.TRUE.equals(mine)) {
      conditions.add("self.manager = ?");
      params.add(AuthUtils.getUser());
    }
    Filter where = conditions.isEmpty() ? null : new JPQLFilter(String.join(" AND ", conditions), params.toArray());
    Query<CertificationCycle> query = readable(CertificationCycle.class, where).order("-id");
    // the phase is derived from audits and findings, so it filters after the query (bounded page)
    List<CycleView> rows = (phase == null ? query.fetch(limit, offset) : query.fetch(500)).stream()
        .map(CertificationRestController::view)
        .filter(v -> phase == null || phase.equals(v.phase()))
        .skip(phase == null ? 0 : offset).limit(limit).toList();
    return ResponseConstructor.build(Response.Status.OK, "Cycles", rows);
  }

  @GET
  @Path("/cycles/{id}/eligible-auditors")
  @Operation(summary = "Auditors qualified for the cycle's standard on a date", tags = {"IOETI certification"})
  @IoetiEndpoint
  public Response eligibleAuditors(@PathParam("id") Long id, @QueryParam("date") String date) {
    CertificationCycle cycle = RecordAccess.readable(CertificationCycle.class, id);
    LocalDate on = requiredDate("date", date);
    List<AuditorView> rows = CertificationService.eligibleAuditors(cycle.getBusinessLine(), on).stream()
        .map(u -> new AuditorView(u.getId(), u.getName())).toList();
    return ResponseConstructor.build(Response.Status.OK, "Eligible auditors", rows);
  }

  @GET
  @Path("/cycles/{id}/timeline")
  @Operation(summary = "Audit history of a cycle: audits, findings and responses in time order", tags = {"IOETI certification"})
  @IoetiEndpoint
  public Response timeline(@PathParam("id") Long id) {
    CertificationCycle cycle = RecordAccess.readable(CertificationCycle.class, id);
    JpaSecurity security = Beans.get(JpaSecurity.class);
    List<TimelineEvent> events = new ArrayList<>();
    events.add(new TimelineEvent(cycle.getCreatedOn(), "CYCLE_OPENED", cycle.getReference(), null));
    if (security.isPermitted(JpaSecurity.CAN_READ, CertificationAudit.class)) {
      for (CertificationAudit audit : readable(CertificationAudit.class, new JPQLFilter("self.cycle.id = " + cycle.getId())).fetch(100)) {
        String stage = name(audit.getTypeSelect(), "STAGE1", "STAGE2");
        events.add(new TimelineEvent(audit.getCreatedOn(), "AUDIT_PLANNED", stage, audit.getAuditor().getName()));
        if (audit.getStatusSelect() == CertificationAuditRepository.STATUS_COMPLETED && audit.getCompletedOn() != null) {
          events.add(new TimelineEvent(audit.getCompletedOn().atStartOfDay(), "AUDIT_COMPLETED", stage, audit.getAuditor().getName()));
        }
        if (audit.getStatusSelect() == CertificationAuditRepository.STATUS_CANCELLED) {
          events.add(new TimelineEvent(audit.getUpdatedOn(), "AUDIT_CANCELLED", stage, null));
        }
      }
    }
    if (security.isPermitted(JpaSecurity.CAN_READ, Nonconformity.class)) {
      for (Nonconformity nc : readable(Nonconformity.class, new JPQLFilter("self.audit.cycle.id = " + cycle.getId())).fetch(500)) {
        String label = name(nc.getGradeSelect(), "MAJOR", "MINOR", "OBSERVATION") + (nc.getClause() == null ? "" : " " + nc.getClause());
        events.add(new TimelineEvent(nc.getCreatedOn(), "NC_RAISED", label, null));
        if (nc.getRespondedAt() != null) events.add(new TimelineEvent(nc.getRespondedAt(), "NC_RESPONDED", label, null));
        if (nc.getClosedAt() != null) events.add(new TimelineEvent(nc.getClosedAt(), "NC_CLOSED", label, null));
      }
    }
    events.sort(Comparator.comparing(TimelineEvent::at, Comparator.nullsLast(Comparator.naturalOrder())).reversed());
    return ResponseConstructor.build(Response.Status.OK, "Timeline", events);
  }

  @GET
  @Path("/cycles/{id}")
  @Operation(summary = "One certification cycle with its programme status", tags = {"IOETI certification"})
  @IoetiEndpoint
  public Response cycle(@PathParam("id") Long id) {
    return ResponseConstructor.build(Response.Status.OK, "Cycle", view(RecordAccess.readable(CertificationCycle.class, id)));
  }

  @POST
  @Path("/cycles")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Open a certification cycle for a client and a standard", tags = {"IOETI certification"})
  @IoetiEndpoint
  public Response createCycle(CreateCycle command) {
    if (command == null) throw ApiException.badRequest("Cycle details are required.");
    new SecurityCheck().createAccess(CertificationCycle.class).check();
    String reference = command.reference() == null ? "" : command.reference().strip().toUpperCase();
    if (!REFERENCE.matcher(reference).matches()) {
      throw ApiException.invalidField("reference", "FORMAT", "Use 2 to 30 letters, digits or dashes.");
    }
    if (Query.of(CertificationCycle.class).filter("self.reference = ?", reference).count() > 0) {
      throw ApiException.invalidField("reference", "DUPLICATE", "Another cycle already uses this reference.");
    }
    Partner client = command.clientId() == null || command.clientId() <= 0 ? null : JPA.find(Partner.class, command.clientId());
    if (client == null || !Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, Partner.class, client.getId())) {
      throw ApiException.invalidField("clientId", "UNAVAILABLE", "Choose a client organization you can see.");
    }
    if (command.siteCount() != null && (command.siteCount() < 1 || command.siteCount() > 1000)) {
      throw ApiException.invalidField("siteCount", "RANGE", "Sites must be between 1 and 1000.");
    }
    CertificationCycle cycle = new CertificationCycle();
    cycle.setReference(reference);
    cycle.setClient(client);
    cycle.setBusinessLine(standard(command.standardCode()));
    cycle.setScope(checkedText("scope", command.scope(), MAX_TEXT, true));
    cycle.setSiteCount(command.siteCount());
    cycle.setManager(AuthUtils.getUser());
    CertificationCycle[] saved = new CertificationCycle[1];
    write(() -> saved[0] = Beans.get(CertificationService.class).create(cycle));
    return ResponseConstructor.build(Response.Status.CREATED, "Cycle opened", view(saved[0]));
  }

  @POST
  @Path("/cycles/{id}/decision")
  @Operation(summary = "Certification decision: blocked until the certification policy (D-02)", tags = {"IOETI certification"})
  @IoetiEndpoint
  public Response decision(@PathParam("id") Long id) {
    RecordAccess.writable(CertificationCycle.class, id);
    throw ApiException.policyBlocked("D-02");
  }

  @POST
  @Path("/cycles/{id}/certificate")
  @Operation(summary = "Issue a certificate: blocked until the certification policy (D-02)", tags = {"IOETI certification"})
  @IoetiEndpoint
  public Response certificate(@PathParam("id") Long id) {
    RecordAccess.writable(CertificationCycle.class, id);
    throw ApiException.policyBlocked("D-02");
  }

  // --- audit programme -----------------------------------------------------------------------------

  @GET
  @Path("/cycles/{id}/audits")
  @Operation(summary = "Audits of a cycle", tags = {"IOETI certification"})
  @IoetiEndpoint
  public Response audits(@PathParam("id") Long id) {
    CertificationCycle cycle = RecordAccess.readable(CertificationCycle.class, id);
    new SecurityCheck().readAccess(CertificationAudit.class).check();
    List<AuditView> rows = readable(CertificationAudit.class, new JPQLFilter("self.cycle.id = " + cycle.getId()))
        .order("typeSelect").order("id").fetch(100).stream().map(CertificationRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Audits", rows);
  }

  @POST
  @Path("/cycles/{id}/audits")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Plan the Stage 1 or Stage 2 audit with a qualified lead auditor", tags = {"IOETI certification"})
  @IoetiEndpoint
  public Response planAudit(@PathParam("id") Long id, PlanAudit command) {
    CertificationCycle cycle = writable(CertificationCycle.class, id, command == null ? null : command.version());
    new SecurityCheck().createAccess(CertificationAudit.class).check();
    if (command.type() != null && POLICY_AUDIT_TYPES.contains(command.type())) {
      // their timing depends on the scheme and on an issued certificate
      throw ApiException.policyBlocked("D-02");
    }
    Integer type = command.type() == null ? null : AUDIT_TYPES.get(command.type());
    if (type == null) throw ApiException.invalidField("type", "UNAVAILABLE", "Use STAGE1 or STAGE2.");
    LocalDate planned = requiredDate("plannedDate", command.plannedDate());
    User auditor = command.auditorId() == null || command.auditorId() <= 0 ? null : JPA.find(User.class, command.auditorId());
    if (auditor == null || Boolean.TRUE.equals(auditor.getBlocked())) {
      throw ApiException.invalidField(
          "auditorId", "NOT_QUALIFIED", "Choose an auditor qualified for this standard on the planned date.");
    }
    CertificationAudit[] saved = new CertificationAudit[1];
    write(() -> saved[0] = Beans.get(CertificationService.class).plan(cycle, type, planned, auditor));
    return ResponseConstructor.build(Response.Status.CREATED, "Audit planned", view(saved[0]));
  }

  @POST
  @Path("/audits/{id}/complete")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Record that a planned audit took place", tags = {"IOETI certification"})
  @IoetiEndpoint
  public Response complete(@PathParam("id") Long id, CompleteAudit command) {
    CertificationAudit audit = writable(CertificationAudit.class, id, command == null ? null : command.version());
    LocalDate on = requiredDate("completedOn", command.completedOn());
    write(() -> Beans.get(CertificationService.class).complete(audit, on));
    return ResponseConstructor.build(Response.Status.OK, "Audit completed", view(audit));
  }

  @POST
  @Path("/audits/{id}/cancel")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Cancel a planned audit", tags = {"IOETI certification"})
  @IoetiEndpoint
  public Response cancelAudit(@PathParam("id") Long id, VersionOnly command) {
    CertificationAudit audit = writable(CertificationAudit.class, id, command == null ? null : command.version());
    write(() -> Beans.get(CertificationService.class).cancel(audit));
    return ResponseConstructor.build(Response.Status.OK, "Audit cancelled", view(audit));
  }

  // --- nonconformities -----------------------------------------------------------------------------

  @GET
  @Path("/audits/{id}/nonconformities")
  @Operation(summary = "Nonconformities raised at an audit", tags = {"IOETI certification"})
  @IoetiEndpoint
  public Response nonconformities(@PathParam("id") Long id) {
    CertificationAudit audit = RecordAccess.readable(CertificationAudit.class, id);
    new SecurityCheck().readAccess(Nonconformity.class).check();
    List<NonconformityView> rows = readable(Nonconformity.class, new JPQLFilter("self.audit.id = " + audit.getId()))
        .order("gradeSelect").order("id").fetch(500).stream().map(CertificationRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Nonconformities", rows);
  }

  @POST
  @Path("/audits/{id}/nonconformities")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Raise a nonconformity (major, minor or observation)", tags = {"IOETI certification"})
  @IoetiEndpoint
  public Response raise(@PathParam("id") Long id, RaiseNonconformity command) {
    CertificationAudit audit = writable(CertificationAudit.class, id, command == null ? null : command.version());
    new SecurityCheck().createAccess(Nonconformity.class).check();
    Integer grade = command.grade() == null ? null : GRADES.get(command.grade());
    if (grade == null) throw ApiException.invalidField("grade", "UNAVAILABLE", "Use MAJOR, MINOR or OBSERVATION.");
    String clause = checkedText("clause", command.clause(), 20, false);
    String statement = checkedText("statement", command.statement(), MAX_TEXT, true);
    Nonconformity[] saved = new Nonconformity[1];
    write(() -> saved[0] = Beans.get(CertificationService.class).raise(audit, grade, clause, statement));
    return ResponseConstructor.build(Response.Status.CREATED, "Nonconformity raised", view(saved[0]));
  }

  @POST
  @Path("/nonconformities/{id}/respond")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Record the client's correction and corrective action", tags = {"IOETI certification"})
  @IoetiEndpoint
  public Response respond(@PathParam("id") Long id, Respond command) {
    Nonconformity nc = writable(Nonconformity.class, id, command == null ? null : command.version());
    String response = checkedText("response", command.response(), MAX_TEXT, true);
    write(() -> Beans.get(CertificationService.class).respond(nc, response));
    return ResponseConstructor.build(Response.Status.OK, "Response recorded", view(nc));
  }

  @POST
  @Path("/nonconformities/{id}/close")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Close a nonconformity after the response is accepted", tags = {"IOETI certification"})
  @IoetiEndpoint
  public Response close(@PathParam("id") Long id, VersionOnly command) {
    Nonconformity nc = writable(Nonconformity.class, id, command == null ? null : command.version());
    write(() -> Beans.get(CertificationService.class).close(nc));
    return ResponseConstructor.build(Response.Status.OK, "Nonconformity closed", view(nc));
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

  /** Unknown, unreadable and non-active standards are refused identically. */
  private static BusinessLine standard(String code) {
    BusinessLine line = code == null ? null
        : Query.of(BusinessLine.class).filter("self.code = ? AND self.statusSelect = 2", code.strip()).fetchOne();
    if (line == null || !Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, BusinessLine.class, line.getId())) {
      throw ApiException.invalidField("standardCode", "UNAVAILABLE", "Choose an active standard (business line).");
    }
    return line;
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

  static QualificationView view(AuditorQualification q) {
    return new QualificationView(q.getId(), q.getAuditor().getId(), q.getAuditor().getName(),
        q.getBusinessLine().getCode(), q.getValidFrom(), q.getValidUntil(), q.getEvidenceReference());
  }

  static CycleView view(CertificationCycle cycle) {
    JpaSecurity security = Beans.get(JpaSecurity.class);
    Partner client = cycle.getClient();
    boolean canReadClient = security.isPermitted(JpaSecurity.CAN_READ, Partner.class, client.getId());
    return new CycleView(cycle.getId(), cycle.getVersion(), cycle.getReference(),
        canReadClient ? client.getId() : null, canReadClient ? client.getName() : null,
        cycle.getBusinessLine().getCode(), cycle.getScope(), cycle.getSiteCount(),
        CertificationService.openMajors(cycle), CertificationService.readyForDecision(cycle), "BLOCKED_BY_POLICY",
        cycle.getManager() != null && cycle.getManager().equals(AuthUtils.getUser()),
        CertificationService.phase(cycle), CertificationService.decisionBlockers(cycle),
        cycle.getManager() == null ? null : cycle.getManager().getName());
  }

  static AuditView view(CertificationAudit audit) {
    return new AuditView(audit.getId(), audit.getVersion(), name(audit.getTypeSelect(), "STAGE1", "STAGE2"),
        audit.getPlannedDate(), audit.getAuditor().getId(), audit.getAuditor().getName(),
        name(audit.getStatusSelect(), "PLANNED", "COMPLETED", "CANCELLED"), audit.getCompletedOn());
  }

  static NonconformityView view(Nonconformity nc) {
    return new NonconformityView(nc.getId(), nc.getVersion(), name(nc.getGradeSelect(), "MAJOR", "MINOR", "OBSERVATION"),
        nc.getClause(), nc.getStatement(), nc.getClientResponse(),
        name(nc.getStatusSelect(), "OPEN", "RESPONDED", "CLOSED"), nc.getCreatedOn(), nc.getRespondedAt(), nc.getClosedAt());
  }

  public record VersionOnly(Integer version) {}
  public record CreateQualification(
      Long auditorId, String standardCode, String validFrom, String validUntil, String evidenceReference) {}
  public record CreateCycle(String reference, Long clientId, String standardCode, String scope, Integer siteCount) {}
  public record PlanAudit(Integer version, String type, String plannedDate, Long auditorId) {}
  public record CompleteAudit(Integer version, String completedOn) {}
  public record RaiseNonconformity(Integer version, String grade, String clause, String statement) {}
  public record Respond(Integer version, String response) {}
  public record QualificationView(
      Long id, Long auditorId, String auditorName, String standardCode, LocalDate validFrom, LocalDate validUntil,
      String evidenceReference) {}
  public record CycleView(
      Long id, Integer version, String reference, Long clientId, String clientName, String standardCode, String scope,
      Integer siteCount, long openMajors, boolean readyForDecision, String decisionStatus, boolean managedByMe,
      String phase, List<String> decisionBlockers, String managerName) {}
  public record AuditorView(Long id, String name) {}
  public record TimelineEvent(LocalDateTime at, String kind, String label, String actorName) {}
  public record AuditView(
      Long id, Integer version, String type, LocalDate plannedDate, Long auditorId, String auditorName, String status,
      LocalDate completedOn) {}
  public record NonconformityView(
      Long id, Integer version, String grade, String clause, String statement, String clientResponse, String status,
      LocalDateTime raisedAt, LocalDateTime respondedAt, LocalDateTime closedAt) {}
}
