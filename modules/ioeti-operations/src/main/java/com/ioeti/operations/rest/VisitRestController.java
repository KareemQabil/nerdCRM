package com.ioeti.operations.rest;

import com.axelor.apps.base.AxelorException;
import com.axelor.apps.base.db.Partner;
import com.axelor.apps.base.db.repo.TraceBackRepository;
import com.axelor.apps.base.service.app.AppBaseService;
import com.axelor.apps.contract.db.Contract;
import com.axelor.apps.crm.db.Opportunity;
import com.axelor.apps.intervention.db.Intervention;
import com.axelor.apps.intervention.db.InterventionType;
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
import com.ioeti.operations.db.VisitNote;
import com.ioeti.operations.service.VisitService;
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
import java.time.DateTimeException;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

/**
 * Field visits from the platform: plan a visit to a client, assign who goes and when, start, pause,
 * finish or cancel it on site, and keep its notes. Native intervention permissions decide on every call;
 * the client account must be one the caller may read. Times are wall-clock times judged in the caller's
 * own time zone. Nothing is sent to the customer (D-10).
 */
@Path("/ioeti/visits")
@Produces(MediaType.APPLICATION_JSON)
public class VisitRestController {

  @GET
  @Operation(summary = "Visits the caller may read: mine (assigned to me) or all, optionally by status", tags = {"IOETI visits"})
  @IoetiEndpoint
  public Response list(@QueryParam("mine") Boolean mine, @QueryParam("status") String status) {
    new SecurityCheck().readAccess(Intervention.class).check();
    List<String> where = new ArrayList<>(List.of("self.deliveredPartner IS NOT NULL"));
    List<Object> params = new ArrayList<>();
    if (Boolean.TRUE.equals(mine)) { where.add("self.assignedTo = ?"); params.add(AuthUtils.getUser()); }
    if (status != null && !status.isBlank()) {
      int code = switch (status.strip()) {
        case "TO_PLAN" -> VisitService.TO_PLAN; case "PLANNED" -> VisitService.PLANNED; case "STARTED" -> VisitService.STARTED;
        case "SUSPENDED" -> VisitService.SUSPENDED; case "FINISHED" -> VisitService.FINISHED; case "CANCELLED" -> VisitService.CANCELLED;
        default -> throw ApiException.invalidField("status", "UNAVAILABLE", "Use TO_PLAN, PLANNED, STARTED, SUSPENDED, FINISHED or CANCELLED.");
      };
      where.add("self.statusSelect = ?"); params.add(code);
    }
    List<VisitView> rows = readable(Intervention.class, new JPQLFilter(String.join(" AND ", where), params.toArray()))
        .order("planifStartDateTime").order("-id").fetch(300).stream().map(VisitRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Visits", rows);
  }

  @GET
  @Path("/{id}")
  @Operation(summary = "One visit with its notes", tags = {"IOETI visits"})
  @IoetiEndpoint
  public Response get(@PathParam("id") Long id) {
    Intervention visit = RecordAccess.readable(Intervention.class, id);
    List<VisitNoteView> notes = Query.of(VisitNote.class).filter("self.visit = ?1", visit).order("-writtenAt").order("-id").fetch(200).stream()
        .map(n -> new VisitNoteView(n.getId(), n.getBody(), n.getWrittenAt(), n.getAuthor() == null ? null : n.getAuthor().getName(),
            n.getAuthor() != null && n.getAuthor().equals(AuthUtils.getUser()))).toList();
    return ResponseConstructor.build(Response.Status.OK, "Visit", new VisitDetail(view(visit), notes));
  }

  @POST
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Plan a visit to a client account (native create permission on interventions)", tags = {"IOETI visits"})
  @IoetiEndpoint
  public Response create(NewVisit command) {
    new SecurityCheck().createAccess(Intervention.class).check();
    if (command == null || command.accountId() == null) throw ApiException.invalidField("accountId", "REQUIRED", "Choose the client account.");
    Partner account = RecordAccess.readable(Partner.class, command.accountId());
    if (!Boolean.TRUE.equals(account.getIsCustomer()) && !Boolean.TRUE.equals(account.getIsProspect())) throw ApiException.notFound();
    Intervention visit = new Intervention();
    visit.setDeliveredPartner(account);
    visit.setInvoicedPartner(account);
    visit.setDescription(text("purpose", command.purpose(), 4000, true));
    if (command.typeId() != null) {
      InterventionType type = JPA.find(InterventionType.class, command.typeId());
      if (type == null) throw ApiException.invalidField("typeId", "UNAVAILABLE", "Choose an existing visit type.");
      visit.setInterventionType(type);
    }
    if (command.opportunityId() != null) visit.setOpportunity(RecordAccess.readable(Opportunity.class, command.opportunityId()));
    if (command.contractId() != null) visit.setContract(RecordAccess.readable(Contract.class, command.contractId()));
    User me = AuthUtils.getUser();
    if (me != null && me.getActiveCompany() != null) visit.setCompany(me.getActiveCompany());
    User assignee = command.assignedToId() == null ? null : person(command.assignedToId());
    LocalDateTime start = time("start", command.start()), end = time("end", command.end());
    check(start, end, command.zone(), assignee != null || start != null);
    Intervention[] saved = new Intervention[1];
    try {
      OptimisticLockConflicts.translate(() -> saved[0] = Beans.get(VisitService.class).create(visit, assignee, start, end));
    } catch (RuntimeException e) {
      Integer category = nativeCategory(e);
      if (category != null && category == TraceBackRepository.CATEGORY_CONFIGURATION_ERROR) {
        throw new ApiException(422, "NUMBERING_REQUIRED", "Visit numbering is not set up; an administrator sets it under Numbering.", null);
      }
      if (category != null && category == TraceBackRepository.CATEGORY_MISSING_FIELD) {
        throw new ApiException(422, "ADDRESS_REQUIRED", "This visit type needs the client's address and company.", null);
      }
      throw e;
    }
    return ResponseConstructor.build(Response.Status.CREATED, "Visit added", view(saved[0]));
  }

  @POST
  @Path("/{id}/plan")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Assign the visit and set when it takes place (also reschedules)", tags = {"IOETI visits"})
  @IoetiEndpoint
  public Response plan(@PathParam("id") Long id, PlanVisit command) {
    Intervention visit = versioned(id, command == null ? null : command.version());
    if (command.assignedToId() == null) throw ApiException.invalidField("assignedToId", "REQUIRED", "Choose who makes the visit.");
    User assignee = person(command.assignedToId());
    LocalDateTime start = time("start", command.start()), end = time("end", command.end());
    check(start, end, command.zone(), true);
    return run(() -> Beans.get(VisitService.class).plan(visit, assignee, start, end), "Visit planned");
  }

  @POST
  @Path("/{id}/{command:start|suspend|finish|cancel}")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Start, pause, finish or cancel the visit (native rules)", tags = {"IOETI visits"})
  @IoetiEndpoint
  public Response command(@PathParam("id") Long id, @PathParam("command") String command, VisitCommand body) {
    Intervention visit = versioned(id, body == null ? null : body.version());
    LocalDateTime now = now(body.zone());
    VisitService service = Beans.get(VisitService.class);
    return run(() -> switch (command) {
      case "start" -> service.start(visit, now);
      case "suspend" -> service.suspend(visit, now);
      case "finish" -> service.finish(visit, now);
      default -> service.cancel(visit);
    }, "Visit updated");
  }

  @POST
  @Path("/{id}/notes")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Add a note to the visit (what was seen, agreed or needs follow-up)", tags = {"IOETI visits"})
  @IoetiEndpoint
  public Response note(@PathParam("id") Long id, AddVisitNote command) {
    Intervention visit = versioned(id, command == null ? null : command.version());
    String body = text("text", command.text(), 4000, true);
    LocalDateTime now = now(command.zone());
    VisitNote[] saved = new VisitNote[1];
    OptimisticLockConflicts.translate(() -> saved[0] = Beans.get(VisitService.class).note(visit, body, now));
    return ResponseConstructor.build(Response.Status.CREATED, "Note added",
        new VisitNoteView(saved[0].getId(), saved[0].getBody(), saved[0].getWrittenAt(), AuthUtils.getUser().getName(), true));
  }

  @GET
  @Path("/types")
  @Operation(summary = "Visit types (native intervention types)", tags = {"IOETI visits"})
  @IoetiEndpoint
  public Response types() {
    new SecurityCheck().readAccess(Intervention.class).check();
    return ResponseConstructor.build(Response.Status.OK, "Visit types",
        Query.of(InterventionType.class).order("name").fetch(200).stream().map(t -> new VisitOption(t.getId(), t.getName())).toList());
  }

  @GET
  @Path("/people")
  @Operation(summary = "Active people a visit can be assigned to (callers who may plan visits)", tags = {"IOETI visits"})
  @IoetiEndpoint
  public Response people() {
    new SecurityCheck().writeAccess(Intervention.class).check();
    return ResponseConstructor.build(Response.Status.OK, "People",
        Query.of(User.class).filter("self.blocked IS NULL OR self.blocked = false").order("name").fetch(300).stream()
            .map(u -> new VisitOption(u.getId(), u.getName())).toList());
  }

  // --- helpers -------------------------------------------------------------------------------------

  private Response run(java.util.function.Supplier<Intervention> action, String message) {
    Intervention[] saved = new Intervention[1];
    OptimisticLockConflicts.translate(() -> saved[0] = action.get());
    return ResponseConstructor.build(Response.Status.OK, message, view(saved[0]));
  }

  /** The category of a native error raised while saving (the native repository wraps it), if any. */
  private static Integer nativeCategory(Throwable e) {
    for (Throwable t = e; t != null; t = t.getCause()) {
      if (t instanceof AxelorException axelor) return axelor.getCategory();
    }
    return null;
  }

  private static Intervention versioned(Long id, Integer version) {
    if (version == null) throw ApiException.badRequest("Record version is required.");
    Intervention visit = RecordAccess.writable(Intervention.class, id);
    ConflictChecker.checkVersion(visit, version);
    return visit;
  }

  private static User person(Long id) {
    User user = JPA.find(User.class, id);
    if (user == null || Boolean.TRUE.equals(user.getBlocked())) throw ApiException.invalidField("assignedToId", "UNAVAILABLE", "Choose an active person.");
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

  private static LocalDateTime time(String field, String value) {
    if (value == null || value.isBlank()) return null;
    try { return LocalDateTime.parse(value.strip()).truncatedTo(ChronoUnit.MINUTES); }
    catch (DateTimeParseException e) { throw ApiException.invalidField(field, "FORMAT", "Use a date and time like 2026-11-01T10:00."); }
  }

  /** A planned visit needs who and when, cannot start in the past, and ends after it starts. */
  private static void check(LocalDateTime start, LocalDateTime end, String zone, boolean planning) {
    if (!planning) return;
    if (start == null) throw ApiException.invalidField("start", "REQUIRED", "Choose when the visit takes place.");
    if (start.isBefore(now(zone).minusMinutes(10))) throw ApiException.invalidField("start", "PAST", "A visit cannot be planned in the past.");
    if (end != null && !end.isAfter(start)) throw ApiException.invalidField("end", "BEFORE_START", "The end must be after the start.");
  }

  /** The caller's wall-clock now: their browser's zone, else the company's native "today". */
  static LocalDateTime now(String zone) {
    if (zone != null && !zone.isBlank()) {
      try { return LocalDateTime.now(ZoneId.of(zone.strip())).truncatedTo(ChronoUnit.MINUTES); }
      catch (DateTimeException e) { throw ApiException.invalidField("zone", "UNKNOWN", "Unknown time zone."); }
    }
    User me = AuthUtils.getUser();
    return Beans.get(AppBaseService.class).getTodayDateTime(me == null ? null : me.getActiveCompany()).toLocalDateTime().truncatedTo(ChronoUnit.MINUTES);
  }

  private static <T extends Model> Query<T> readable(Class<T> type, Filter condition) {
    Filter security = Beans.get(JpaSecurity.class).getFilter(JpaSecurity.CAN_READ, type);
    Filter combined = security == null ? condition : condition == null ? security : Filter.and(security, condition);
    return combined == null ? Query.of(type) : combined.build(type);
  }

  static VisitView view(Intervention v) {
    Partner account = v.getDeliveredPartner();
    boolean canReadAccount = account != null && Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, Partner.class, account.getId());
    return new VisitView(v.getId(), v.getVersion(), v.getSequence(), VisitService.status(v), v.getDescription(),
        canReadAccount ? account.getId() : null, canReadAccount ? account.getName() : null,
        v.getInterventionType() == null ? null : v.getInterventionType().getName(),
        v.getAssignedTo() == null ? null : v.getAssignedTo().getId(), v.getAssignedTo() == null ? null : v.getAssignedTo().getName(),
        v.getAssignedTo() != null && v.getAssignedTo().equals(AuthUtils.getUser()),
        v.getPlanifStartDateTime(), v.getPlanifEndDateTime(), v.getStartDateTime(), v.getEndDateTime(), v.getTotalDuration(),
        v.getOpportunity() == null ? null : v.getOpportunity().getId(), v.getContract() == null ? null : v.getContract().getId());
  }

  public record NewVisit(Long accountId, String purpose, Long typeId, Long opportunityId, Long contractId, Long assignedToId, String start,
      String end, String zone) {}

  public record PlanVisit(Integer version, Long assignedToId, String start, String end, String zone) {}

  public record VisitCommand(Integer version, String zone) {}

  public record AddVisitNote(Integer version, String text, String zone) {}

  public record VisitView(Long id, Integer version, String reference, String status, String purpose, Long accountId, String accountName,
      String type, Long assigneeId, String assigneeName, boolean mine, LocalDateTime plannedStart, LocalDateTime plannedEnd,
      LocalDateTime startedAt, LocalDateTime finishedAt, Long durationSeconds, Long opportunityId, Long contractId) {}

  public record VisitNoteView(Long id, String text, LocalDateTime at, String authorName, boolean mine) {}

  public record VisitDetail(VisitView visit, List<VisitNoteView> log) {}

  public record VisitOption(Long id, String name) {}
}
