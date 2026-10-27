package com.ioeti.training.service;

import com.axelor.apps.base.AxelorException;
import com.axelor.apps.base.service.administration.SequenceService;
import com.axelor.apps.base.service.app.AppBaseService;
import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.User;
import com.axelor.db.JPA;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.google.inject.Inject;
import com.google.inject.persist.Transactional;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.Locks;
import com.ioeti.core.db.PolicyVersion;
import com.ioeti.core.policy.PolicyService;
import com.ioeti.training.db.TrainingAttendance;
import com.ioeti.training.db.TrainingCertificate;
import com.ioeti.training.db.TrainingCohort;
import com.ioeti.training.db.TrainingCourse;
import com.ioeti.training.db.TrainingEnrollment;
import com.ioeti.training.db.TrainingNationalId;
import com.ioeti.training.db.repo.TrainingAttendanceRepository;
import com.ioeti.training.db.repo.TrainingCertificateRepository;
import com.ioeti.training.db.repo.TrainingCohortRepository;
import com.ioeti.training.db.repo.TrainingEnrollmentRepository;
import com.ioeti.training.service.TrainingRules.Criteria;
import com.ioeti.training.service.TrainingRules.Eligibility;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * D-03 (signed 2026-10-25), completing a course: the coordinator records assessment scores where the course has a pass
 * mark, reviews who meets the course's criteria ({@code training.certificate}, per course) and issues certificates to
 * them, numbered from the native sequence {@value #SEQUENCE}; a certificate can be revoked with a reason. A trainee's
 * national ID is collected per course ({@code training.national-id}) into its own restricted entity.
 *
 * <p>Certificates of one cohort are issued under the cohort's row lock, so a bulk issue and a single issue never give
 * one trainee two certificates.
 */
public class CompletionService {

  public static final String CERTIFICATE_POLICY = "training.certificate";
  public static final String IDENTITY_POLICY = "training.national-id";
  /** The native numbering (Sequence code) of training certificates; an administrator sets its prefix. */
  public static final String SEQUENCE = "ioetiTrainingCertificate";

  private final PolicyService policies;
  private final SequenceService sequences;

  @Inject
  public CompletionService(PolicyService policies, SequenceService sequences) {
    this.policies = policies;
    this.sequences = sequences;
  }

  public static LocalDate today() {
    User me = AuthUtils.getUser();
    return Beans.get(AppBaseService.class).getTodayDate(me == null ? null : me.getActiveCompany());
  }

  static String courseScope(TrainingCohort cohort) {
    return String.valueOf(cohort.getCourse().getId());
  }

  public Optional<PolicyService.Applied> criteria(TrainingCohort cohort, LocalDate on) {
    return policies.current(CERTIFICATE_POLICY, courseScope(cohort), on);
  }

  public Optional<PolicyService.Applied> identityRule(TrainingCourse course, LocalDate on) {
    return policies.current(IDENTITY_POLICY, String.valueOf(course.getId()), on);
  }

  // --- eligibility --------------------------------------------------------------------------------------------

  /** One trainee's standing against the criteria, with their certificate in force (if any). */
  public record Standing(TrainingEnrollment enrollment, int present, Eligibility eligibility, TrainingCertificate certificate) {}

  /** Every confirmed or cancelled-but-certified trainee of the cohort, measured against the criteria. */
  public List<Standing> standings(TrainingCohort cohort, Criteria criteria) {
    int sessions = sessions(cohort);
    Map<Long, Integer> present = present(cohort);
    Map<Long, TrainingCertificate> issued = new HashMap<>();
    for (TrainingCertificate c : Query.of(TrainingCertificate.class)
        .filter("self.enrollment.cohort = ?1 AND self.statusSelect = ?2", cohort, TrainingCertificateRepository.STATUS_ISSUED).fetch()) {
      issued.put(c.getEnrollment().getId(), c);
    }
    List<Standing> out = new ArrayList<>();
    for (TrainingEnrollment e : Query.of(TrainingEnrollment.class).filter("self.cohort = ?1", cohort).order("id").fetch()) {
      boolean confirmed = Integer.valueOf(TrainingEnrollmentRepository.STATUS_CONFIRMED).equals(e.getStatusSelect());
      if (!confirmed && !issued.containsKey(e.getId())) continue;
      int p = present.getOrDefault(e.getId(), 0);
      Eligibility eligibility = criteria == null
          ? new Eligibility(false, "POLICY_NOT_SET", TrainingRules.attendancePercent(p, sessions))
          : TrainingRules.evaluate(criteria, confirmed, sessions, p, e.getAssessmentScore());
      out.add(new Standing(e, p, eligibility, issued.get(e.getId())));
    }
    return out;
  }

  public static int sessions(TrainingCohort cohort) {
    return (int) Query.of(com.ioeti.training.db.CohortSession.class).filter("self.cohort = ?1", cohort).count();
  }

  private static Map<Long, Integer> present(TrainingCohort cohort) {
    Map<Long, Integer> out = new HashMap<>();
    List<Object[]> rows = JPA.em().createQuery(
            "SELECT a.enrollment.id, COUNT(a) FROM TrainingAttendance a WHERE a.session.cohort = :cohort AND a.statusSelect = :present"
                + " GROUP BY a.enrollment.id", Object[].class)
        .setParameter("cohort", cohort).setParameter("present", TrainingAttendanceRepository.STATUS_PRESENT).getResultList();
    for (Object[] row : rows) out.put((Long) row[0], ((Long) row[1]).intValue());
    return out;
  }

  // --- assessment ---------------------------------------------------------------------------------------------

  /** Records (or corrects) a trainee's score; only for a course with a pass mark. */
  @Transactional(rollbackOn = {Exception.class})
  public TrainingEnrollment assess(TrainingEnrollment enrollment, BigDecimal rawScore, LocalDate today) {
    TrainingCohort cohort = enrollment.getCohort();
    Criteria criteria = Criteria.of(policies.require(CERTIFICATE_POLICY, courseScope(cohort), today).value());
    if (!criteria.assessed()) {
      throw new ApiException(422, "NOT_ASSESSED", "This course has no pass mark, so no score is recorded.", null);
    }
    if (!Integer.valueOf(TrainingEnrollmentRepository.STATUS_CONFIRMED).equals(enrollment.getStatusSelect())) {
      throw new ApiException(422, "NOT_CONFIRMED", "Only a confirmed trainee is assessed.", null);
    }
    if (hasIssued(enrollment)) {
      throw new ApiException(422, "ALREADY_CERTIFIED", "This trainee already holds a certificate; revoke it before changing the score.", null);
    }
    enrollment.setAssessmentScore(TrainingRules.checkedScore(rawScore));
    enrollment.setAssessedBy(AuthUtils.getUser());
    enrollment.setAssessedOn(today);
    return JPA.save(enrollment);
  }

  // --- certificates -------------------------------------------------------------------------------------------

  /** Issues a certificate to one trainee who meets the criteria; otherwise 422 NOT_ELIGIBLE with the reason. */
  @Transactional(rollbackOn = {Exception.class})
  public TrainingCertificate issue(TrainingEnrollment enrollment, LocalDate today) {
    TrainingCohort cohort = Locks.parent(enrollment.getCohort());
    PolicyService.Applied applied = issuable(cohort, today);
    Criteria criteria = Criteria.of(applied.value());
    if (hasIssued(enrollment)) throw new ApiException(422, "ALREADY_CERTIFIED", "This trainee already holds a certificate.", null);
    Standing standing = standings(cohort, criteria).stream().filter(s -> s.enrollment().equals(enrollment)).findFirst()
        .orElse(new Standing(enrollment, 0, new Eligibility(false, "NOT_CONFIRMED", null), null));
    Eligibility e = standing.eligibility();
    if (!e.eligible()) {
      String message = TrainingRules.explain(e.reason(), criteria, e.attendancePercent(), enrollment.getAssessmentScore());
      throw new ApiException(422, "NOT_ELIGIBLE", message, List.of(new ApiException.FieldError("enrollment", e.reason(), message)));
    }
    return create(enrollment, e, applied, today);
  }

  /** What a bulk issue did: the certificates issued, and each trainee left out with the reason. */
  public record Bulk(List<TrainingCertificate> issued, List<Standing> skipped) {}

  /** Issues certificates to every trainee of the cohort who meets the criteria and has none yet. */
  @Transactional(rollbackOn = {Exception.class})
  public Bulk issueAll(TrainingCohort cohort, LocalDate today) {
    JPA.em().lock(cohort, jakarta.persistence.LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    PolicyService.Applied applied = issuable(cohort, today);
    Criteria criteria = Criteria.of(applied.value());
    List<TrainingCertificate> issued = new ArrayList<>();
    List<Standing> skipped = new ArrayList<>();
    for (Standing s : standings(cohort, criteria)) {
      if (s.certificate() != null) continue;
      if (s.eligibility().eligible()) issued.add(create(s.enrollment(), s.eligibility(), applied, today));
      else skipped.add(s);
    }
    return new Bulk(issued, skipped);
  }

  private PolicyService.Applied issuable(TrainingCohort cohort, LocalDate today) {
    if (Integer.valueOf(TrainingCohortRepository.STATUS_CANCELLED).equals(cohort.getStatusSelect())
        || Integer.valueOf(TrainingCohortRepository.STATUS_PLANNED).equals(cohort.getStatusSelect())) {
      throw new ApiException(422, "COHORT_STATE", "Certificates are issued for cohorts that ran (open or closed), not planned or cancelled ones.", null);
    }
    PolicyService.Applied applied = policies.require(CERTIFICATE_POLICY, courseScope(cohort), today);
    if (sequences.getSequence(SEQUENCE, null) == null) {
      throw new ApiException(422, "NUMBERING_NOT_SET",
          "Training certificates have no numbering yet; an administrator sets it up under Numbering.", null);
    }
    return applied;
  }

  private TrainingCertificate create(TrainingEnrollment enrollment, Eligibility e, PolicyService.Applied applied, LocalDate today) {
    TrainingCohort cohort = enrollment.getCohort();
    TrainingCourse course = cohort.getCourse();
    TrainingCertificate c = new TrainingCertificate();
    c.setEnrollment(enrollment);
    c.setIssueDate(today);
    String name = enrollment.getTrainee().getSimpleFullName();
    c.setTraineeName(name == null || name.isBlank() ? enrollment.getTrainee().getName() : name);
    c.setCourseTitle(course.getName());
    c.setCourseTitleAr(course.getNameAr());
    c.setAttendancePercent(e.attendancePercent());
    c.setScore(enrollment.getAssessmentScore());
    c.setPolicyVersion(JPA.find(PolicyVersion.class, applied.versionId()));
    c.setIssuedBy(AuthUtils.getUser());
    c.setStatusSelect(TrainingCertificateRepository.STATUS_ISSUED);
    try {
      String serial = sequences.getSequenceNumber(SEQUENCE, null, TrainingCertificate.class, "serial", c);
      if (serial == null || serial.isBlank()) {
        throw new ApiException(422, "NUMBERING_NOT_SET", "Training certificates have no numbering yet; an administrator sets it up under Numbering.", null);
      }
      c.setSerial(serial);
    } catch (AxelorException ex) {
      throw new ApiException(422, "NUMBERING_NOT_SET", "The certificate numbering could not give a number; an administrator checks it under Numbering.", null);
    }
    return JPA.save(c);
  }

  /** Revokes an issued certificate with the reason (kept, never shown back). */
  @Transactional(rollbackOn = {Exception.class})
  public TrainingCertificate revoke(TrainingCertificate certificate, String rawReason, LocalDate today) {
    if (!Integer.valueOf(TrainingCertificateRepository.STATUS_ISSUED).equals(certificate.getStatusSelect())) {
      throw new ApiException(422, "ALREADY_REVOKED", "This certificate is already revoked.", null);
    }
    String reason = rawReason == null ? "" : rawReason.strip();
    if (reason.isEmpty()) throw ApiException.invalidField("reason", "REQUIRED", "Say why the certificate is revoked.");
    if (reason.length() > 500) throw ApiException.invalidField("reason", "TOO_LONG", "Keep the reason under 500 characters.");
    certificate.setStatusSelect(TrainingCertificateRepository.STATUS_REVOKED);
    certificate.setRevokedOn(today);
    certificate.setRevokedBy(AuthUtils.getUser());
    certificate.setRevokeReason(reason);
    return JPA.save(certificate);
  }

  public static boolean hasIssued(TrainingEnrollment enrollment) {
    return Query.of(TrainingCertificate.class).filter("self.enrollment = ?1 AND self.statusSelect = ?2",
        enrollment, TrainingCertificateRepository.STATUS_ISSUED).count() > 0;
  }

  // --- national ID --------------------------------------------------------------------------------------------

  /**
   * Checks a national ID against the course's rule at enrolment: refused when the course does not ask for it (or the
   * rule is not set), required when the course requires it. Returns the normalized number, or null when none is due.
   */
  public String checkedIdentity(TrainingCourse course, String raw, LocalDate today) {
    boolean given = raw != null && !raw.isBlank();
    Optional<PolicyService.Applied> rule = identityRule(course, today);
    if (rule.isEmpty()) {
      // nothing is collected until the owners decide; a number offered anyway is refused, never stored
      if (given) policies.require(IDENTITY_POLICY, String.valueOf(course.getId()), today);
      return null;
    }
    String collect = rule.get().value().path("collect").asText();
    if ("NOT_ASKED".equals(collect)) {
      if (given) throw ApiException.invalidField("nationalId", "NOT_ASKED", "This course does not ask for a national ID; leave it empty.");
      return null;
    }
    if (!given) {
      if ("REQUIRED".equals(collect)) throw ApiException.invalidField("nationalId", "REQUIRED", "This course requires the trainee's national ID.");
      return null;
    }
    return TrainingRules.nationalId(raw);
  }

  /** Stores (or replaces) the national ID of an enrolment, in the caller's transaction. */
  public static void storeIdentity(TrainingEnrollment enrollment, String number) {
    TrainingNationalId row = Query.of(TrainingNationalId.class).filter("self.enrollment = ?1", enrollment).fetchOne();
    if (row == null) {
      row = new TrainingNationalId();
      row.setEnrollment(enrollment);
    }
    row.setIdNumber(number);
    row.setRecordedBy(AuthUtils.getUser());
    row.setRecordedAt(LocalDateTime.now());
    JPA.save(row);
  }

  /** Records the national ID of an existing enrolment, where the course asks for it. */
  @Transactional(rollbackOn = {Exception.class})
  public TrainingEnrollment recordIdentity(TrainingEnrollment enrollment, String raw, LocalDate today) {
    if (raw == null || raw.isBlank()) throw ApiException.invalidField("nationalId", "REQUIRED", "Enter the national ID.");
    if (Integer.valueOf(TrainingEnrollmentRepository.STATUS_CANCELLED).equals(enrollment.getStatusSelect())) {
      throw new ApiException(422, "ALREADY_CANCELLED", "This enrolment is cancelled.", null);
    }
    String number = checkedIdentity(enrollment.getCohort().getCourse(), raw, today);
    storeIdentity(enrollment, number);
    // the enrolment's version moves, so a stale screen cannot record over a newer number
    JPA.em().lock(enrollment, jakarta.persistence.LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    return enrollment;
  }

  public static boolean identityProvided(TrainingEnrollment enrollment) {
    return Query.of(TrainingNationalId.class).filter("self.enrollment = ?1", enrollment).count() > 0;
  }
}
