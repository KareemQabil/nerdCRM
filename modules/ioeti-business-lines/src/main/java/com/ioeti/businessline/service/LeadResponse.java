package com.ioeti.businessline.service;

import com.axelor.apps.base.AxelorException;
import com.axelor.apps.crm.db.Event;
import com.axelor.apps.crm.db.Lead;
import com.axelor.apps.crm.db.Opportunity;
import com.axelor.apps.crm.db.repo.EventRepository;
import com.axelor.db.JPA;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.google.inject.Inject;
import com.google.inject.persist.Transactional;
import com.ioeti.businessline.db.BusinessLine;
import com.ioeti.businessline.db.LeadResponseMiss;
import com.ioeti.core.db.PolicyVersion;
import com.ioeti.core.notify.Notifier;
import com.ioeti.core.policy.PolicyService;
import com.ioeti.core.policy.PolicyService.Applied;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * D-12 (signed 2026-10-25): response-time targets per business line and source, counted in working hours. When a target is
 * missed, the lead is flagged overdue and the line's manager gets an in-app notice. <b>Nothing is reassigned
 * automatically.</b>
 *
 * <ul>
 *   <li>The targets ({@code leads.response-target}) and the working hours ({@code work.calendar}) are the owners' policies,
 *       read as they were <b>when the lead arrived</b>: a lead that arrived before they were set has no timer. Nothing is
 *       shipped; without them the status is {@code NOT_SET}.
 *   <li>A target is looked up for the lead's line and source ({@code LINE/sourceId}), then its line, then the default.
 *   <li>First contact is the first completed activity on the lead. Qualification is its conversion into an opportunity.
 *   <li>A converted or lost lead stops the clock: without a first contact it is {@code CLOSED}, never overdue.
 * </ul>
 */
public class LeadResponse {

  public static final String CALENDAR = "work.calendar";
  public static final String TARGET = "leads.response-target";
  public static final String FIRST_CONTACT = "FIRST_CONTACT";
  public static final String QUALIFICATION = "QUALIFICATION";
  static final int BATCH = 200;

  /** The targets in force for one lead, or why there are none ({@code CALENDAR} or {@code TARGET} missing). */
  public record Targets(Applied calendar, Applied target, WorkCalendar hours, String missing) {}

  /**
   * Where a lead stands. {@code status}: NOT_SET, DUE, OVERDUE, MET, LATE or CLOSED; {@code qualification} the same, or
   * null when the line has no qualification target.
   */
  public record Status(String status, String missing, LocalDateTime receivedAt, LocalDateTime dueAt, LocalDateTime contactedAt,
      String qualification, LocalDateTime qualifyDueAt, LocalDateTime qualifiedAt, Long targetPolicyId, Long calendarPolicyId) {

    static Status notSet(String missing, LocalDateTime receivedAt) {
      return new Status("NOT_SET", missing, receivedAt, null, null, null, null, null, null, null);
    }
  }

  private final PolicyService policies;
  private final LeadLifecycleService lifecycle;

  @Inject
  public LeadResponse(PolicyService policies, LeadLifecycleService lifecycle) {
    this.policies = policies;
    this.lifecycle = lifecycle;
  }

  public Targets targets(Lead lead) {
    LocalDate on = received(lead).toLocalDate();
    Optional<Applied> calendar = policies.current(CALENDAR, null, on);
    if (calendar.isEmpty()) return new Targets(null, null, null, "CALENDAR");
    Optional<Applied> target = target(lead, on);
    if (target.isEmpty()) return new Targets(calendar.get(), null, null, "TARGET");
    return new Targets(calendar.get(), target.get(), WorkCalendar.of(calendar.get().value()), null);
  }

  /** The line and source's own value, then the line's, then the default. */
  Optional<Applied> target(Lead lead, LocalDate on) {
    BusinessLine line = lead.getIoetiBusinessLine();
    if (line == null) return policies.current(TARGET, null, on);
    if (lead.getSource() != null) {
      String scope = line.getCode() + "/" + lead.getSource().getId();
      Optional<Applied> own = policies.current(TARGET, scope, on);
      if (own.isPresent() && scope.equals(own.get().scope())) return own;
    }
    return policies.current(TARGET, line.getCode(), on);
  }

  public Status status(Lead lead, LocalDateTime now) {
    LocalDateTime receivedAt = received(lead);
    Targets t = targets(lead);
    if (t.missing() != null) return Status.notSet(t.missing(), receivedAt);
    boolean converted = Boolean.TRUE.equals(lead.getIsConverted());
    boolean open = !converted && !lost(lead);
    LocalDateTime due = t.hours().plusWorkingHours(receivedAt, t.target().value().path("firstContactHours").asInt());
    LocalDateTime contacted = firstContact(lead);
    String status = judge(contacted, due, open, now);
    String qualification = null;
    LocalDateTime qualifyDue = null;
    LocalDateTime qualified = null;
    if (t.target().value().hasNonNull("qualificationHours")) {
      qualifyDue = t.hours().plusWorkingHours(receivedAt, t.target().value().path("qualificationHours").asInt());
      qualified = converted ? qualifiedAt(lead) : null;
      qualification = judge(qualified, qualifyDue, open, now);
    }
    return new Status(status, null, receivedAt, due, contacted, qualification, qualifyDue, qualified, t.target().versionId(),
        t.calendar().versionId());
  }

  /** Met or late once done; otherwise due, overdue, or closed when the lead no longer needs it. */
  static String judge(LocalDateTime doneAt, LocalDateTime due, boolean open, LocalDateTime now) {
    if (doneAt != null) return doneAt.isAfter(due) ? "LATE" : "MET";
    if (!open) return "CLOSED";
    return now.isAfter(due) ? "OVERDUE" : "DUE";
  }

  static LocalDateTime received(Lead lead) {
    return lead.getCreatedOn() == null ? LocalDateTime.now() : lead.getCreatedOn();
  }

  private boolean lost(Lead lead) {
    try {
      return lifecycle.isLost(lead);
    } catch (AxelorException e) {
      return false;
    }
  }

  static LocalDateTime firstContact(Lead lead) {
    Event first = Query.of(Event.class).filter("self.eventLead = ?1 AND self.statusSelect = ?2", lead, EventRepository.STATUS_REALIZED)
        .order("startDateTime").fetchOne();
    return first == null ? null : first.getStartDateTime();
  }

  static LocalDateTime qualifiedAt(Lead lead) {
    Opportunity o = Query.of(Opportunity.class).filter("self.ioetiOriginLead = ?1", lead).order("createdOn").fetchOne();
    return o == null ? null : o.getCreatedOn();
  }

  // --- the scheduled check -------------------------------------------------------------------------------------

  /**
   * Records every target missed since the last check and notifies the line's manager once per lead and target. Returns how
   * many misses it recorded. Open leads only; a lead's own clock never changes its owner.
   */
  public int check(LocalDateTime now) {
    // leads that arrived before any working hours were set have no timer: start from the first calendar's date
    LocalDate since = JPA.em().createQuery("SELECT MIN(v.effectiveFrom) FROM PolicyVersion v WHERE v.policyKey = ?1", LocalDate.class)
        .setParameter(1, CALENDAR).getSingleResult();
    if (since == null) return 0;
    Set<String> known = new HashSet<>();
    for (Object[] row : JPA.em().createQuery("SELECT m.lead.id, m.target FROM LeadResponseMiss m", Object[].class).getResultList()) {
      known.add(row[0] + "/" + row[1]);
    }
    LeadResponse self = Beans.get(LeadResponse.class);
    int recorded = 0;
    long after = 0;
    while (true) {
      List<Lead> leads = Query.of(Lead.class)
          .filter("self.id > ?1 AND (self.isConverted IS NULL OR self.isConverted = false) AND self.createdOn >= ?2", after, since.atStartOfDay())
          .order("id").fetch(BATCH);
      if (leads.isEmpty()) break;
      for (Lead lead : leads) {
        after = lead.getId();
        Status s = status(lead, now);
        if ("OVERDUE".equals(s.status()) && known.add(lead.getId() + "/" + FIRST_CONTACT)) {
          self.record(lead.getId(), FIRST_CONTACT, s.dueAt(), s.targetPolicyId(), s.calendarPolicyId(), now);
          recorded++;
        }
        if ("OVERDUE".equals(s.qualification()) && known.add(lead.getId() + "/" + QUALIFICATION)) {
          self.record(lead.getId(), QUALIFICATION, s.qualifyDueAt(), s.targetPolicyId(), s.calendarPolicyId(), now);
          recorded++;
        }
      }
      JPA.clear();
    }
    return recorded;
  }

  /** One miss and its notice, in one transaction (a failed notice records nothing, and the next check tries again). */
  @Transactional(rollbackOn = {Exception.class})
  public void record(long leadId, String target, LocalDateTime dueAt, Long targetPolicy, Long calendarPolicy, LocalDateTime now) {
    Lead lead = JPA.find(Lead.class, leadId);
    BusinessLine line = lead.getIoetiBusinessLine();
    LeadResponseMiss miss = new LeadResponseMiss();
    miss.setLead(lead);
    miss.setTarget(target);
    miss.setDueAt(dueAt);
    miss.setTargetPolicy(JPA.find(PolicyVersion.class, targetPolicy));
    miss.setCalendarPolicy(JPA.find(PolicyVersion.class, calendarPolicy));
    miss.setNotified(line == null ? null : line.getManager());
    miss.setDetectedAt(now);
    JPA.save(miss);
    if (line != null && line.getManager() != null) {
      // non-sensitive: the lead's number and line, never the person's name
      Beans.get(Notifier.class).notify(line.getManager(), FIRST_CONTACT.equals(target) ? "LEAD_FIRST_CONTACT_OVERDUE" : "LEAD_QUALIFICATION_OVERDUE",
          "LEAD", lead.getId(), "Lead " + lead.getId() + " (" + line.getCode() + ")");
    }
  }
}
