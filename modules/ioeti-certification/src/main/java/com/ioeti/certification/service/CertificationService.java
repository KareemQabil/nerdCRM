package com.ioeti.certification.service;

import com.axelor.auth.db.User;
import com.axelor.db.JPA;
import com.axelor.db.Model;
import com.axelor.db.Query;
import com.google.inject.persist.Transactional;
import com.ioeti.businessline.db.BusinessLine;
import com.ioeti.certification.db.AuditorQualification;
import com.ioeti.certification.db.CertificationAudit;
import com.ioeti.certification.db.CertificationCycle;
import com.ioeti.certification.db.Nonconformity;
import com.ioeti.certification.db.repo.CertificationAuditRepository;
import com.ioeti.certification.db.repo.NonconformityRepository;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.Locks;
import jakarta.persistence.LockModeType;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/**
 * Audit programme rules for client certification (Stage 1 and Stage 2 only).
 *
 * <ul>
 *   <li>The lead auditor must hold a qualification for the cycle's standard, valid on the planned date.
 *   <li>One active (not cancelled) audit of each stage per cycle; Stage 2 is completed only after Stage 1.
 *   <li>Nonconformities go open → responded (client correction and corrective action) → closed.
 *   <li>A cycle is ready for the certification decision once Stage 2 is completed and no major
 *       nonconformity is open. The decision itself, certificates, surveillance intervals and
 *       impartiality rules are policy D-02 and fail closed in the API.
 * </ul>
 *
 * <p>Changes to a cycle's audits lock the cycle row, and changes to an audit's nonconformities lock
 * the audit row ({@code PESSIMISTIC_FORCE_INCREMENT}), so concurrent writers serialize and the second
 * one sees a version conflict (409).
 */
public class CertificationService {

  /** Whether the auditor holds a qualification for the standard that is valid on the date. */
  public static boolean qualified(List<AuditorQualification> qualifications, BusinessLine standard, LocalDate on) {
    return qualifications.stream().anyMatch(q -> q.getBusinessLine().equals(standard)
        && !q.getValidFrom().isAfter(on) && !q.getValidUntil().isBefore(on));
  }

  public static List<AuditorQualification> qualificationsOf(User auditor) {
    return Query.of(AuditorQualification.class).filter("self.auditor = :auditor")
        .bind("auditor", auditor).fetch();
  }

  @Transactional(rollbackOn = {Exception.class})
  public <T extends Model> T create(T record) {
    return JPA.save(record);
  }

  @Transactional(rollbackOn = {Exception.class})
  public CertificationAudit plan(CertificationCycle cycle, int type, LocalDate plannedDate, User auditor) {
    JPA.em().lock(cycle, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    if (!qualified(qualificationsOf(auditor), cycle.getBusinessLine(), plannedDate)) {
      throw ApiException.invalidField(
          "auditorId", "NOT_QUALIFIED", "Choose an auditor qualified for this standard on the planned date.");
    }
    if (active(cycle).stream().anyMatch(a -> a.getTypeSelect() == type)) {
      throw new ApiException(409, "STAGE_EXISTS", "This stage is already planned for the cycle.", null);
    }
    CertificationAudit audit = new CertificationAudit();
    audit.setCycle(cycle);
    audit.setTypeSelect(type);
    audit.setPlannedDate(plannedDate);
    audit.setAuditor(auditor);
    audit.setStatusSelect(CertificationAuditRepository.STATUS_PLANNED);
    return JPA.save(audit);
  }

  @Transactional(rollbackOn = {Exception.class})
  public CertificationAudit complete(CertificationAudit audit, LocalDate completedOn) {
    CertificationCycle cycle = Locks.parent(audit.getCycle());
    requirePlanned(audit);
    if (audit.getTypeSelect() == CertificationAuditRepository.TYPE_STAGE2 && active(cycle).stream().noneMatch(a ->
        a.getTypeSelect() == CertificationAuditRepository.TYPE_STAGE1
            && a.getStatusSelect() == CertificationAuditRepository.STATUS_COMPLETED)) {
      throw new ApiException(422, "STAGE1_REQUIRED", "Complete the Stage 1 audit before Stage 2.", null);
    }
    audit.setStatusSelect(CertificationAuditRepository.STATUS_COMPLETED);
    audit.setCompletedOn(completedOn);
    return JPA.save(audit);
  }

  @Transactional(rollbackOn = {Exception.class})
  public CertificationAudit cancel(CertificationAudit audit) {
    Locks.parent(audit.getCycle());
    requirePlanned(audit);
    audit.setStatusSelect(CertificationAuditRepository.STATUS_CANCELLED);
    return JPA.save(audit);
  }

  @Transactional(rollbackOn = {Exception.class})
  public Nonconformity raise(CertificationAudit audit, int grade, String clause, String statement) {
    JPA.em().lock(audit, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    if (audit.getStatusSelect() == CertificationAuditRepository.STATUS_CANCELLED) {
      throw new ApiException(422, "AUDIT_CANCELLED", "A cancelled audit cannot record findings.", null);
    }
    Nonconformity nc = new Nonconformity();
    nc.setAudit(audit);
    nc.setGradeSelect(grade);
    nc.setClause(clause);
    nc.setStatement(statement);
    nc.setStatusSelect(NonconformityRepository.STATUS_OPEN);
    return JPA.save(nc);
  }

  @Transactional(rollbackOn = {Exception.class})
  public Nonconformity respond(Nonconformity nc, String response) {
    if (nc.getStatusSelect() == NonconformityRepository.STATUS_CLOSED) {
      throw new ApiException(422, "NC_CLOSED", "This nonconformity is already closed.", null);
    }
    nc.setClientResponse(response);
    nc.setStatusSelect(NonconformityRepository.STATUS_RESPONDED);
    nc.setRespondedAt(LocalDateTime.now());
    return JPA.save(nc);
  }

  @Transactional(rollbackOn = {Exception.class})
  public Nonconformity close(Nonconformity nc) {
    if (nc.getStatusSelect() != NonconformityRepository.STATUS_RESPONDED) {
      throw new ApiException(422, "RESPONSE_REQUIRED",
          "Record the client's correction and corrective action before closing.", null);
    }
    nc.setStatusSelect(NonconformityRepository.STATUS_CLOSED);
    nc.setClosedAt(LocalDateTime.now());
    return JPA.save(nc);
  }

  public static List<CertificationAudit> active(CertificationCycle cycle) {
    return Query.of(CertificationAudit.class)
        .filter("self.cycle = :cycle AND self.statusSelect <> :cancelled")
        .bind("cycle", cycle).bind("cancelled", CertificationAuditRepository.STATUS_CANCELLED)
        .order("typeSelect").fetch();
  }

  public static long openMajors(CertificationCycle cycle) {
    return Query.of(Nonconformity.class)
        .filter("self.audit.cycle = :cycle AND self.gradeSelect = :major AND self.statusSelect <> :closed")
        .bind("cycle", cycle).bind("major", NonconformityRepository.GRADE_MAJOR)
        .bind("closed", NonconformityRepository.STATUS_CLOSED).count();
  }

  /** Stage 1 and Stage 2 completed and no open major nonconformity; the decision itself is D-02. */
  public static boolean readyForDecision(CertificationCycle cycle) {
    return decisionBlockers(cycle).equals(List.of(BLOCKER_POLICY));
  }

  /** Where the cycle stands in the Stage 1 → Stage 2 → findings → decision sequence. */
  public static String phase(CertificationCycle cycle) {
    List<String> blockers = decisionBlockers(cycle);
    if (blockers.contains(BLOCKER_STAGE1)) return "STAGE1_PENDING";
    if (blockers.contains(BLOCKER_STAGE2)) return "STAGE2_PENDING";
    if (blockers.contains(BLOCKER_MAJORS)) return "FINDINGS_OPEN";
    return "READY_FOR_DECISION";
  }

  public static final String BLOCKER_STAGE1 = "STAGE1_NOT_COMPLETED";
  public static final String BLOCKER_STAGE2 = "STAGE2_NOT_COMPLETED";
  public static final String BLOCKER_MAJORS = "OPEN_MAJOR_NONCONFORMITIES";
  public static final String BLOCKER_POLICY = "POLICY_D02";

  /**
   * Everything that stands between the cycle and a certification decision, in order. The policy
   * blocker is always last and always present until D-02 is signed.
   */
  public static List<String> decisionBlockers(CertificationCycle cycle) {
    List<CertificationAudit> audits = active(cycle);
    List<String> blockers = new java.util.ArrayList<>();
    if (audits.stream().noneMatch(a -> a.getTypeSelect() == CertificationAuditRepository.TYPE_STAGE1
        && a.getStatusSelect() == CertificationAuditRepository.STATUS_COMPLETED)) {
      blockers.add(BLOCKER_STAGE1);
    }
    if (audits.stream().noneMatch(a -> a.getTypeSelect() == CertificationAuditRepository.TYPE_STAGE2
        && a.getStatusSelect() == CertificationAuditRepository.STATUS_COMPLETED)) {
      blockers.add(BLOCKER_STAGE2);
    }
    if (openMajors(cycle) > 0) blockers.add(BLOCKER_MAJORS);
    blockers.add(BLOCKER_POLICY);
    return blockers;
  }

  /** Users with a qualification for the standard valid on the date (the same rule as planning). */
  public static List<User> eligibleAuditors(BusinessLine standard, LocalDate on) {
    return Query.of(AuditorQualification.class)
        .filter("self.businessLine = :line AND self.validFrom <= :on AND self.validUntil >= :on"
            + " AND (self.auditor.blocked IS NULL OR self.auditor.blocked = false)")
        .bind("line", standard).bind("on", on).fetch().stream()
        .map(AuditorQualification::getAuditor).distinct()
        .sorted(java.util.Comparator.comparing(User::getName)).toList();
  }

  private static void requirePlanned(CertificationAudit audit) {
    if (audit.getStatusSelect() != CertificationAuditRepository.STATUS_PLANNED) {
      throw new ApiException(422, "AUDIT_STATE", "Only a planned audit can be changed this way.", null);
    }
  }
}
