package com.ioeti.operations.service;

import com.axelor.apps.intervention.db.Intervention;
import com.axelor.apps.intervention.db.repo.InterventionRepository;
import com.axelor.apps.intervention.service.InterventionService;
import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.User;
import com.axelor.db.JPA;
import com.axelor.inject.Beans;
import com.google.inject.persist.Transactional;
import com.ioeti.core.api.ApiException;
import com.ioeti.operations.db.VisitNote;
import jakarta.persistence.LockModeType;
import java.time.LocalDateTime;
import java.util.Map;
import java.util.Set;

/**
 * Field visits (capability map) on the native {@code Intervention}. Starting, pausing, finishing and
 * cancelling use the native service, so durations and linked customer requests follow the native rules;
 * planning sets the native planning fields directly (the native planning action also generates surveys
 * and sends templated e-mails, which are external exposure, D-10). Nothing is sent to the customer.
 */
public class VisitService {

  public static final int TO_PLAN = InterventionRepository.INTER_STATUS_TO_PLAN, PLANNED = InterventionRepository.INTER_STATUS_PLANNED,
      STARTED = InterventionRepository.INTER_STATUS_STARTED, SUSPENDED = InterventionRepository.INTER_STATUS_SUSPENDED,
      FINISHED = InterventionRepository.INTER_STATUS_FINISHED, CANCELLED = InterventionRepository.INTER_STATUS_CANCELLED;

  /** The commands a visit accepts in each status. */
  static final Map<String, Set<Integer>> FROM = Map.of(
      "plan", Set.of(TO_PLAN, PLANNED),
      "start", Set.of(PLANNED, SUSPENDED),
      "suspend", Set.of(STARTED),
      "finish", Set.of(STARTED, SUSPENDED),
      "cancel", Set.of(TO_PLAN, PLANNED, SUSPENDED));

  public static String status(Intervention visit) {
    int s = visit.getStatusSelect() == null ? TO_PLAN : visit.getStatusSelect();
    return switch (s) {
      case PLANNED -> "PLANNED"; case STARTED -> "STARTED"; case SUSPENDED -> "SUSPENDED";
      case FINISHED -> "FINISHED"; case CANCELLED -> "CANCELLED"; default -> "TO_PLAN";
    };
  }

  private static void allowed(Intervention visit, String command) {
    int s = visit.getStatusSelect() == null ? TO_PLAN : visit.getStatusSelect();
    if (!FROM.get(command).contains(s)) {
      throw new ApiException(422, "STATUS_NOT_ALLOWED", "A " + status(visit).toLowerCase() + " visit cannot " + command + ".", null);
    }
  }

  @Transactional(rollbackOn = {Exception.class})
  public Intervention create(Intervention visit, User assignee, LocalDateTime start, LocalDateTime end) {
    visit.setStatusSelect(TO_PLAN);
    visit.setUserInCharge(AuthUtils.getUser());
    if (assignee != null && start != null) planFields(visit, assignee, start, end);
    return Beans.get(InterventionRepository.class).save(visit);
  }

  @Transactional(rollbackOn = {Exception.class})
  public Intervention plan(Intervention visit, User assignee, LocalDateTime start, LocalDateTime end) {
    allowed(visit, "plan");
    planFields(visit, assignee, start, end);
    return Beans.get(InterventionRepository.class).save(visit);
  }

  private static void planFields(Intervention visit, User assignee, LocalDateTime start, LocalDateTime end) {
    visit.setAssignedTo(assignee);
    visit.setPlanifStartDateTime(start);
    visit.setPlanifEndDateTime(end != null ? end : start.plusHours(2));
    visit.setStatusSelect(PLANNED);
  }

  @Transactional(rollbackOn = {Exception.class})
  public Intervention start(Intervention visit, LocalDateTime now) {
    allowed(visit, "start");
    Beans.get(InterventionService.class).start(visit, now);
    return visit;
  }

  @Transactional(rollbackOn = {Exception.class})
  public Intervention suspend(Intervention visit, LocalDateTime now) {
    allowed(visit, "suspend");
    Beans.get(InterventionService.class).suspend(visit, now);
    return visit;
  }

  @Transactional(rollbackOn = {Exception.class})
  public Intervention finish(Intervention visit, LocalDateTime now) {
    allowed(visit, "finish");
    try {
      Beans.get(InterventionService.class).finish(visit, now);
    } catch (com.axelor.apps.base.AxelorException e) {
      // the native check: required checklist answers are missing
      throw new ApiException(422, "CHECKLIST_INCOMPLETE", "Answer the required checklist questions before finishing.", null);
    }
    return visit;
  }

  @Transactional(rollbackOn = {Exception.class})
  public Intervention cancel(Intervention visit) {
    allowed(visit, "cancel");
    Beans.get(InterventionService.class).cancel(visit);
    return visit;
  }

  /** Appends a note; the visit's version moves so two people writing at once never lose a view of it. */
  @Transactional(rollbackOn = {Exception.class})
  public VisitNote note(Intervention visit, String body, LocalDateTime now) {
    JPA.em().lock(visit, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    VisitNote note = new VisitNote();
    note.setVisit(visit);
    note.setAuthor(AuthUtils.getUser());
    note.setBody(body);
    note.setWrittenAt(now);
    return JPA.save(note);
  }
}
