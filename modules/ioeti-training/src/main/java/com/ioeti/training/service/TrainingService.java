package com.ioeti.training.service;

import com.axelor.apps.base.db.Partner;
import com.axelor.db.JPA;
import com.axelor.db.Model;
import com.axelor.db.Query;
import com.google.inject.persist.Transactional;
import com.ioeti.core.api.ApiException;
import com.ioeti.training.db.CohortSession;
import com.ioeti.training.db.TrainingAttendance;
import com.ioeti.training.db.TrainingCohort;
import com.ioeti.training.db.TrainingEnrollment;
import com.ioeti.training.db.repo.TrainingCohortRepository;
import com.ioeti.training.db.repo.TrainingEnrollmentRepository;
import jakarta.persistence.LockModeType;
import java.util.Comparator;
import java.util.List;

/**
 * Cohort capacity, waitlist and attendance rules for external training.
 *
 * <p>Every change to a cohort's enrolments locks the cohort row with
 * {@code PESSIMISTIC_FORCE_INCREMENT} first. Concurrent enrolments therefore run one after the
 * other, and the cohort version moves on each change, so a client holding the old version gets 409.
 * That keeps "confirmed enrolments never exceed capacity" and "waitlist positions are 1..n with no
 * gaps" true under concurrency.
 *
 * <p>Not here, by policy D-03: attendance thresholds, pass rules, certificates, refunds and cohort
 * cancellation (they fail closed in the API).
 */
public class TrainingService {

  /** Where a new enrolment lands: confirmed while seats are left, otherwise last on the waitlist. */
  public record Placement(int status, Integer waitlistPosition) {}

  public static Placement place(long confirmed, int capacity, long waitlisted) {
    return confirmed < capacity
        ? new Placement(TrainingEnrollmentRepository.STATUS_CONFIRMED, null)
        : new Placement(TrainingEnrollmentRepository.STATUS_WAITLISTED, (int) waitlisted + 1);
  }

  @Transactional(rollbackOn = {Exception.class})
  public TrainingEnrollment enroll(TrainingCohort cohort, Partner trainee, Partner client) {
    JPA.em().lock(cohort, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    if (!Integer.valueOf(TrainingCohortRepository.STATUS_OPEN).equals(cohort.getStatusSelect())) {
      throw new ApiException(422, "COHORT_NOT_OPEN", "This cohort is not open for enrolment.", null);
    }
    List<TrainingEnrollment> active = active(cohort);
    if (active.stream().anyMatch(e -> e.getTrainee().equals(trainee))) {
      throw new ApiException(409, "ALREADY_ENROLLED", "This trainee is already enrolled in the cohort.", null);
    }
    long confirmed = active.stream().filter(TrainingService::isConfirmed).count();
    Placement placement = place(confirmed, cohort.getCapacity(), active.size() - confirmed);
    TrainingEnrollment enrollment = new TrainingEnrollment();
    enrollment.setCohort(cohort);
    enrollment.setTrainee(trainee);
    enrollment.setClient(client);
    enrollment.setStatusSelect(placement.status());
    enrollment.setWaitlistPosition(placement.waitlistPosition());
    return JPA.save(enrollment);
  }

  /** Cancels an enrolment; a freed seat goes to the first trainee on the waitlist. */
  @Transactional(rollbackOn = {Exception.class})
  public TrainingEnrollment cancel(TrainingEnrollment enrollment) {
    TrainingCohort cohort = enrollment.getCohort();
    JPA.em().lock(cohort, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    if (Integer.valueOf(TrainingEnrollmentRepository.STATUS_CANCELLED).equals(enrollment.getStatusSelect())) {
      throw new ApiException(422, "ALREADY_CANCELLED", "This enrolment is already cancelled.", null);
    }
    boolean freedSeat = isConfirmed(enrollment);
    enrollment.setStatusSelect(TrainingEnrollmentRepository.STATUS_CANCELLED);
    enrollment.setWaitlistPosition(null);
    List<TrainingEnrollment> waitlist = active(cohort).stream()
        .filter(e -> !e.equals(enrollment) && !isConfirmed(e))
        .sorted(Comparator.comparing(TrainingEnrollment::getWaitlistPosition))
        .toList();
    // the first waiting trainee takes a freed seat; the others close up to positions 1..n
    int promoted = freedSeat && !waitlist.isEmpty() ? 1 : 0;
    for (int i = 0; i < waitlist.size(); i++) {
      TrainingEnrollment waiting = waitlist.get(i);
      if (i < promoted) {
        waiting.setStatusSelect(TrainingEnrollmentRepository.STATUS_CONFIRMED);
        waiting.setWaitlistPosition(null);
      } else {
        waiting.setWaitlistPosition(i + 1 - promoted);
      }
    }
    return JPA.save(enrollment);
  }

  /** Records (or corrects) one confirmed trainee's attendance at one session of their cohort. */
  @Transactional(rollbackOn = {Exception.class})
  public TrainingAttendance record(CohortSession session, TrainingEnrollment enrollment, int status) {
    if (!session.getCohort().equals(enrollment.getCohort()) || !isConfirmed(enrollment)) {
      throw ApiException.invalidField(
          "enrollmentId", "UNAVAILABLE", "Choose a confirmed trainee of this session's cohort.");
    }
    JPA.em().lock(session, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    TrainingAttendance attendance = Query.of(TrainingAttendance.class)
        .filter("self.session = :session AND self.enrollment = :enrollment")
        .bind("session", session).bind("enrollment", enrollment).fetchOne();
    if (attendance == null) {
      attendance = new TrainingAttendance();
      attendance.setSession(session);
      attendance.setEnrollment(enrollment);
    }
    attendance.setStatusSelect(status);
    return JPA.save(attendance);
  }

  /** New courses and cohorts: one transaction that commits on return. */
  @Transactional(rollbackOn = {Exception.class})
  public <T extends Model> T create(T record) {
    return JPA.save(record);
  }

  /** A new session changes the cohort's plan, so the cohort version moves like on any cohort change. */
  @Transactional(rollbackOn = {Exception.class})
  public CohortSession schedule(TrainingCohort cohort, CohortSession session) {
    JPA.em().lock(cohort, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    session.setCohort(cohort);
    return JPA.save(session);
  }

  @Transactional(rollbackOn = {Exception.class})
  public TrainingCohort transition(TrainingCohort cohort, int from, int to) {
    if (!Integer.valueOf(from).equals(cohort.getStatusSelect())) {
      throw new ApiException(422, "COHORT_STATE", "The cohort is not in the required state for this change.", null);
    }
    cohort.setStatusSelect(to);
    return JPA.save(cohort);
  }

  public static List<TrainingEnrollment> active(TrainingCohort cohort) {
    return Query.of(TrainingEnrollment.class)
        .filter("self.cohort = :cohort AND self.statusSelect <> :cancelled")
        .bind("cohort", cohort).bind("cancelled", TrainingEnrollmentRepository.STATUS_CANCELLED)
        .order("id").fetch();
  }

  static boolean isConfirmed(TrainingEnrollment enrollment) {
    return Integer.valueOf(TrainingEnrollmentRepository.STATUS_CONFIRMED).equals(enrollment.getStatusSelect());
  }
}
