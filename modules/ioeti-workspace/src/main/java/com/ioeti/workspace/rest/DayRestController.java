package com.ioeti.workspace.rest;

import com.axelor.apps.base.db.Partner;
import com.axelor.apps.base.service.app.AppBaseService;
import com.axelor.apps.crm.db.Event;
import com.axelor.apps.crm.db.Lead;
import com.axelor.apps.crm.db.Opportunity;
import com.axelor.apps.crm.db.repo.EventRepository;
import com.axelor.apps.intervention.db.Intervention;
import com.axelor.apps.quality.db.QIResolutionDefault;
import com.axelor.apps.quality.db.QualityImprovement;
import com.axelor.apps.quality.db.repo.QualityImprovementRepository;
import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.AuditableModel;
import com.axelor.auth.db.User;
import com.axelor.db.JPA;
import java.util.Set;
import java.util.LinkedHashSet;
import jakarta.ws.rs.PathParam;
import com.axelor.team.db.Team;
import com.axelor.db.JpaSecurity;
import com.axelor.db.Model;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.axelor.rpc.filter.Filter;
import com.axelor.rpc.filter.JPQLFilter;
import com.axelor.utils.api.ConflictChecker;
import com.axelor.utils.api.ResponseConstructor;
import com.ioeti.certification.db.CertificationAudit;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.IoetiEndpoint;
import com.ioeti.core.api.RecordAccess;
import com.ioeti.core.text.ArabicNormalizer;
import com.ioeti.core.web.OptimisticLockConflicts;
import com.ioeti.operations.db.CorrectiveAction;
import com.ioeti.operations.db.repo.CorrectiveActionRepository;
import com.ioeti.operations.service.QualityService;
import com.ioeti.operations.service.VisitService;
import com.ioeti.recruitment.db.ClientInterview;
import com.ioeti.training.db.CohortSession;
import com.ioeti.workspace.service.ActivityService;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.time.DateTimeException;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * The working day across domains (journeys plan, phase 2): activities on a lead, account or opportunity
 * (calls and meetings that happened, and planned ones), the caller's own agenda, and one search box.
 *
 * <p>Every list is built from the caller's own read permissions: a domain the caller cannot read is left
 * out of the agenda and the search, never shown empty as if it were read. Logging an activity needs write
 * access on the record and create access on native CRM events; nothing is sent to anyone. The outcome text
 * is stored but not returned in lists.
 */
@Path("/ioeti/workspace")
@Produces(MediaType.APPLICATION_JSON)
public class DayRestController {

  static final String[] RECORDS = {"LEAD", "ACCOUNT", "OPPORTUNITY"};
  static final String[] KINDS = {"CALL", "MEETING", "TASK", "NOTE"};
  static final int[] KIND_NATIVE = {EventRepository.TYPE_CALL, EventRepository.TYPE_MEETING, EventRepository.TYPE_TASK, EventRepository.TYPE_NOTE};
  static final int MAX_AGENDA_DAYS = 62;

  // --- activities on a record ------------------------------------------------------------------------

  @GET
  @Path("/activities")
  @Operation(summary = "Calls, meetings, tasks and notes on a lead, account or opportunity the caller may read, newest first", tags = {"IOETI workspace"})
  @IoetiEndpoint
  public Response activities(@QueryParam("record") String record, @QueryParam("recordId") Long recordId) {
    Model subject = readableRecord(record, recordId);
    if (!Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, Event.class)) {
      return ResponseConstructor.build(Response.Status.OK, "Activities", List.of());
    }
    List<ActivityView> rows = readable(Event.class, new JPQLFilter(link(record) + " = ?", subject)).order("-startDateTime").order("-id")
        .fetch(100).stream().map(DayRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Activities", rows);
  }

  @POST
  @Path("/activities")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Log a call, meeting, task or note that happened, or plan one, on a record the caller may change", tags = {"IOETI workspace"})
  @IoetiEndpoint
  public Response logActivity(LogActivity command) {
    if (command == null) throw ApiException.badRequest("The activity is required.");
    // a personal item (no record) lives only on its owner's calendar
    boolean personal = command.record() == null || command.record().isBlank() || "SELF".equals(command.record());
    if (!personal && command.version() == null) throw ApiException.badRequest("Record version is required.");
    AuditableModel subject = personal ? null : writableRecord(command.record(), command.recordId(), command.version());
    if (!Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_CREATE, Event.class)) throw ApiException.forbidden();
    int minutes = minutes(command.minutes());
    int kind = KIND_NATIVE[index("kind", command.kind(), KINDS)];
    String title = text("subject", command.subject(), 255, true);
    String outcome = text("outcome", command.outcome(), 4000, false);
    boolean planned = Boolean.TRUE.equals(command.planned());
    LocalDateTime now = now(command.zone());
    LocalDateTime at;
    try {
      at = command.at() == null || command.at().isBlank() ? now : LocalDateTime.parse(command.at());
    } catch (DateTimeParseException e) {
      throw ApiException.invalidField("at", "FORMAT", "Use a date and time like 2026-11-01T10:00.");
    }
    if (!planned && at.isAfter(now.plusMinutes(10))) {
      throw ApiException.invalidField("at", "FUTURE", "An activity that happened cannot be in the future; plan it instead.");
    }
    if (planned && at.isBefore(now.minusMinutes(10))) {
      throw ApiException.invalidField("at", "PAST", "A planned activity must be in the future.");
    }
    Event[] saved = new Event[1];
    OptimisticLockConflicts.translate(() -> saved[0] = Beans.get(ActivityService.class).log(subject, title, outcome, at, minutes, kind, planned));
    return ResponseConstructor.build(Response.Status.CREATED, planned ? "Activity planned" : "Activity logged", view(saved[0]));
  }

  /**
   * The caller's wall-clock "now". Times are entered and stored as local wall-clock times, so "has it
   * happened yet" is judged in the caller's own time zone (sent by the browser); without one, Axelor's
   * native "today" for the caller's company time zone is used, never the raw server clock.
   */
  static LocalDateTime now(String zone) {
    if (zone != null && !zone.isBlank()) {
      try {
        return LocalDateTime.now(ZoneId.of(zone.strip())).truncatedTo(ChronoUnit.MINUTES);
      } catch (DateTimeException e) {
        throw ApiException.invalidField("zone", "UNKNOWN", "Unknown time zone.");
      }
    }
    User me = AuthUtils.getUser();
    return Beans.get(AppBaseService.class).getTodayDateTime(me == null ? null : me.getActiveCompany()).toLocalDateTime()
        .truncatedTo(ChronoUnit.MINUTES);
  }

  @POST
  @Path("/activities/{id}/move")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Move one of the caller's planned activities to another time (and length)", tags = {"IOETI workspace"})
  @IoetiEndpoint
  public Response move(@PathParam("id") Long id, MoveActivity command) {
    if (command == null || command.version() == null) throw ApiException.badRequest("Record version is required.");
    Event event = ownPlanned(id, command.version());
    LocalDateTime at;
    try {
      at = LocalDateTime.parse(command.at());
    } catch (RuntimeException e) {
      throw ApiException.invalidField("at", "FORMAT", "Use a date and time like 2026-11-01T10:00.");
    }
    if (at.isBefore(now(command.zone()).minusMinutes(10))) throw ApiException.invalidField("at", "PAST", "A planned activity must be in the future.");
    Integer minutes = command.minutes() == null ? null : minutes(command.minutes());
    Event[] saved = new Event[1];
    OptimisticLockConflicts.translate(() -> saved[0] = Beans.get(ActivityService.class).move(event, at, minutes));
    return ResponseConstructor.build(Response.Status.OK, "Activity moved", view(saved[0]));
  }

  @POST
  @Path("/activities/{id}/done")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Mark one of the caller's planned activities done, optionally with what came of it (never returned)", tags = {"IOETI workspace"})
  @IoetiEndpoint
  public Response done(@PathParam("id") Long id, FinishActivity command) {
    if (command == null || command.version() == null) throw ApiException.badRequest("Record version is required.");
    Event event = ownPlanned(id, command.version());
    String outcome = text("outcome", command.outcome(), 4000, false);
    Event[] saved = new Event[1];
    OptimisticLockConflicts.translate(() -> saved[0] = Beans.get(ActivityService.class).done(event, outcome));
    return ResponseConstructor.build(Response.Status.OK, "Activity done", view(saved[0]));
  }

  @POST
  @Path("/activities/{id}/cancel")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Cancel one of the caller's planned activities (it stays in the history as cancelled)", tags = {"IOETI workspace"})
  @IoetiEndpoint
  public Response cancel(@PathParam("id") Long id, FinishActivity command) {
    if (command == null || command.version() == null) throw ApiException.badRequest("Record version is required.");
    Event event = ownPlanned(id, command.version());
    Event[] saved = new Event[1];
    OptimisticLockConflicts.translate(() -> saved[0] = Beans.get(ActivityService.class).cancel(event));
    return ResponseConstructor.build(Response.Status.OK, "Activity cancelled", view(saved[0]));
  }

  /** The caller's own planned activity, at the caller's version; anything else is not theirs to change from the calendar. */
  private static Event ownPlanned(Long id, Integer version) {
    Event event = RecordAccess.writable(Event.class, id);
    ConflictChecker.checkVersion(event, version);
    User me = AuthUtils.getUser();
    if (event.getUser() == null || !event.getUser().getId().equals(me.getId())) throw ApiException.forbidden();
    if (!Integer.valueOf(EventRepository.STATUS_PLANNED).equals(event.getStatusSelect())) {
      throw new ApiException(422, "NOT_PLANNED", "Only a planned activity can be changed this way.", null);
    }
    return event;
  }

  /** 5 minutes to 12 hours; 30 when not given. */
  static int minutes(Integer raw) {
    if (raw == null) return 30;
    if (raw < 5 || raw > 720) throw ApiException.invalidField("minutes", "RANGE", "From 5 minutes to 12 hours.");
    return raw;
  }

  @GET
  @Path("/agenda/people")
  @Operation(summary = "Whose calendars the caller may look at: themselves and the people who share a team with them", tags = {"IOETI workspace"})
  @IoetiEndpoint
  public Response agendaPeople() {
    User me = AuthUtils.getUser();
    List<PersonView> people = new ArrayList<>();
    people.add(new PersonView(me.getId(), me.getName(), true));
    teammates(me).stream().sorted(Comparator.comparing(User::getName, Comparator.nullsLast(String::compareTo)))
        .forEach(u -> people.add(new PersonView(u.getId(), u.getName(), false)));
    return ResponseConstructor.build(Response.Status.OK, "People", people);
  }

  /** Active people in any team the caller belongs to (either side of the membership). */
  static Set<User> teammates(User me) {
    Set<User> out = new LinkedHashSet<>();
    Set<Team> teams = new LinkedHashSet<>(me.getTeamSet() == null ? Set.of() : me.getTeamSet());
    teams.addAll(Query.of(Team.class).filter("?1 MEMBER OF self.members", me).fetch(100));
    for (Team t : teams) {
      if (t.getMembers() != null) out.addAll(t.getMembers());
      out.addAll(Query.of(User.class).filter("?1 MEMBER OF self.teamSet", t).fetch(500));
    }
    out.removeIf(u -> u.getId().equals(me.getId()) || Boolean.TRUE.equals(u.getBlocked()));
    return out;
  }

  // --- the caller's agenda ---------------------------------------------------------------------------

  @GET
  @Path("/agenda")
  @Operation(summary = "The caller's own agenda across domains: follow-ups and activities, sessions they coordinate, audits they lead or manage, interviews for their job orders, field visits assigned to them, open corrective actions they own falling due", tags = {"IOETI workspace"})
  @IoetiEndpoint
  public Response agenda(@QueryParam("from") String from, @QueryParam("to") String to, @QueryParam("userId") Long userId) {
    LocalDate start, end;
    try {
      start = from == null ? LocalDate.now() : LocalDate.parse(from);
      end = to == null ? start.plusDays(7) : LocalDate.parse(to);
    } catch (DateTimeParseException e) {
      throw ApiException.badRequest("Use dates like 2026-11-01.");
    }
    if (end.isBefore(start) || ChronoUnit.DAYS.between(start, end) > MAX_AGENDA_DAYS) {
      throw ApiException.badRequest("Choose a range of at most " + MAX_AGENDA_DAYS + " days.");
    }
    User caller = AuthUtils.getUser();
    // someone else's calendar: a teammate's (or anyone's, for an administrator), and only what native rights let the caller read
    User me = caller;
    boolean other = userId != null && !userId.equals(caller.getId());
    if (other) {
      User them = JPA.find(User.class, userId);
      if (them == null || (!AuthUtils.isAdmin(caller) && !teammates(caller).contains(them))) throw ApiException.notFound();
      me = them;
    }
    LocalDateTime a = start.atStartOfDay(), b = end.plusDays(1).atStartOfDay();
    JpaSecurity security = Beans.get(JpaSecurity.class);
    List<AgendaItem> items = new ArrayList<>();
    if (security.isPermitted(JpaSecurity.CAN_READ, Event.class)) {
      readable(Event.class, new JPQLFilter("self.user = ? AND self.startDateTime >= ? AND self.startDateTime < ? AND self.statusSelect <> ?",
          me, a, b, EventRepository.STATUS_CANCELED)).order("startDateTime").fetch(500).forEach(e -> items.add(new AgendaItem(
              "ACTIVITY", e.getId(), e.getSubject(), e.getStartDateTime(), e.getEndDateTime(), kindName(e.getTypeSelect()),
              statusName(e.getStatusSelect()), linkType(e), linkId(e), e.getVersion(),
              !other && Integer.valueOf(EventRepository.STATUS_PLANNED).equals(e.getStatusSelect()))));
    }
    if (other) {
      items.sort(Comparator.comparing(AgendaItem::at, Comparator.nullsLast(Comparator.naturalOrder())));
      return ResponseConstructor.build(Response.Status.OK, "Agenda", items);
    }
    if (security.isPermitted(JpaSecurity.CAN_READ, CohortSession.class)) {
      readable(CohortSession.class, new JPQLFilter("self.cohort.coordinator = ? AND self.startsAt >= ? AND self.startsAt < ?", me, a, b))
          .order("startsAt").fetch(200).forEach(s -> items.add(new AgendaItem("SESSION", s.getId(), s.getTitle(), s.getStartsAt(),
              s.getDurationMinutes() == null ? null : s.getStartsAt().plusMinutes(s.getDurationMinutes()), null, null, "COHORT", s.getCohort().getId(), null, false)));
    }
    if (security.isPermitted(JpaSecurity.CAN_READ, CertificationAudit.class)) {
      readable(CertificationAudit.class, new JPQLFilter("(self.auditor = ? OR self.cycle.manager = ?) AND self.plannedDate >= ? AND self.plannedDate <= ? AND self.statusSelect = 1",
          me, me, start, end)).order("plannedDate").fetch(200).forEach(au -> items.add(new AgendaItem("AUDIT", au.getId(), null,
              au.getPlannedDate().atStartOfDay(), null, null, null, "CYCLE", au.getCycle().getId(), null, false)));
    }
    if (security.isPermitted(JpaSecurity.CAN_READ, ClientInterview.class)) {
      readable(ClientInterview.class, new JPQLFilter("self.application.jobOrder.recruiter = ? AND self.scheduledAt >= ? AND self.scheduledAt < ? AND self.outcomeSelect = 1",
          me, a, b)).order("scheduledAt").fetch(200).forEach(i -> items.add(new AgendaItem("INTERVIEW", i.getId(),
              i.getApplication().getJobOrder().getTitle(), i.getScheduledAt(), null, null, null, "JOB_ORDER", i.getApplication().getJobOrder().getId(), null, false)));
    }
    if (security.isPermitted(JpaSecurity.CAN_READ, Intervention.class)) {
      // field visits assigned to me that are planned, under way or paused
      readable(Intervention.class, new JPQLFilter("self.assignedTo = ? AND self.planifStartDateTime >= ? AND self.planifStartDateTime < ? AND self.statusSelect IN (?, ?, ?)",
          me, a, b, VisitService.PLANNED, VisitService.STARTED, VisitService.SUSPENDED)).order("planifStartDateTime").fetch(200).forEach(v -> items.add(new AgendaItem("VISIT", v.getId(),
              v.getDeliveredPartner() == null || !security.isPermitted(JpaSecurity.CAN_READ, Partner.class, v.getDeliveredPartner().getId())
                  ? v.getSequence() : v.getDeliveredPartner().getName(),
              v.getPlanifStartDateTime(), v.getPlanifEndDateTime(), null, VisitService.status(v), "VISIT", v.getId(), null, false)));
    }
    if (security.isPermitted(JpaSecurity.CAN_READ, QualityImprovement.class)) {
      // open corrective actions I own falling due in the range; an action is seen through its quality issue
      Query.of(CorrectiveAction.class).filter("self.owner = ?1 AND self.statusSelect = ?2 AND self.dueDate >= ?3 AND self.dueDate <= ?4",
              me, CorrectiveActionRepository.STATUS_OPEN, start, end).order("dueDate").fetch(200).stream()
          .filter(x -> security.isPermitted(JpaSecurity.CAN_READ, QualityImprovement.class, x.getImprovement().getId()))
          .forEach(x -> items.add(new AgendaItem("ACTION", x.getId(), x.getTitle(), x.getDueDate().atStartOfDay(), null, null,
              QualityService.status(x), "QUALITY", x.getImprovement().getId(), null, false)));
    }
    items.sort(Comparator.comparing(AgendaItem::at, Comparator.nullsLast(Comparator.naturalOrder())));
    return ResponseConstructor.build(Response.Status.OK, "Agenda", items);
  }

  // --- one search box --------------------------------------------------------------------------------

  @GET
  @Path("/search")
  @Operation(summary = "Leads, client accounts, opportunities, field visits and quality issues the caller may read whose names or references match (Arabic-normalised)", tags = {"IOETI workspace"})
  @IoetiEndpoint
  public Response search(@QueryParam("q") String q) {
    String key = ArabicNormalizer.normalize(text("q", q, 100, true));
    if (key.length() < 2) throw ApiException.invalidField("q", "TOO_SHORT", "Type at least two characters.");
    JpaSecurity security = Beans.get(JpaSecurity.class);
    List<SearchHit> hits = new ArrayList<>();
    if (security.isPermitted(JpaSecurity.CAN_READ, Lead.class)) {
      List<String> where = new ArrayList<>();
      List<Object> params = new ArrayList<>();
      for (String word : key.split(" ")) { where.add("self.ioetiSearchKey LIKE ?"); params.add("%" + word.replace("%", "").replace("_", "") + "%"); }
      readable(Lead.class, new JPQLFilter(String.join(" AND ", where), params.toArray())).order("-id").fetch(8)
          .forEach(l -> hits.add(new SearchHit("LEAD", l.getId(), l.getFullName() == null || l.getFullName().isBlank() ? l.getName() : l.getFullName(),
              l.getEnterpriseName())));
    }
    if (security.isPermitted(JpaSecurity.CAN_READ, Partner.class)) {
      readable(Partner.class, new JPQLFilter("(self.isCustomer = true OR self.isProspect = true) AND (self.isInternal IS NULL OR self.isInternal = false)"
          + " AND (self.isEmployee IS NULL OR self.isEmployee = false) AND (self.isContact IS NULL OR self.isContact = false)"))
          .order("-id").fetch(1000).stream().filter(p -> ArabicNormalizer.normalize(p.getName()).contains(key)).limit(8)
          .forEach(p -> hits.add(new SearchHit("ACCOUNT", p.getId(), p.getName(), p.getPartnerSeq())));
    }
    if (security.isPermitted(JpaSecurity.CAN_READ, Opportunity.class)) {
      readable(Opportunity.class, null).order("-id").fetch(1000).stream()
          .filter(o -> ArabicNormalizer.normalize(o.getName() + " " + o.getOpportunitySeq()).contains(key)).limit(8)
          .forEach(o -> hits.add(new SearchHit("OPPORTUNITY", o.getId(), o.getName(), o.getOpportunitySeq())));
    }
    if (security.isPermitted(JpaSecurity.CAN_READ, Intervention.class)) {
      // a visit matches its reference, or its client's name only when the caller may read the client
      readable(Intervention.class, null).order("-id").fetch(1000).stream().map(v -> {
        Partner client = v.getDeliveredPartner();
        String name = client != null && security.isPermitted(JpaSecurity.CAN_READ, Partner.class, client.getId()) ? client.getName() : null;
        return ArabicNormalizer.normalize(java.util.Objects.toString(v.getSequence(), "") + " " + (name == null ? "" : name)).contains(key)
            ? new SearchHit("VISIT", v.getId(), name == null ? v.getSequence() : name, v.getSequence()) : null;
      }).filter(java.util.Objects::nonNull).limit(8).forEach(hits::add);
    }
    if (security.isPermitted(JpaSecurity.CAN_READ, QualityImprovement.class)) {
      readable(QualityImprovement.class, new JPQLFilter("self.type = ?", QualityImprovementRepository.TYPE_SYSTEM)).order("-id").fetch(1000).stream()
          .map(qi -> {
            QIResolutionDefault line = QualityService.issue(qi);
            String title = line == null ? null : line.getName();
            return ArabicNormalizer.normalize(java.util.Objects.toString(qi.getSequence(), "") + " " + (title == null ? "" : title)).contains(key)
                ? new SearchHit("QUALITY", qi.getId(), title == null ? qi.getSequence() : title, qi.getSequence()) : null;
          }).filter(java.util.Objects::nonNull).limit(8).forEach(hits::add);
    }
    return ResponseConstructor.build(Response.Status.OK, "Search", hits);
  }

  // --- helpers ---------------------------------------------------------------------------------------

  private static Model readableRecord(String record, Long id) {
    return switch (record == null ? "" : record) {
      case "LEAD" -> RecordAccess.readable(Lead.class, id);
      case "ACCOUNT" -> RecordAccess.readable(Partner.class, id);
      case "OPPORTUNITY" -> RecordAccess.readable(Opportunity.class, id);
      default -> throw ApiException.invalidField("record", "UNAVAILABLE", "Use LEAD, ACCOUNT or OPPORTUNITY.");
    };
  }

  private static AuditableModel writableRecord(String record, Long id, Integer version) {
    AuditableModel model = switch (record == null ? "" : record) {
      case "LEAD" -> RecordAccess.writable(Lead.class, id);
      case "ACCOUNT" -> RecordAccess.writable(Partner.class, id);
      case "OPPORTUNITY" -> RecordAccess.writable(Opportunity.class, id);
      default -> throw ApiException.invalidField("record", "UNAVAILABLE", "Use LEAD, ACCOUNT or OPPORTUNITY.");
    };
    ConflictChecker.checkVersion(model, version);
    return model;
  }

  static String link(String record) {
    return switch (record) {
      case "LEAD" -> "self.eventLead";
      case "ACCOUNT" -> "self.partner";
      default -> "self.opportunity";
    };
  }

  static String linkType(Event e) {
    if (e.getEventLead() != null) return "LEAD";
    if (e.getOpportunity() != null) return "OPPORTUNITY";
    if (e.getPartner() != null) return "ACCOUNT";
    return null;
  }

  static Long linkId(Event e) {
    if (e.getEventLead() != null) return e.getEventLead().getId();
    if (e.getOpportunity() != null) return e.getOpportunity().getId();
    if (e.getPartner() != null) return e.getPartner().getId();
    return null;
  }

  static String kindName(Integer type) {
    for (int i = 0; i < KIND_NATIVE.length; i++) if (Integer.valueOf(KIND_NATIVE[i]).equals(type)) return KINDS[i];
    return "OTHER";
  }

  static String statusName(Integer status) {
    if (Integer.valueOf(EventRepository.STATUS_REALIZED).equals(status)) return "DONE";
    if (Integer.valueOf(EventRepository.STATUS_CANCELED).equals(status)) return "CANCELLED";
    return "PLANNED";
  }

  static ActivityView view(Event e) {
    User owner = e.getUser();
    User me = AuthUtils.getUser();
    return new ActivityView(e.getId(), e.getVersion(), kindName(e.getTypeSelect()), statusName(e.getStatusSelect()), e.getSubject(),
        e.getStartDateTime(), owner == null ? null : owner.getName(), owner != null && me != null && owner.getId().equals(me.getId()),
        e.getDescription() != null && !e.getDescription().isBlank());
  }

  static int index(String field, String value, String[] names) {
    for (int i = 0; i < names.length; i++) if (names[i].equals(value)) return i;
    throw ApiException.invalidField(field, "UNAVAILABLE", "Use one of " + String.join(", ", names) + ".");
  }

  static String text(String field, String value, int max, boolean required) {
    String text = value == null ? null : value.strip();
    if (text == null || text.isEmpty()) {
      if (required) throw ApiException.invalidField(field, "REQUIRED", "This field is required.");
      return null;
    }
    if (text.length() > max) throw ApiException.invalidField(field, "TOO_LONG", "This field can have at most " + max + " characters.");
    return text;
  }

  private static <T extends Model> Query<T> readable(Class<T> type, Filter condition) {
    Filter security = Beans.get(JpaSecurity.class).getFilter(JpaSecurity.CAN_READ, type);
    Filter combined = security == null ? condition : condition == null ? security : Filter.and(security, condition);
    return combined == null ? Query.of(type) : combined.build(type);
  }

  /** {@code record} may be omitted (or SELF) for a personal item; {@code minutes} is the length (30 when not given). */
  public record LogActivity(String record, Long recordId, Integer version, String kind, String subject, String at, String outcome, Boolean planned,
      String zone, Integer minutes) {}

  public record MoveActivity(Integer version, String at, Integer minutes, String zone) {}

  public record FinishActivity(Integer version, String outcome) {}

  public record PersonView(Long id, String name, boolean me) {}

  public record ActivityView(Long id, Integer version, String kind, String status, String subject, LocalDateTime at, String ownerName,
      boolean mine, boolean outcomeRecorded) {}

  /** {@code version} and {@code movable}: the caller's own activities, which the calendar can move, finish or cancel. */
  public record AgendaItem(String type, Long id, String title, LocalDateTime at, LocalDateTime endsAt, String kind, String status,
      String recordType, Long recordId, Integer version, boolean movable) {}

  public record SearchHit(String type, Long id, String title, String subtitle) {}
}
