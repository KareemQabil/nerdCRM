package com.ioeti.operations.rest;

import com.axelor.apps.base.db.Company;
import com.axelor.apps.base.db.Partner;
import com.axelor.apps.base.service.app.AppBaseService;
import com.axelor.apps.project.db.Project;
import com.axelor.apps.quality.db.QIAction;
import com.axelor.apps.quality.db.QIAnalysis;
import com.axelor.apps.quality.db.QIAnalysisCause;
import com.axelor.apps.quality.db.QIAnalysisMethod;
import com.axelor.apps.quality.db.QIAnalysisMethodItem;
import com.axelor.apps.quality.db.QICause;
import com.axelor.apps.quality.db.QIDefault;
import com.axelor.apps.quality.db.QIDetection;
import com.axelor.apps.quality.db.QIIdentification;
import com.axelor.apps.quality.db.QIProcess;
import com.axelor.apps.quality.db.QIResolutionDefault;
import com.axelor.apps.quality.db.QIStatus;
import com.axelor.apps.quality.db.QualityImprovement;
import com.axelor.apps.quality.db.repo.QIDetectionRepository;
import com.axelor.apps.quality.db.repo.QualityImprovementRepository;
import com.axelor.auth.AuthUtils;
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
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.IoetiEndpoint;
import com.ioeti.core.api.RecordAccess;
import com.ioeti.core.web.OptimisticLockConflicts;
import com.ioeti.operations.db.CorrectiveAction;
import com.ioeti.operations.db.repo.CorrectiveActionRepository;
import com.ioeti.operations.service.QualityService;
import com.ioeti.operations.service.QualityService.Responsible;
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
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;

/**
 * Quality issues and corrective actions from the platform: raise an issue (where it was found, how grave,
 * what happened, for which client or engagement), plan it (owner, objective, how effectiveness is judged,
 * the window), assign actions with due dates, judge effectiveness and move it through the company's own
 * statuses. Native quality-improvement permissions decide on every call. Until an administrator has set up
 * the statuses, detections and issue types, nothing can be raised (422 SETUP_REQUIRED). Root-cause analysis
 * follows one of the company's analysis methods: causes are chosen from that method's branches and attributed to
 * one of the company's processes; until they are set up no cause can be recorded (422 SETUP_REQUIRED). Nothing
 * is sent to a client or supplier (D-10).
 */
@Path("/ioeti/quality")
@Produces(MediaType.APPLICATION_JSON)
public class QualityRestController {

  @GET
  @Operation(summary = "Quality issues the caller may read: open (default), closed or all; mine = I own the plan or an open action", tags = {"IOETI quality"})
  @IoetiEndpoint
  public Response list(@QueryParam("state") String state, @QueryParam("mine") Boolean mine) {
    new SecurityCheck().readAccess(QualityImprovement.class).check();
    List<String> where = new ArrayList<>(List.of("self.type = ?"));
    List<Object> params = new ArrayList<>(List.of(QualityImprovementRepository.TYPE_SYSTEM));
    String s = state == null || state.isBlank() ? "open" : state.strip();
    switch (s) {
      case "open" -> where.add("((self.qiStatus.isClosedStatus = false OR self.qiStatus.isClosedStatus IS NULL) AND (self.qiStatus.isCancelledStatus = false OR self.qiStatus.isCancelledStatus IS NULL))");
      case "closed" -> where.add("(self.qiStatus.isClosedStatus = TRUE OR self.qiStatus.isCancelledStatus = TRUE)");
      case "all" -> { }
      default -> throw ApiException.invalidField("state", "UNAVAILABLE", "Use open, closed or all.");
    }
    if (Boolean.TRUE.equals(mine)) {
      where.add("(self.qiAnalysis.planOwner = ? OR EXISTS (SELECT a FROM CorrectiveAction a WHERE a.improvement = self AND a.owner = ? AND a.statusSelect = ?))");
      params.add(AuthUtils.getUser()); params.add(AuthUtils.getUser()); params.add(CorrectiveActionRepository.STATUS_OPEN);
    }
    LocalDate today = today();
    List<QualityIssueView> rows = readable(QualityImprovement.class, new JPQLFilter(String.join(" AND ", where), params.toArray()))
        .order("-id").fetch(300).stream().map(qi -> view(qi, today)).toList();
    return ResponseConstructor.build(Response.Status.OK, "Quality issues", rows);
  }

  @GET
  @Path("/{id}")
  @Operation(summary = "One quality issue with its plan, effectiveness check and actions", tags = {"IOETI quality"})
  @IoetiEndpoint
  public Response get(@PathParam("id") Long id) {
    QualityImprovement qi = system(RecordAccess.readable(QualityImprovement.class, id));
    return ResponseConstructor.build(Response.Status.OK, "Quality issue", detail(qi));
  }

  @GET
  @Path("/options")
  @Operation(summary = "What an issue can be raised with, and what the administrator still has to set up", tags = {"IOETI quality"})
  @IoetiEndpoint
  public Response options() {
    new SecurityCheck().readAccess(QualityImprovement.class).check();
    Company company = company();
    List<QualityChoice> statuses = Query.of(QIStatus.class).order("sequence").order("id").fetch(100).stream()
        .map(st -> new QualityChoice(st.getId(), st.getName(), kind(st))).toList();
    List<QualityChoice> detections = Query.of(QIDetection.class).filter("self.isSystemOrigin = true").order("name").fetch(100).stream()
        .map(d -> new QualityChoice(d.getId(), d.getName(), origin(d))).toList();
    List<QualityChoice> issueTypes = company == null ? List.of() : Query.of(QIDefault.class)
        .filter("self.isSystemDefault = true AND self.company = ?1", company).order("name").fetch(100).stream()
        .map(t -> new QualityChoice(t.getId(), t.getName(), null)).toList();
    List<QualityChoice> actionTypes = company == null ? List.of() : Query.of(QIAction.class)
        .filter("self.isSystemAction = true AND self.company = ?1", company).order("name").fetch(100).stream()
        .map(t -> new QualityChoice(t.getId(), t.getName(), null)).toList();
    List<QualityChoice> processes = company == null ? List.of() : Query.of(QIProcess.class).filter("self.company = ?1", company).order("name")
        .fetch(200).stream().map(p -> new QualityChoice(p.getId(), p.getName(), null)).toList();
    // only methods with causes under their branches can be used for an analysis
    List<QualityChoice> methods = company == null ? List.of() : Query.of(QIAnalysisMethod.class)
        .filter("self.isSystem = true AND self.company = ?1 AND EXISTS (SELECT c FROM QICause c WHERE c.branch.analysisMethod = self)", company)
        .order("name").fetch(100).stream().map(m -> new QualityChoice(m.getId(), m.getName(), null)).toList();
    List<String> missing = new ArrayList<>();
    if (company == null) missing.add("COMPANY");
    if (statuses.stream().noneMatch(st -> "OPEN".equals(st.kind()))) missing.add("STATUSES");
    if (detections.isEmpty()) missing.add("DETECTIONS");
    if (issueTypes.isEmpty()) missing.add("ISSUE_TYPES");
    List<String> analysisMissing = new ArrayList<>();
    if (company == null) analysisMissing.add("COMPANY");
    if (methods.isEmpty()) analysisMissing.add("METHODS");
    if (processes.isEmpty()) analysisMissing.add("PROCESSES");
    if (company != null && company.getPartner() == null) analysisMissing.add("COMPANY_PARTY");
    return ResponseConstructor.build(Response.Status.OK, "Quality options",
        new QualityOptionsView(missing.isEmpty(), missing, statuses, detections, issueTypes, actionTypes,
            analysisMissing.isEmpty(), analysisMissing, processes, methods));
  }

  @GET
  @Path("/people")
  @Operation(summary = "Active people who can own a plan or an action (callers who may change quality issues)", tags = {"IOETI quality"})
  @IoetiEndpoint
  public Response people() {
    new SecurityCheck().writeAccess(QualityImprovement.class).check();
    return ResponseConstructor.build(Response.Status.OK, "People",
        Query.of(User.class).filter("self.blocked IS NULL OR self.blocked = false").order("name").fetch(300).stream()
            .map(u -> new QualityChoice(u.getId(), u.getName(), null)).toList());
  }

  @POST
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Raise a quality issue (native create permission on quality improvements)", tags = {"IOETI quality"})
  @IoetiEndpoint
  public Response raise(RaiseQualityIssue command) {
    new SecurityCheck().createAccess(QualityImprovement.class).check();
    if (command == null) throw ApiException.badRequest("The issue is required.");
    Company company = company();
    if (company == null) throw new ApiException(422, "SETUP_REQUIRED", "Choose your active company first.", null);
    if (Query.of(QIStatus.class).filter("(self.isClosedStatus = false OR self.isClosedStatus IS NULL) AND (self.isCancelledStatus = false OR self.isCancelledStatus IS NULL)").count() == 0) {
      throw new ApiException(422, "SETUP_REQUIRED", "No open quality status is set up; an administrator adds it under Quality set-up.", null);
    }
    String title = text("title", command.title(), 255, true);
    String details = text("details", command.details(), 4000, false);
    if (command.detectionId() == null) throw ApiException.invalidField("detectionId", "REQUIRED", "Choose where the issue was found.");
    QIDetection detection = Query.of(QIDetection.class).filter("self.isSystemOrigin = true AND self.id = ?1", command.detectionId()).fetchOne();
    if (detection == null) throw ApiException.invalidField("detectionId", "UNAVAILABLE", "Choose where the issue was found from the list.");
    if (command.issueTypeId() == null) throw ApiException.invalidField("issueTypeId", "REQUIRED", "Choose the kind of issue.");
    QIDefault issueType = Query.of(QIDefault.class).filter("self.isSystemDefault = true AND self.company = ?1 AND self.id = ?2", company, command.issueTypeId()).fetchOne();
    if (issueType == null) throw ApiException.invalidField("issueTypeId", "UNAVAILABLE", "Choose the kind of issue from the list.");
    int gravity = switch (command.gravity() == null ? "" : command.gravity().strip()) {
      case "CRITICAL" -> QualityService.CRITICAL; case "MAJOR" -> QualityService.MAJOR; case "MINOR" -> QualityService.MINOR;
      default -> throw ApiException.invalidField("gravity", "REQUIRED", "Choose critical, major or minor.");
    };
    Partner account = command.accountId() == null ? null : RecordAccess.readable(Partner.class, command.accountId());
    boolean external = detection.getOrigin() != null && detection.getOrigin() != QIDetectionRepository.ORIGIN_INTERNAL;
    if (external && account == null) {
      throw ApiException.invalidField("accountId", "REQUIRED", detection.getOrigin() == QIDetectionRepository.ORIGIN_SUPPLIER
          ? "Choose the supplier the issue came from." : "Choose the client who reported the issue.");
    }
    Project project = command.projectId() == null ? null : RecordAccess.readable(Project.class, command.projectId());
    LocalDateTime now = VisitRestController.now(command.zone());
    QualityImprovement[] saved = new QualityImprovement[1];
    try {
      OptimisticLockConflicts.translate(() -> saved[0] = Beans.get(QualityService.class)
          .raise(company, detection, issueType, gravity, title, details, account, project, now));
    } catch (ApiException e) {
      throw e;
    } catch (RuntimeException e) {
      ApiException refusal = QualityService.nativeRefusal(e);
      if (refusal != null) throw refusal;
      throw e;
    }
    return ResponseConstructor.build(Response.Status.CREATED, "Quality issue raised", detail(saved[0]));
  }

  @POST
  @Path("/{id}/plan")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Plan the issue: owner, objective, how effectiveness will be judged, earliest and latest dates", tags = {"IOETI quality"})
  @IoetiEndpoint
  public Response plan(@PathParam("id") Long id, PlanQualityIssue command) {
    QualityImprovement qi = versioned(id, command == null ? null : command.version());
    if (command.ownerId() == null) throw ApiException.invalidField("ownerId", "REQUIRED", "Choose who owns the plan.");
    User owner = person("ownerId", command.ownerId());
    LocalDate earliest = date("earliest", command.earliest()), latest = date("latest", command.latest());
    if (earliest != null && latest != null && latest.isBefore(earliest)) throw ApiException.invalidField("latest", "BEFORE_START", "The latest date must not be before the earliest.");
    String objective = text("objective", command.objective(), 4000, false), criteria = text("criteria", command.criteria(), 4000, false);
    return run(() -> Beans.get(QualityService.class).plan(qi, owner, objective, criteria, earliest, latest), "Plan saved");
  }

  @POST
  @Path("/{id}/status")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Move the issue to another of the company's quality statuses", tags = {"IOETI quality"})
  @IoetiEndpoint
  public Response move(@PathParam("id") Long id, MoveQualityIssue command) {
    QualityImprovement qi = versioned(id, command == null ? null : command.version());
    QIStatus status = command.statusId() == null ? null : JPA.find(QIStatus.class, command.statusId());
    if (status == null) throw ApiException.invalidField("statusId", "UNAVAILABLE", "Choose a status from the list.");
    return run(() -> Beans.get(QualityService.class).move(qi, status), "Status changed");
  }

  @POST
  @Path("/{id}/effectiveness")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Record whether the actions were effective, with what was checked", tags = {"IOETI quality"})
  @IoetiEndpoint
  public Response effectiveness(@PathParam("id") Long id, CheckEffectiveness command) {
    QualityImprovement qi = versioned(id, command == null ? null : command.version());
    if (command.effective() == null) throw ApiException.invalidField("effective", "REQUIRED", "Say whether the actions were effective.");
    String check = text("check", command.check(), 4000, true);
    LocalDateTime now = VisitRestController.now(command.zone());
    return run(() -> Beans.get(QualityService.class).checkEffectiveness(qi, command.effective(), check, now), "Effectiveness recorded");
  }

  @POST
  @Path("/{id}/actions")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Add a corrective action with its owner and due date (the issue's version)", tags = {"IOETI quality"})
  @IoetiEndpoint
  public Response addAction(@PathParam("id") Long id, AddCorrectiveAction command) {
    QualityImprovement qi = versioned(id, command == null ? null : command.version());
    String title = text("title", command.title(), 300, true);
    if (command.ownerId() == null) throw ApiException.invalidField("ownerId", "REQUIRED", "Choose who does the action.");
    User owner = person("ownerId", command.ownerId());
    LocalDate due = date("due", command.due());
    QIAction type = null;
    if (command.typeId() != null) {
      type = Query.of(QIAction.class).filter("self.isSystemAction = true AND self.company = ?1 AND self.id = ?2", qi.getCompany(), command.typeId()).fetchOne();
      if (type == null) throw ApiException.invalidField("typeId", "UNAVAILABLE", "Choose the kind of action from the list.");
    }
    QIAction chosen = type;
    OptimisticLockConflicts.translate(() -> Beans.get(QualityService.class).addAction(qi, title, owner, due, chosen));
    return ResponseConstructor.build(Response.Status.CREATED, "Action added", detail(qi));
  }

  @POST
  @Path("/{id}/actions/{actionId}/{command:done|reopen|cancel}")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Mark an action done (with what was done), reopen it or cancel it (the action's version)", tags = {"IOETI quality"})
  @IoetiEndpoint
  public Response actOn(@PathParam("id") Long id, @PathParam("actionId") Long actionId, @PathParam("command") String command,
      CorrectiveActionCommand body) {
    QualityImprovement qi = system(RecordAccess.writable(QualityImprovement.class, id));
    if (body == null || body.version() == null) throw ApiException.badRequest("Record version is required.");
    CorrectiveAction action = Query.of(CorrectiveAction.class).filter("self.id = ?1 AND self.improvement = ?2", actionId, qi).fetchOne();
    if (action == null) throw ApiException.notFound();
    ConflictChecker.checkVersion(action, body.version());
    String outcome = "done".equals(command) ? text("outcome", body.outcome(), 4000, false) : null;
    LocalDateTime now = VisitRestController.now(body.zone());
    OptimisticLockConflicts.translate(() -> Beans.get(QualityService.class).actOn(action, command, outcome, now));
    return ResponseConstructor.build(Response.Status.OK, "Action updated", detail(qi));
  }

  @POST
  @Path("/{id}/analysis/method")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Choose the company analysis method the root-cause analysis follows, or clear it, before causes are recorded (the issue's version)", tags = {"IOETI quality"})
  @IoetiEndpoint
  public Response method(@PathParam("id") Long id, ChooseAnalysisMethod command) {
    QualityImprovement qi = versioned(id, command == null ? null : command.version());
    Long current = qi.getAnalysisMethod() == null ? null : qi.getAnalysisMethod().getId();
    if (!QualityService.causes(qi).isEmpty() && !java.util.Objects.equals(command.methodId(), current)) {
      throw new ApiException(422, "HAS_CAUSES", "Causes are recorded with this method; remove them before changing it.", null);
    }
    QIAnalysisMethod method = null;
    if (command.methodId() != null) {
      method = Query.of(QIAnalysisMethod.class).filter("self.isSystem = true AND self.company = ?1 AND self.id = ?2", qi.getCompany(), command.methodId()).fetchOne();
      if (method == null) throw ApiException.invalidField("methodId", "UNAVAILABLE", "Choose an analysis method from the list.");
    }
    QIAnalysisMethod chosen = method;
    return run(() -> Beans.get(QualityService.class).method(qi, chosen), "Analysis method saved");
  }

  @POST
  @Path("/{id}/causes")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Record a root cause: a cause from the method's branches, the process where it arose, who it is attributed to (the organisation, the client or the supplier) and what was found (the issue's version)", tags = {"IOETI quality"})
  @IoetiEndpoint
  public Response addCause(@PathParam("id") Long id, RecordRootCause command) {
    QualityImprovement qi = versioned(id, command == null ? null : command.version());
    Company company = qi.getCompany();
    if (company == null || Query.of(QIProcess.class).filter("self.company = ?1", company).count() == 0
        || Query.of(QICause.class).filter("self.company = ?1", company).count() == 0) {
      throw new ApiException(422, "SETUP_REQUIRED", "No causes or processes are set up; an administrator adds them under Quality set-up.", null);
    }
    QIAnalysisMethod method = qi.getAnalysisMethod();
    if (method == null) throw new ApiException(422, "METHOD_REQUIRED", "Choose the analysis method first.", null);
    if (command.causeId() == null) throw ApiException.invalidField("causeId", "REQUIRED", "Choose the cause.");
    QICause cause = Query.of(QICause.class).filter("self.id = ?1 AND self.branch.analysisMethod = ?2", command.causeId(), method).fetchOne();
    if (cause == null) throw ApiException.invalidField("causeId", "UNAVAILABLE", "Choose a cause from the method's branches.");
    if (command.processId() == null) throw ApiException.invalidField("processId", "REQUIRED", "Choose the process where it arose.");
    QIProcess process = Query.of(QIProcess.class).filter("self.company = ?1 AND self.id = ?2", company, command.processId()).fetchOne();
    if (process == null) throw ApiException.invalidField("processId", "UNAVAILABLE", "Choose the process from the list.");
    Responsible responsible;
    try {
      responsible = Responsible.valueOf(command.responsible() == null ? "" : command.responsible().strip());
    } catch (IllegalArgumentException e) {
      throw ApiException.invalidField("responsible", "UNAVAILABLE", "Use INTERNAL, CUSTOMER or SUPPLIER.");
    }
    Partner party = QualityService.responsibleParty(qi, responsible);
    if (party == null) {
      throw switch (responsible) {
        case INTERNAL -> new ApiException(422, "SETUP_REQUIRED", "The company has no party record; an administrator sets it on the company.", null);
        case CUSTOMER -> ApiException.invalidField("responsible", "NO_CUSTOMER", "This issue has no client.");
        case SUPPLIER -> ApiException.invalidField("responsible", "NO_SUPPLIER", "This issue has no supplier.");
      };
    }
    String finding = text("finding", command.finding(), 4000, true);
    LocalDateTime now = VisitRestController.now(command.zone());
    QualityImprovement[] saved = new QualityImprovement[1];
    OptimisticLockConflicts.translate(() -> saved[0] = Beans.get(QualityService.class).addCause(qi, cause, process, responsible, party, finding, now));
    return ResponseConstructor.build(Response.Status.CREATED, "Cause recorded", detail(saved[0]));
  }

  @POST
  @Path("/{id}/causes/{causeId}/remove")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Remove a recorded root cause (the issue's version)", tags = {"IOETI quality"})
  @IoetiEndpoint
  public Response removeCause(@PathParam("id") Long id, @PathParam("causeId") Long causeId, VersionOnly command) {
    QualityImprovement qi = versioned(id, command == null ? null : command.version());
    QIAnalysisCause row = qi.getQiAnalysis() == null ? null
        : Query.of(QIAnalysisCause.class).filter("self.id = ?1 AND self.qiAnalysis = ?2", causeId, qi.getQiAnalysis()).fetchOne();
    if (row == null) throw ApiException.notFound();
    return run(() -> Beans.get(QualityService.class).removeCause(qi, row), "Cause removed");
  }

  // --- helpers -------------------------------------------------------------------------------------

  private Response run(java.util.function.Supplier<QualityImprovement> action, String message) {
    QualityImprovement[] saved = new QualityImprovement[1];
    OptimisticLockConflicts.translate(() -> saved[0] = action.get());
    return ResponseConstructor.build(Response.Status.OK, message, detail(saved[0]));
  }

  /** Only system (service) quality issues are handled here; product issues stay in the native screens. */
  private static QualityImprovement system(QualityImprovement qi) {
    if (qi.getType() == null || qi.getType() != QualityImprovementRepository.TYPE_SYSTEM) throw ApiException.notFound();
    return qi;
  }

  private static QualityImprovement versioned(Long id, Integer version) {
    if (version == null) throw ApiException.badRequest("Record version is required.");
    QualityImprovement qi = system(RecordAccess.writable(QualityImprovement.class, id));
    ConflictChecker.checkVersion(qi, version);
    return qi;
  }

  private static Company company() {
    User me = AuthUtils.getUser();
    if (me != null && me.getActiveCompany() != null) return me.getActiveCompany();
    List<Company> companies = Query.of(Company.class).fetch(2);
    return companies.size() == 1 ? companies.get(0) : null;
  }

  private static LocalDate today() {
    return Beans.get(AppBaseService.class).getTodayDate(company());
  }

  private static User person(String field, Long id) {
    User user = JPA.find(User.class, id);
    if (user == null || Boolean.TRUE.equals(user.getBlocked())) throw ApiException.invalidField(field, "UNAVAILABLE", "Choose an active person.");
    return user;
  }

  private static String text(String field, String value, int max, boolean required) {
    String text = value == null ? null : value.strip();
    if (text == null || text.isEmpty()) {
      if (required) throw ApiException.invalidField(field, "REQUIRED", "This field is required.");
      return null;
    }
    if (text.length() > max) throw ApiException.invalidField(field, "TOO_LONG", "This field can have at most " + max + " characters.");
    return text;
  }

  private static LocalDate date(String field, String value) {
    if (value == null || value.isBlank()) return null;
    try { return LocalDate.parse(value.strip()); }
    catch (DateTimeParseException e) { throw ApiException.invalidField(field, "FORMAT", "Use a date like 2026-11-30."); }
  }

  private static <T extends Model> Query<T> readable(Class<T> type, Filter condition) {
    Filter security = Beans.get(JpaSecurity.class).getFilter(JpaSecurity.CAN_READ, type);
    Filter combined = security == null ? condition : condition == null ? security : Filter.and(security, condition);
    return combined == null ? Query.of(type) : combined.build(type);
  }

  private static String kind(QIStatus status) {
    if (Boolean.TRUE.equals(status.getIsCancelledStatus())) return "CANCELLED";
    if (Boolean.TRUE.equals(status.getIsClosedStatus())) return "CLOSED";
    return "OPEN";
  }

  private static String origin(QIDetection d) {
    Integer o = d.getOrigin();
    if (o == null) return null;
    return o == QIDetectionRepository.ORIGIN_CUSTOMER ? "CUSTOMER" : o == QIDetectionRepository.ORIGIN_SUPPLIER ? "SUPPLIER" : "INTERNAL";
  }

  static QualityIssueView view(QualityImprovement qi, LocalDate today) {
    JpaSecurity security = Beans.get(JpaSecurity.class);
    QIIdentification identification = qi.getQiIdentification();
    Partner account = identification == null ? null
        : identification.getCustomerPartner() != null ? identification.getCustomerPartner() : identification.getSupplierPartner();
    boolean seeAccount = account != null && security.isPermitted(JpaSecurity.CAN_READ, Partner.class, account.getId());
    Project project = identification == null ? null : identification.getProject();
    boolean seeProject = project != null && security.isPermitted(JpaSecurity.CAN_READ, Project.class, project.getId());
    QIAnalysis analysis = qi.getQiAnalysis();
    User owner = analysis == null ? null : analysis.getPlanOwner();
    QIResolutionDefault line = QualityService.issue(qi);
    List<CorrectiveAction> actions = QualityService.actions(qi);
    long open = actions.stream().filter(a -> a.getStatusSelect() == CorrectiveActionRepository.STATUS_OPEN).count();
    long overdue = actions.stream().filter(a -> a.getStatusSelect() == CorrectiveActionRepository.STATUS_OPEN && a.getDueDate() != null
        && a.getDueDate().isBefore(today)).count();
    QIStatus status = qi.getQiStatus();
    QIDetection detection = qi.getQiDetection();
    return new QualityIssueView(qi.getId(), qi.getVersion(), qi.getSequence(), line == null ? null : line.getName(), QualityService.gravity(qi),
        status == null ? null : status.getId(), status == null ? null : status.getName(), status == null ? "OPEN" : kind(status),
        detection == null ? null : detection.getName(), detection == null ? null : origin(detection),
        line == null || line.getQiDefault() == null ? null : line.getQiDefault().getName(),
        seeAccount ? account.getId() : null, seeAccount ? account.getName() : null,
        seeProject ? project.getId() : null, seeProject ? project.getName() : null,
        owner == null ? null : owner.getId(), owner == null ? null : owner.getName(), owner != null && owner.equals(AuthUtils.getUser()),
        identification == null ? null : identification.getWrittenOn(),
        identification == null || identification.getWrittenBy() == null ? null : identification.getWrittenBy().getName(),
        analysis == null ? null : analysis.getLatestDate(), analysis == null || analysis.getAdvancement() == null ? 0 : analysis.getAdvancement(),
        open, overdue, QualityService.effectiveness(analysis));
  }

  static QualityIssueDetail detail(QualityImprovement qi) {
    LocalDate today = today();
    QIAnalysis analysis = qi.getQiAnalysis();
    QIResolutionDefault line = QualityService.issue(qi);
    User me = AuthUtils.getUser();
    List<CorrectiveActionView> actions = QualityService.actions(qi).stream().map(a -> new CorrectiveActionView(a.getId(), a.getVersion(),
        a.getTitle(), a.getOwner() == null ? null : a.getOwner().getId(), a.getOwner() == null ? null : a.getOwner().getName(),
        a.getOwner() != null && a.getOwner().equals(me), a.getDueDate(), a.getActionType() == null ? null : a.getActionType().getName(),
        QualityService.status(a), a.getStatusSelect() == CorrectiveActionRepository.STATUS_OPEN && a.getDueDate() != null && a.getDueDate().isBefore(today),
        a.getDoneAt(), a.getDoneNote())).toList();
    return new QualityIssueDetail(view(qi, today), line == null ? null : line.getDescription(),
        analysis == null ? null : analysis.getObjective(), analysis == null ? null : analysis.getEfficiencyCriteria(),
        analysis == null ? null : analysis.getEarliestDate(),
        analysis == null ? null : analysis.getAnalysisCheck(),
        analysis == null || analysis.getEfficiencyCheckedBy() == null ? null : analysis.getEfficiencyCheckedBy().getName(),
        analysis == null ? null : analysis.getEfficiencyCheckedOn(), actions, rootCause(qi));
  }

  /** The analysis method with its branches and their causes, and the causes recorded; a party is named only to those who may read it. */
  static RootCauseAnalysisView rootCause(QualityImprovement qi) {
    JpaSecurity security = Beans.get(JpaSecurity.class);
    QIAnalysisMethod method = qi.getAnalysisMethod();
    List<RootCauseBranchView> branches = method == null ? List.of() : Query.of(QIAnalysisMethodItem.class).filter("self.analysisMethod = ?1", method)
        .order("id").fetch(100).stream().map(b -> new RootCauseBranchView(b.getId(), b.getName(),
            Query.of(QICause.class).filter("self.branch = ?1", b).order("name").fetch(100).stream().map(c -> new QualityChoice(c.getId(), c.getName(), null)).toList()))
        .toList();
    List<RootCauseView> causes = QualityService.causes(qi).stream().map(c -> {
      Partner party = c.getResponsiblePartner();
      Responsible responsible = QualityService.responsible(c);
      boolean seeParty = party != null && responsible != Responsible.INTERNAL && security.isPermitted(JpaSecurity.CAN_READ, Partner.class, party.getId());
      QICause cause = c.getQiCause();
      return new RootCauseView(c.getId(), cause == null ? null : cause.getName(), cause == null || cause.getBranch() == null ? null : cause.getBranch().getName(),
          c.getQiProcess() == null ? null : c.getQiProcess().getName(), responsible.name(), seeParty ? party.getName() : null, c.getDescription());
    }).toList();
    QIAnalysis analysis = qi.getQiAnalysis();
    return new RootCauseAnalysisView(method == null ? null : method.getId(), method == null ? null : method.getName(), branches, causes,
        analysis == null || analysis.getCausesWrittenBy() == null ? null : analysis.getCausesWrittenBy().getName(),
        analysis == null ? null : analysis.getCausesWrittenOn());
  }

  public record RaiseQualityIssue(String title, String details, Long detectionId, Long issueTypeId, String gravity, Long accountId,
      Long projectId, String zone) {}

  public record PlanQualityIssue(Integer version, Long ownerId, String objective, String criteria, String earliest, String latest) {}

  public record MoveQualityIssue(Integer version, Long statusId) {}

  public record CheckEffectiveness(Integer version, Boolean effective, String check, String zone) {}

  public record AddCorrectiveAction(Integer version, String title, Long ownerId, String due, Long typeId) {}

  public record CorrectiveActionCommand(Integer version, String outcome, String zone) {}

  public record ChooseAnalysisMethod(Integer version, Long methodId) {}

  /** responsible: INTERNAL (the organisation, never a named person), CUSTOMER or SUPPLIER of the issue. */
  public record RecordRootCause(Integer version, Long causeId, Long processId, String responsible, String finding, String zone) {}

  public record VersionOnly(Integer version) {}

  /** A quality issue in the register; statusKind is OPEN, CLOSED or CANCELLED; origin INTERNAL, CUSTOMER or SUPPLIER. */
  public record QualityIssueView(Long id, Integer version, String reference, String title, String gravity, Long statusId, String statusName,
      String statusKind, String detection, String origin, String issueType, Long accountId, String accountName, Long projectId,
      String projectName, Long ownerId, String ownerName, boolean mine, LocalDateTime raisedAt, String raisedByName, LocalDate dueDate,
      int progress, long openActions, long overdueActions, String effectiveness) {}

  public record CorrectiveActionView(Long id, Integer version, String title, Long ownerId, String ownerName, boolean mine, LocalDate due,
      String type, String status, boolean overdue, LocalDateTime doneAt, String outcome) {}

  public record QualityIssueDetail(QualityIssueView issue, String details, String objective, String criteria, LocalDate earliest,
      String check, String checkedByName, LocalDateTime checkedAt, List<CorrectiveActionView> actions, RootCauseAnalysisView rootCause) {}

  /** A recorded cause; responsibleName is the client's or supplier's name (null for the organisation or if not readable). */
  public record RootCauseView(Long id, String cause, String branch, String process, String responsible, String responsibleName, String finding) {}

  /** A branch of the issue's analysis method and the causes that can be chosen under it. */
  public record RootCauseBranchView(Long id, String name, List<QualityChoice> causes) {}

  public record RootCauseAnalysisView(Long methodId, String methodName, List<RootCauseBranchView> branches, List<RootCauseView> causes,
      String writtenByName, LocalDateTime writtenAt) {}

  public record QualityChoice(Long id, String name, String kind) {}

  /**
   * analysisReady/analysisMissing: whether root causes can be recorded (COMPANY, METHODS with causes, PROCESSES,
   * COMPANY_PARTY); methods are those with causes under their branches.
   */
  public record QualityOptionsView(boolean ready, List<String> missing, List<QualityChoice> statuses, List<QualityChoice> detections,
      List<QualityChoice> issueTypes, List<QualityChoice> actionTypes, boolean analysisReady, List<String> analysisMissing,
      List<QualityChoice> processes, List<QualityChoice> methods) {}
}
