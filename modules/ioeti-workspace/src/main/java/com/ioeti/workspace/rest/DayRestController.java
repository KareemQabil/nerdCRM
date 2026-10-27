package com.ioeti.workspace.rest;

import com.axelor.apps.base.db.Partner;
import com.axelor.apps.base.service.app.AppBaseService;
import com.axelor.apps.crm.db.Event;
import com.axelor.apps.crm.db.Lead;
import com.axelor.apps.crm.db.Opportunity;
import com.axelor.apps.crm.db.repo.EventRepository;
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
import com.ioeti.certification.db.CertificationAudit;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.IoetiEndpoint;
import com.ioeti.core.api.RecordAccess;
import com.ioeti.core.text.ArabicNormalizer;
import com.ioeti.core.web.OptimisticLockConflicts;
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
    if (command == null || command.version() == null) throw ApiException.badRequest("Record version is required.");
    AuditableModel subject = writableRecord(command.record(), command.recordId(), command.version());
    if (!Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_CREATE, Event.class)) throw ApiException.forbidden();
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
    OptimisticLockConflicts.translate(() -> saved[0] = Beans.get(ActivityService.class).log(subject, title, outcome, at, kind, planned));
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

  // --- the caller's agenda ---------------------------------------------------------------------------

  @GET
  @Path("/agenda")
  @Operation(summary = "The caller's own agenda across domains: follow-ups and activities, sessions they coordinate, audits they lead or manage, interviews for their job orders", tags = {"IOETI workspace"})
  @IoetiEndpoint
  public Response agenda(@QueryParam("from") String from, @QueryParam("to") String to) {
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
    User me = AuthUtils.getUser();
    LocalDateTime a = start.atStartOfDay(), b = end.plusDays(1).atStartOfDay();
    JpaSecurity security = Beans.get(JpaSecurity.class);
    List<AgendaItem> items = new ArrayList<>();
    if (security.isPermitted(JpaSecurity.CAN_READ, Event.class)) {
      readable(Event.class, new JPQLFilter("self.user = ? AND self.startDateTime >= ? AND self.startDateTime < ? AND self.statusSelect <> ?",
          me, a, b, EventRepository.STATUS_CANCELED)).order("startDateTime").fetch(300).forEach(e -> items.add(new AgendaItem(
              "ACTIVITY", e.getId(), e.getSubject(), e.getStartDateTime(), e.getEndDateTime(), kindName(e.getTypeSelect()),
              statusName(e.getStatusSelect()), linkType(e), linkId(e))));
    }
    if (security.isPermitted(JpaSecurity.CAN_READ, CohortSession.class)) {
      readable(CohortSession.class, new JPQLFilter("self.cohort.coordinator = ? AND self.startsAt >= ? AND self.startsAt < ?", me, a, b))
          .order("startsAt").fetch(200).forEach(s -> items.add(new AgendaItem("SESSION", s.getId(), s.getTitle(), s.getStartsAt(),
              s.getDurationMinutes() == null ? null : s.getStartsAt().plusMinutes(s.getDurationMinutes()), null, null, "COHORT", s.getCohort().getId())));
    }
    if (security.isPermitted(JpaSecurity.CAN_READ, CertificationAudit.class)) {
      readable(CertificationAudit.class, new JPQLFilter("(self.auditor = ? OR self.cycle.manager = ?) AND self.plannedDate >= ? AND self.plannedDate <= ? AND self.statusSelect = 1",
          me, me, start, end)).order("plannedDate").fetch(200).forEach(au -> items.add(new AgendaItem("AUDIT", au.getId(), null,
              au.getPlannedDate().atStartOfDay(), null, null, null, "CYCLE", au.getCycle().getId())));
    }
    if (security.isPermitted(JpaSecurity.CAN_READ, ClientInterview.class)) {
      readable(ClientInterview.class, new JPQLFilter("self.application.jobOrder.recruiter = ? AND self.scheduledAt >= ? AND self.scheduledAt < ? AND self.outcomeSelect = 1",
          me, a, b)).order("scheduledAt").fetch(200).forEach(i -> items.add(new AgendaItem("INTERVIEW", i.getId(),
              i.getApplication().getJobOrder().getTitle(), i.getScheduledAt(), null, null, null, "JOB_ORDER", i.getApplication().getJobOrder().getId())));
    }
    items.sort(Comparator.comparing(AgendaItem::at, Comparator.nullsLast(Comparator.naturalOrder())));
    return ResponseConstructor.build(Response.Status.OK, "Agenda", items);
  }

  // --- one search box --------------------------------------------------------------------------------

  @GET
  @Path("/search")
  @Operation(summary = "Leads, client accounts and opportunities the caller may read whose names match (Arabic-normalised)", tags = {"IOETI workspace"})
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

  public record LogActivity(String record, Long recordId, Integer version, String kind, String subject, String at, String outcome, Boolean planned,
      String zone) {}

  public record ActivityView(Long id, Integer version, String kind, String status, String subject, LocalDateTime at, String ownerName,
      boolean mine, boolean outcomeRecorded) {}

  public record AgendaItem(String type, Long id, String title, LocalDateTime at, LocalDateTime endsAt, String kind, String status,
      String recordType, Long recordId) {}

  public record SearchHit(String type, Long id, String title, String subtitle) {}
}
