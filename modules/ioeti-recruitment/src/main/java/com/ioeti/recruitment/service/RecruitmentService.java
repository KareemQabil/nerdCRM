package com.ioeti.recruitment.service;

import com.axelor.db.JPA;
import com.axelor.db.Model;
import com.axelor.db.Query;
import com.google.inject.persist.Transactional;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.Locks;
import com.ioeti.recruitment.db.CandidateApplication;
import com.ioeti.recruitment.db.CandidateConsent;
import com.ioeti.recruitment.db.CandidatePrivateProfile;
import com.ioeti.recruitment.db.ClientInterview;
import com.ioeti.recruitment.db.ClientJobOrder;
import com.ioeti.recruitment.db.Placement;
import com.ioeti.recruitment.db.RecruitmentCandidate;
import com.ioeti.recruitment.db.RecruitmentFeeMilestone;
import com.ioeti.recruitment.db.repo.CandidateApplicationRepository;
import com.ioeti.recruitment.db.repo.ClientInterviewRepository;
import com.ioeti.recruitment.db.repo.ClientJobOrderRepository;
import com.ioeti.recruitment.db.repo.PlacementRepository;
import com.ioeti.recruitment.db.repo.RecruitmentFeeMilestoneRepository;
import jakarta.persistence.LockModeType;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Map;
import java.util.Set;

/**
 * Recruitment pipeline rules for external client job orders.
 *
 * <ul>
 *   <li>Stages move forward along SOURCED → SCREENED → SHORTLISTED → SUBMITTED → INTERVIEWING →
 *       OFFERED → PLACED; REJECTED and WITHDRAWN end an application from any open stage.
 *   <li>Submission to the client needs a recorded, unrevoked consent of the candidate for this job
 *       order, and a shortlisted application. Only the non-restricted profile is shared; disclosing
 *       the private profile or CV to a client waits for D-04.
 *   <li>A placement needs an accepted offer, one per application, and never more placements than
 *       the job order's headcount; the job order is FILLED when the headcount is reached.
 *   <li>Fee milestones are billable events, recorded once per placement and kind (idempotent). Fee
 *       amounts, guarantee terms, replacements and invoicing wait for D-04 and D-06.
 * </ul>
 *
 * <p>Changes to an application lock the application row; placements lock the job order row
 * ({@code PESSIMISTIC_FORCE_INCREMENT}), so concurrent writers serialize and the second sees 409.
 */
public class RecruitmentService {

  /** Allowed manual stage moves; submission, offer and placement have their own commands. */
  static final Map<Integer, Set<Integer>> MOVES = Map.of(
      CandidateApplicationRepository.STAGE_SOURCED, Set.of(CandidateApplicationRepository.STAGE_SCREENED),
      CandidateApplicationRepository.STAGE_SCREENED, Set.of(CandidateApplicationRepository.STAGE_SHORTLISTED),
      CandidateApplicationRepository.STAGE_SUBMITTED, Set.of(CandidateApplicationRepository.STAGE_INTERVIEWING));

  public static boolean canMove(int from, int to) {
    return MOVES.getOrDefault(from, Set.of()).contains(to);
  }

  public static boolean isClosed(int stage) {
    return stage == CandidateApplicationRepository.STAGE_PLACED
        || stage == CandidateApplicationRepository.STAGE_REJECTED
        || stage == CandidateApplicationRepository.STAGE_WITHDRAWN;
  }

  @Transactional(rollbackOn = {Exception.class})
  public <T extends Model> T create(T record) {
    return JPA.save(record);
  }

  @Transactional(rollbackOn = {Exception.class})
  public CandidatePrivateProfile savePrivate(RecruitmentCandidate candidate, CandidatePrivateProfile values) {
    JPA.em().lock(candidate, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    CandidatePrivateProfile profile = privateProfile(candidate);
    if (profile == null) {
      profile = new CandidatePrivateProfile();
      profile.setCandidate(candidate);
    }
    profile.setEmail(values.getEmail());
    profile.setPhone(values.getPhone());
    profile.setExpectedSalary(values.getExpectedSalary());
    profile.setCvReference(values.getCvReference());
    return JPA.save(profile);
  }

  @Transactional(rollbackOn = {Exception.class})
  public CandidateApplication attach(ClientJobOrder order, RecruitmentCandidate candidate) {
    JPA.em().lock(order, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    if (order.getStatusSelect() != ClientJobOrderRepository.STATUS_OPEN) {
      throw new ApiException(422, "ORDER_NOT_OPEN", "This job order is not open.", null);
    }
    if (Query.of(CandidateApplication.class).filter("self.jobOrder = ?1 AND self.candidate = ?2", order, candidate).count() > 0) {
      throw new ApiException(409, "ALREADY_IN_PIPELINE", "This candidate is already in the job order's pipeline.", null);
    }
    CandidateApplication application = new CandidateApplication();
    application.setJobOrder(order);
    application.setCandidate(candidate);
    application.setStageSelect(CandidateApplicationRepository.STAGE_SOURCED);
    return JPA.save(application);
  }

  @Transactional(rollbackOn = {Exception.class})
  public CandidateApplication move(CandidateApplication application, int to) {
    JPA.em().lock(application, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    int from = application.getStageSelect();
    boolean ending = (to == CandidateApplicationRepository.STAGE_REJECTED || to == CandidateApplicationRepository.STAGE_WITHDRAWN)
        && !isClosed(from);
    if (!ending && !canMove(from, to)) {
      throw new ApiException(422, "STAGE_TRANSITION", "This stage change is not allowed from the current stage.", null);
    }
    application.setStageSelect(to);
    return JPA.save(application);
  }

  @Transactional(rollbackOn = {Exception.class})
  public CandidateApplication submit(CandidateApplication application) {
    JPA.em().lock(application, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    if (application.getStageSelect() != CandidateApplicationRepository.STAGE_SHORTLISTED) {
      throw new ApiException(422, "STAGE_TRANSITION", "Only a shortlisted candidate can be submitted.", null);
    }
    if (validConsent(application.getCandidate(), application.getJobOrder()) == null) {
      throw new ApiException(422, "CONSENT_REQUIRED",
          "Record the candidate's consent for this job order before submitting.", null);
    }
    application.setStageSelect(CandidateApplicationRepository.STAGE_SUBMITTED);
    application.setSubmittedAt(LocalDateTime.now());
    return JPA.save(application);
  }

  @Transactional(rollbackOn = {Exception.class})
  public ClientInterview interview(CandidateApplication application, int round, LocalDateTime at) {
    JPA.em().lock(application, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    int stage = application.getStageSelect();
    if (stage != CandidateApplicationRepository.STAGE_SUBMITTED && stage != CandidateApplicationRepository.STAGE_INTERVIEWING) {
      throw new ApiException(422, "STAGE_TRANSITION", "Interviews follow a submission to the client.", null);
    }
    ClientInterview interview = new ClientInterview();
    interview.setApplication(application);
    interview.setRound(round);
    interview.setScheduledAt(at);
    interview.setOutcomeSelect(ClientInterviewRepository.OUTCOME_PENDING);
    application.setStageSelect(CandidateApplicationRepository.STAGE_INTERVIEWING);
    return JPA.save(interview);
  }

  @Transactional(rollbackOn = {Exception.class})
  public ClientInterview outcome(ClientInterview interview, int outcome) {
    JPA.em().lock(interview.getApplication(), LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    if (interview.getOutcomeSelect() != ClientInterviewRepository.OUTCOME_PENDING) {
      throw new ApiException(422, "OUTCOME_RECORDED", "This interview already has an outcome.", null);
    }
    interview.setOutcomeSelect(outcome);
    return JPA.save(interview);
  }

  @Transactional(rollbackOn = {Exception.class})
  public CandidateApplication offer(CandidateApplication application, LocalDate offerDate) {
    JPA.em().lock(application, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    boolean passed = Query.of(ClientInterview.class)
        .filter("self.application = ?1 AND self.outcomeSelect = ?2", application, ClientInterviewRepository.OUTCOME_PASSED)
        .count() > 0;
    if (application.getStageSelect() != CandidateApplicationRepository.STAGE_INTERVIEWING || !passed) {
      throw new ApiException(422, "STAGE_TRANSITION", "An offer follows a passed client interview.", null);
    }
    application.setStageSelect(CandidateApplicationRepository.STAGE_OFFERED);
    application.setOfferDate(offerDate);
    application.setOfferStatusSelect(CandidateApplicationRepository.OFFER_PENDING);
    return JPA.save(application);
  }

  @Transactional(rollbackOn = {Exception.class})
  public CandidateApplication offerAnswer(CandidateApplication application, boolean accepted) {
    JPA.em().lock(application, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    if (application.getStageSelect() != CandidateApplicationRepository.STAGE_OFFERED
        || !Integer.valueOf(CandidateApplicationRepository.OFFER_PENDING).equals(application.getOfferStatusSelect())) {
      throw new ApiException(422, "STAGE_TRANSITION", "There is no pending offer to answer.", null);
    }
    application.setOfferStatusSelect(accepted ? CandidateApplicationRepository.OFFER_ACCEPTED : CandidateApplicationRepository.OFFER_DECLINED);
    if (!accepted) application.setStageSelect(CandidateApplicationRepository.STAGE_WITHDRAWN);
    return JPA.save(application);
  }

  @Transactional(rollbackOn = {Exception.class})
  public Placement place(CandidateApplication application, LocalDate startDate) {
    ClientJobOrder order = Locks.parent(application.getJobOrder());
    if (Query.of(Placement.class).filter("self.application = ?1", application).count() > 0) {
      throw new ApiException(409, "ALREADY_PLACED", "This candidate is already placed for the job order.", null);
    }
    if (application.getStageSelect() != CandidateApplicationRepository.STAGE_OFFERED
        || !Integer.valueOf(CandidateApplicationRepository.OFFER_ACCEPTED).equals(application.getOfferStatusSelect())) {
      throw new ApiException(422, "STAGE_TRANSITION", "A placement follows an accepted offer.", null);
    }
    long placed = Query.of(Placement.class).filter("self.application.jobOrder = ?1", order).count();
    if (placed >= order.getHeadcount()) {
      throw new ApiException(422, "HEADCOUNT_FILLED", "Every position of this job order is already filled.", null);
    }
    Placement placement = new Placement();
    placement.setApplication(application);
    placement.setStartDate(startDate);
    placement.setGuaranteeStatusSelect(PlacementRepository.GUARANTEE_TERMS_PENDING);
    application.setStageSelect(CandidateApplicationRepository.STAGE_PLACED);
    if (placed + 1 >= order.getHeadcount()) order.setStatusSelect(ClientJobOrderRepository.STATUS_FILLED);
    JPA.save(placement);
    recordMilestone(placement, RecruitmentFeeMilestoneRepository.KIND_OFFER_ACCEPTED, application.getOfferDate());
    return placement;
  }

  /** Records a billable event once per placement and kind; a repeat returns the existing one. */
  @Transactional(rollbackOn = {Exception.class})
  public RecruitmentFeeMilestone recordMilestone(Placement placement, int kind, LocalDate occurredOn) {
    RecruitmentFeeMilestone existing = Query.of(RecruitmentFeeMilestone.class)
        .filter("self.placement = ?1 AND self.kindSelect = ?2", placement, kind).fetchOne();
    if (existing != null) return existing;
    RecruitmentFeeMilestone milestone = new RecruitmentFeeMilestone();
    milestone.setPlacement(placement);
    milestone.setKindSelect(kind);
    milestone.setOccurredOn(occurredOn == null ? LocalDate.now() : occurredOn);
    return JPA.save(milestone);
  }

  @Transactional(rollbackOn = {Exception.class})
  public CandidateConsent revoke(CandidateConsent consent) {
    if (consent.getRevokedAt() != null) {
      throw new ApiException(422, "CONSENT_REVOKED", "This consent is already revoked.", null);
    }
    consent.setRevokedAt(LocalDateTime.now());
    return JPA.save(consent);
  }

  public static CandidateConsent validConsent(RecruitmentCandidate candidate, ClientJobOrder order) {
    return Query.of(CandidateConsent.class)
        .filter("self.candidate = ?1 AND self.jobOrder = ?2 AND self.revokedAt IS NULL", candidate, order)
        .order("-id").fetchOne();
  }

  public static CandidatePrivateProfile privateProfile(RecruitmentCandidate candidate) {
    return Query.of(CandidatePrivateProfile.class).filter("self.candidate = ?1", candidate).fetchOne();
  }
}
