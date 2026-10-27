package com.ioeti.operations.rest;

import com.axelor.apps.base.db.Partner;
import com.axelor.apps.contract.db.Contract;
import com.axelor.apps.contract.db.repo.ContractRepository;
import com.axelor.apps.crm.db.Opportunity;
import com.axelor.apps.project.db.Project;
import com.axelor.apps.project.db.ProjectTask;
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
import com.axelor.team.db.Team;
import com.axelor.utils.api.ConflictChecker;
import com.axelor.utils.api.ResponseConstructor;
import com.axelor.utils.api.SecurityCheck;
import com.ioeti.businessline.db.BusinessLine;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.IoetiEndpoint;
import com.ioeti.core.api.RecordAccess;
import com.ioeti.core.web.OptimisticLockConflicts;
import com.ioeti.operations.db.HandoverEvent;
import com.ioeti.operations.db.HandoverItem;
import com.ioeti.operations.db.HandoverRequest;
import com.ioeti.operations.db.HandoverRequirement;
import com.ioeti.operations.db.repo.HandoverRequestRepository;
import com.ioeti.operations.service.OperationsService;
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
 * Handover and engagements (Wave 5). Sales request a handover of an active contract; operations
 * complete the review and accept, send back or reject it. Acceptance creates the engagement as a
 * native project. The trail is read-only; no endpoint changes or deletes an event.
 */
@Path("/ioeti/operations")
@Produces(MediaType.APPLICATION_JSON)
public class OperationsRestController {

  static final String[] STATUSES = {"SUBMITTED", "REWORK_REQUESTED", "ACCEPTED", "REJECTED"};
  static final String[] EVENTS = {"SUBMITTED", "ITEM_DONE", "REWORK_REQUESTED", "RESUBMITTED", "ACCEPTED", "REJECTED",
      "ENGAGEMENT_CREATED", "OWNER_CHANGED"};
  static final String[] REASONS = {"MISSING_SCOPE", "MISSING_DOCUMENTS", "NO_CAPACITY", "CLIENT_NOT_READY", "OTHER"};

  // --- configuration -------------------------------------------------------------------------------

  @GET
  @Path("/requirements")
  @Operation(summary = "Handover checklist requirements per business line", tags = {"IOETI operations"})
  @IoetiEndpoint
  public Response requirements(@QueryParam("businessLine") String code) {
    new SecurityCheck().readAccess(HandoverRequirement.class).check();
    Filter where = code == null || code.isBlank() ? new JPQLFilter("self.active = true")
        : new JPQLFilter("self.active = true AND self.businessLine.code = ?", code);
    List<RequirementView> rows = readable(HandoverRequirement.class, where).order("businessLine.code").order("sequence").order("id")
        .fetch(500).stream().map(OperationsRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Requirements", rows);
  }

  @POST
  @Path("/requirements")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Add a checklist requirement to a business line (administrators)", tags = {"IOETI operations"})
  @IoetiEndpoint
  public Response addRequirement(CreateRequirement command) {
    if (command == null) throw ApiException.badRequest("Requirement details are required.");
    new SecurityCheck().createAccess(HandoverRequirement.class).check();
    BusinessLine line = command.businessLineCode() == null ? null
        : Query.of(BusinessLine.class).filter("self.code = ?1", command.businessLineCode()).fetchOne();
    if (line == null || !Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, BusinessLine.class, line.getId())) {
      throw ApiException.invalidField("businessLineCode", "UNAVAILABLE", "Choose a business line you can see.");
    }
    String title = checkedText("title", command.title(), 255, true);
    if (Query.of(HandoverRequirement.class).filter("self.businessLine = ?1 AND LOWER(self.title) = ?2", line, title.toLowerCase()).count() > 0) {
      throw ApiException.invalidField("title", "DUPLICATE", "This business line already has this requirement.");
    }
    HandoverRequirement requirement = new HandoverRequirement();
    requirement.setBusinessLine(line);
    requirement.setTitle(title);
    requirement.setMandatory(!Boolean.FALSE.equals(command.mandatory()));
    requirement.setSequence(command.sequence() == null ? 10 : command.sequence());
    requirement.setActive(true);
    HandoverRequirement[] saved = new HandoverRequirement[1];
    write(() -> saved[0] = Beans.get(OperationsService.class).create(requirement));
    return ResponseConstructor.build(Response.Status.CREATED, "Requirement added", view(saved[0]));
  }

  @POST
  @Path("/requirements/{id}/retire")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Retire a requirement; handovers already submitted keep their copy", tags = {"IOETI operations"})
  @IoetiEndpoint
  public Response retire(@PathParam("id") Long id, VersionOnly command) {
    HandoverRequirement requirement = writable(HandoverRequirement.class, id, command == null ? null : command.version());
    requirement.setActive(false);
    write(() -> Beans.get(OperationsService.class).create(requirement));
    return ResponseConstructor.build(Response.Status.OK, "Requirement retired", view(requirement));
  }

  // --- handovers -----------------------------------------------------------------------------------

  @GET
  @Path("/handovers")
  @Operation(summary = "Handovers the caller may read, optionally by status", tags = {"IOETI operations"})
  @IoetiEndpoint
  public Response handovers(@QueryParam("status") String status) {
    new SecurityCheck().readAccess(HandoverRequest.class).check();
    Filter where = status == null || status.isBlank() ? null
        : new JPQLFilter("self.statusSelect = ?", select("status", status, STATUSES));
    List<HandoverView> rows = readable(HandoverRequest.class, where).order("-id").fetch(200).stream()
        .map(OperationsRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Handovers", rows);
  }

  @GET
  @Path("/handovers/{id}")
  @Operation(summary = "One handover with its checklist", tags = {"IOETI operations"})
  @IoetiEndpoint
  public Response handover(@PathParam("id") Long id) {
    return ResponseConstructor.build(Response.Status.OK, "Handover", view(RecordAccess.readable(HandoverRequest.class, id)));
  }

  @POST
  @Path("/handovers")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Request the handover of an active contract to operations", tags = {"IOETI operations"})
  @IoetiEndpoint
  public Response request(RequestHandover command) {
    if (command == null) throw ApiException.badRequest("Handover details are required.");
    new SecurityCheck().createAccess(HandoverRequest.class).check();
    Contract contract = command.contractId() == null || command.contractId() <= 0 ? null : JPA.find(Contract.class, command.contractId());
    if (contract == null || !Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, Contract.class, contract.getId())) {
      throw ApiException.invalidField("contractId", "UNAVAILABLE", "Choose a contract you can see.");
    }
    Opportunity opportunity = contract.getOpportunity();
    BusinessLine line = opportunity == null ? null : opportunity.getIoetiBusinessLine();
    if (line == null) {
      throw new ApiException(422, "BUSINESS_LINE_REQUIRED", "The contract's opportunity has no business line.", null);
    }
    HandoverRequest[] saved = new HandoverRequest[1];
    write(() -> saved[0] = Beans.get(OperationsService.class).request(contract, line));
    return ResponseConstructor.build(Response.Status.CREATED, "Handover requested", view(saved[0]));
  }

  @POST
  @Path("/items/{id}/complete")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Mark a checklist item done, with an optional evidence reference", tags = {"IOETI operations"})
  @IoetiEndpoint
  public Response completeItem(@PathParam("id") Long id, CompleteItem command) {
    HandoverItem item = writable(HandoverItem.class, id, command == null ? null : command.version());
    String evidence = checkedText("evidenceReference", command.evidenceReference(), 255, false);
    write(() -> Beans.get(OperationsService.class).complete(item, evidence));
    return ResponseConstructor.build(Response.Status.OK, "Item done", view(item.getHandover()));
  }

  @POST
  @Path("/handovers/{id}/rework")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Send the handover back to sales for rework, with a reason", tags = {"IOETI operations"})
  @IoetiEndpoint
  public Response rework(@PathParam("id") Long id, Decision command) {
    HandoverRequest handover = reviewable(id, command);
    int reason = select("reason", command.reason(), REASONS);
    write(() -> Beans.get(OperationsService.class).rework(handover, reason));
    return ResponseConstructor.build(Response.Status.OK, "Sent back for rework", view(handover));
  }

  @POST
  @Path("/handovers/{id}/resubmit")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Resubmit a handover after rework", tags = {"IOETI operations"})
  @IoetiEndpoint
  public Response resubmit(@PathParam("id") Long id, VersionOnly command) {
    HandoverRequest handover = writable(HandoverRequest.class, id, command == null ? null : command.version());
    write(() -> Beans.get(OperationsService.class).resubmit(handover));
    return ResponseConstructor.build(Response.Status.OK, "Resubmitted", view(handover));
  }

  @POST
  @Path("/handovers/{id}/reject")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Reject the handover, with a reason", tags = {"IOETI operations"})
  @IoetiEndpoint
  public Response reject(@PathParam("id") Long id, Decision command) {
    HandoverRequest handover = reviewable(id, command);
    int reason = select("reason", command.reason(), REASONS);
    write(() -> Beans.get(OperationsService.class).reject(handover, reason));
    return ResponseConstructor.build(Response.Status.OK, "Rejected", view(handover));
  }

  @POST
  @Path("/handovers/{id}/accept")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Accept the handover and create its engagement (native project)", tags = {"IOETI operations"})
  @IoetiEndpoint
  public Response accept(@PathParam("id") Long id, Accept command) {
    HandoverRequest handover = reviewable(id, command == null ? null : new Decision(command.version(), null));
    User lead = activeUser("operationsLeadId", command.operationsLeadId(), true);
    Team team = null;
    if (command.teamId() != null) {
      team = command.teamId() <= 0 ? null : JPA.find(Team.class, command.teamId());
      if (team == null) throw ApiException.invalidField("teamId", "UNAVAILABLE", "Choose an existing team.");
    }
    LocalDate start = command.startDate() == null || command.startDate().isBlank() ? LocalDate.now() : requiredDate("startDate", command.startDate());
    Team chosen = team;
    Project[] saved = new Project[1];
    write(() -> saved[0] = Beans.get(OperationsService.class).accept(handover, lead, chosen, start));
    return ResponseConstructor.build(Response.Status.CREATED, "Engagement created", view(saved[0]));
  }

  @GET
  @Path("/handovers/{id}/events")
  @Operation(summary = "The handover's append-only trail, oldest first", tags = {"IOETI operations"})
  @IoetiEndpoint
  public Response events(@PathParam("id") Long id) {
    HandoverRequest handover = RecordAccess.readable(HandoverRequest.class, id);
    new SecurityCheck().readAccess(HandoverEvent.class).check();
    List<EventView> rows = readable(HandoverEvent.class, new JPQLFilter("self.handover.id = ?", handover.getId()))
        .order("occurredAt").order("id").fetch(500).stream().map(OperationsRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Trail", rows);
  }

  @GET
  @Path("/ready-contracts")
  @Operation(summary = "Active contracts the caller may read that have no open or accepted handover", tags = {"IOETI operations"})
  @IoetiEndpoint
  public Response readyContracts() {
    new SecurityCheck().readAccess(Contract.class).createAccess(HandoverRequest.class).check();
    Filter where = new JPQLFilter("self.statusSelect = ? AND NOT EXISTS (SELECT 1 FROM HandoverRequest h WHERE h.contract = self AND h.statusSelect <> ?)",
        ContractRepository.ACTIVE_CONTRACT, HandoverRequestRepository.STATUS_REJECTED);
    List<ContractOption> rows = readable(Contract.class, where).order("-id").fetch(100).stream().map(c -> {
      Partner client = c.getPartner();
      boolean canReadClient = client != null && Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, Partner.class, client.getId());
      return new ContractOption(c.getId(), c.getContractId(), c.getName(), canReadClient ? client.getName() : null);
    }).toList();
    return ResponseConstructor.build(Response.Status.OK, "Contracts ready for handover", rows);
  }

  @GET
  @Path("/people")
  @Operation(summary = "Active users who can lead an engagement (callers who may create engagements only)", tags = {"IOETI operations"})
  @IoetiEndpoint
  public Response people() {
    new SecurityCheck().createAccess(Project.class).check();
    List<PersonOption> rows = Query.of(User.class).filter("self.blocked IS NULL OR self.blocked = false").order("name").fetch(200).stream()
        .map(u -> new PersonOption(u.getId(), u.getName())).toList();
    return ResponseConstructor.build(Response.Status.OK, "People", rows);
  }

  // --- engagements ---------------------------------------------------------------------------------

  @GET
  @Path("/engagements")
  @Operation(summary = "Engagements created from handovers that the caller may read", tags = {"IOETI operations"})
  @IoetiEndpoint
  public Response engagements(@QueryParam("mine") Boolean mine) {
    new SecurityCheck().readAccess(Project.class).check();
    Filter where = Boolean.TRUE.equals(mine) ? new JPQLFilter("self.ioetiHandover IS NOT NULL AND self.assignedTo = ?", AuthUtils.getUser())
        : new JPQLFilter("self.ioetiHandover IS NOT NULL");
    List<EngagementView> rows = readable(Project.class, where).order("-id").fetch(200).stream()
        .map(OperationsRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Engagements", rows);
  }

  @GET
  @Path("/engagements/{id}")
  @Operation(summary = "One engagement with progress", tags = {"IOETI operations"})
  @IoetiEndpoint
  public Response engagement(@PathParam("id") Long id) {
    return ResponseConstructor.build(Response.Status.OK, "Engagement", view(engagementOf(RecordAccess.readable(Project.class, id))));
  }

  @GET
  @Path("/engagements/{id}/tasks")
  @Operation(summary = "Operational tasks of an engagement", tags = {"IOETI operations"})
  @IoetiEndpoint
  public Response tasks(@PathParam("id") Long id) {
    Project project = engagementOf(RecordAccess.readable(Project.class, id));
    new SecurityCheck().readAccess(ProjectTask.class).check();
    List<TaskView> rows = readable(ProjectTask.class, new JPQLFilter("self.project.id = ?", project.getId()))
        .order("taskEndDate").order("id").fetch(500).stream().map(OperationsRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Tasks", rows);
  }

  @POST
  @Path("/engagements/{id}/tasks")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Add an operational task (the engagement version prevents double submission)", tags = {"IOETI operations"})
  @IoetiEndpoint
  public Response addTask(@PathParam("id") Long id, AddTask command) {
    Project project = engagementOf(writable(Project.class, id, command == null ? null : command.version()));
    new SecurityCheck().createAccess(ProjectTask.class).check();
    String name = checkedText("name", command.name(), 255, true);
    LocalDate due = command.dueDate() == null || command.dueDate().isBlank() ? null : requiredDate("dueDate", command.dueDate());
    User assignee = activeUser("assigneeId", command.assigneeId(), false);
    ProjectTask[] saved = new ProjectTask[1];
    write(() -> saved[0] = Beans.get(OperationsService.class).addTask(project, name, due, assignee));
    return ResponseConstructor.build(Response.Status.CREATED, "Task added", view(saved[0]));
  }

  @POST
  @Path("/tasks/{id}/complete")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Mark an operational task done", tags = {"IOETI operations"})
  @IoetiEndpoint
  public Response completeTask(@PathParam("id") Long id, VersionOnly command) {
    ProjectTask task = writable(ProjectTask.class, id, command == null ? null : command.version());
    engagementOf(task.getProject());
    write(() -> Beans.get(OperationsService.class).completeTask(task));
    return ResponseConstructor.build(Response.Status.OK, "Task done", view(task));
  }

  @POST
  @Path("/engagements/{id}/owner")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Transfer the engagement to another operations lead (recorded in the trail)", tags = {"IOETI operations"})
  @IoetiEndpoint
  public Response transfer(@PathParam("id") Long id, Transfer command) {
    Project project = engagementOf(writable(Project.class, id, command == null ? null : command.version()));
    User to = activeUser("userId", command.userId(), true);
    write(() -> Beans.get(OperationsService.class).transferOwnership(project, to));
    return ResponseConstructor.build(Response.Status.OK, "Ownership transferred", view(project));
  }

  // --- helpers -------------------------------------------------------------------------------------

  private static HandoverRequest reviewable(Long id, Decision command) {
    HandoverRequest handover = writable(HandoverRequest.class, id, command == null ? null : command.version());
    // reviewing creates the engagement: only callers who may create projects review handovers
    new SecurityCheck().createAccess(Project.class).check();
    return handover;
  }

  /** Only projects created from a handover belong to this API; others answer like a missing id. */
  private static Project engagementOf(Project project) {
    if (project == null || project.getIoetiHandover() == null) {
      throw new ApiException(404, "NOT_FOUND", "Record not found.", null);
    }
    return project;
  }

  private static User activeUser(String field, Long id, boolean required) {
    if (id == null && !required) return null;
    User user = id == null || id <= 0 ? null : JPA.find(User.class, id);
    if (user == null || Boolean.TRUE.equals(user.getBlocked())) {
      throw ApiException.invalidField(field, "UNAVAILABLE", "Choose an active user.");
    }
    return user;
  }

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

  private static String userName(User user) {
    return user == null ? null : user.getName();
  }

  static RequirementView view(HandoverRequirement r) {
    return new RequirementView(r.getId(), r.getVersion(), r.getBusinessLine().getCode(), r.getTitle(),
        Boolean.TRUE.equals(r.getMandatory()), r.getSequence());
  }

  static HandoverView view(HandoverRequest h) {
    JpaSecurity security = Beans.get(JpaSecurity.class);
    Contract contract = h.getContract();
    Partner client = contract.getPartner();
    boolean canReadClient = client != null && security.isPermitted(JpaSecurity.CAN_READ, Partner.class, client.getId());
    List<ItemView> items = Query.of(HandoverItem.class).filter("self.handover = ?1", h).order("sequence").order("id").fetch().stream()
        .map(i -> new ItemView(i.getId(), i.getVersion(), i.getTitle(), Boolean.TRUE.equals(i.getMandatory()),
            Boolean.TRUE.equals(i.getDone()), userName(i.getDoneBy()), i.getDoneAt(), i.getEvidenceReference())).toList();
    Project engagement = h.getEngagement();
    boolean canReadEngagement = engagement != null && security.isPermitted(JpaSecurity.CAN_READ, Project.class, engagement.getId());
    return new HandoverView(h.getId(), h.getVersion(), contract.getId(), contract.getContractId(), contract.getName(),
        canReadClient ? client.getId() : null, canReadClient ? client.getName() : null, h.getBusinessLine().getCode(),
        name(h.getStatusSelect(), STATUSES), userName(h.getRequestedBy()), userName(h.getReviewedBy()), userName(h.getOperationsLead()),
        h.getSubmittedAt(), h.getDecidedAt(), canReadEngagement ? engagement.getId() : null, items,
        items.stream().filter(i -> i.mandatory() && !i.done()).count(),
        h.getRequestedBy() != null && h.getRequestedBy().equals(AuthUtils.getUser()));
  }

  static EventView view(HandoverEvent e) {
    return new EventView(e.getId(), name(e.getKindSelect(), EVENTS), name(e.getReasonSelect(), REASONS), userName(e.getActor()),
        e.getOccurredAt(), userName(e.getFromUser()), userName(e.getToUser()), e.getItemTitle());
  }

  static EngagementView view(Project p) {
    JpaSecurity security = Beans.get(JpaSecurity.class);
    Partner client = p.getClientPartner();
    boolean canReadClient = client != null && security.isPermitted(JpaSecurity.CAN_READ, Partner.class, client.getId());
    List<ProjectTask> tasks = Query.of(ProjectTask.class).filter("self.project = ?1", p).fetch();
    long done = tasks.stream().filter(OperationsService::isDone).count();
    LocalDate today = LocalDate.now();
    long overdue = tasks.stream().filter(t -> !OperationsService.isDone(t) && t.getTaskEndDate() != null && t.getTaskEndDate().isBefore(today)).count();
    HandoverRequest h = p.getIoetiHandover();
    return new EngagementView(p.getId(), p.getVersion(), p.getCode(), p.getName(), canReadClient ? client.getId() : null,
        canReadClient ? client.getName() : null, userName(p.getAssignedTo()), p.getTeam() == null ? null : p.getTeam().getName(),
        h.getId(), h.getContract().getContractId(), h.getBusinessLine().getCode(), p.getFromDate(), tasks.size(), done, overdue,
        tasks.isEmpty() ? 0 : (int) Math.round(done * 100.0 / tasks.size()),
        p.getAssignedTo() != null && p.getAssignedTo().equals(AuthUtils.getUser()));
  }

  static TaskView view(ProjectTask t) {
    return new TaskView(t.getId(), t.getVersion(), t.getName(), t.getTaskEndDate(), userName(t.getAssignedTo()),
        t.getStatus() == null ? null : t.getStatus().getName(), OperationsService.isDone(t),
        !OperationsService.isDone(t) && t.getTaskEndDate() != null && t.getTaskEndDate().isBefore(LocalDate.now()));
  }

  public record VersionOnly(Integer version) {}
  public record ContractOption(Long id, String reference, String name, String clientName) {}
  public record PersonOption(Long id, String name) {}
  public record CreateRequirement(String businessLineCode, String title, Boolean mandatory, Integer sequence) {}
  public record RequestHandover(Long contractId) {}
  public record CompleteItem(Integer version, String evidenceReference) {}
  public record Decision(Integer version, String reason) {}
  public record Accept(Integer version, Long operationsLeadId, Long teamId, String startDate) {}
  public record AddTask(Integer version, String name, String dueDate, Long assigneeId) {}
  public record Transfer(Integer version, Long userId) {}
  public record RequirementView(Long id, Integer version, String businessLineCode, String title, boolean mandatory, Integer sequence) {}
  public record ItemView(
      Long id, Integer version, String title, boolean mandatory, boolean done, String doneBy, LocalDateTime doneAt,
      String evidenceReference) {}
  public record HandoverView(
      Long id, Integer version, Long contractId, String contractReference, String contractName, Long clientId, String clientName,
      String businessLineCode, String status, String requestedBy, String reviewedBy, String operationsLead, LocalDateTime submittedAt,
      LocalDateTime decidedAt, Long engagementId, List<ItemView> items, long missingRequired, boolean requestedByMe) {}
  public record EventView(
      Long id, String kind, String reason, String actorName, LocalDateTime at, String fromUser, String toUser, String itemTitle) {}
  public record EngagementView(
      Long id, Integer version, String code, String name, Long clientId, String clientName, String leadName, String teamName,
      Long handoverId, String contractReference, String businessLineCode, LocalDateTime startedAt, long tasks, long tasksDone,
      long tasksOverdue, int progress, boolean ledByMe) {}
  public record TaskView(
      Long id, Integer version, String name, LocalDate dueDate, String assigneeName, String status, boolean done, boolean overdue) {}
}
