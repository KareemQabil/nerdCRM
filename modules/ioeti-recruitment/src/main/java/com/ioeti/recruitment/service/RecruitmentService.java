package com.ioeti.recruitment.service;

import com.axelor.apps.base.db.Currency;
import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.User;
import com.axelor.db.JPA;
import com.axelor.db.Model;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.google.inject.persist.Transactional;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.Locks;
import com.ioeti.core.db.PolicyVersion;
import com.ioeti.core.notify.Notifier;
import com.ioeti.core.policy.PolicyService;
import com.ioeti.recruitment.db.CandidateApplication;
import com.ioeti.recruitment.db.CandidateConsent;
import com.ioeti.recruitment.db.CandidatePrivateProfile;
import com.ioeti.recruitment.db.ClientInterview;
import com.ioeti.recruitment.db.ClientJobOrder;
import com.ioeti.recruitment.db.OfferPrivateTerms;
import com.ioeti.recruitment.db.Placement;
import com.ioeti.recruitment.db.RecruitmentCandidate;
import com.ioeti.recruitment.db.RecruitmentFeeMilestone;
import com.ioeti.recruitment.db.RecruitmentFeeRequest;
import com.ioeti.recruitment.db.repo.CandidateApplicationRepository;
import com.ioeti.recruitment.db.repo.ClientInterviewRepository;
import com.ioeti.recruitment.db.repo.ClientJobOrderRepository;
import com.ioeti.recruitment.db.repo.PlacementRepository;
import com.ioeti.recruitment.db.repo.RecruitmentFeeMilestoneRepository;
import com.ioeti.recruitment.db.repo.RecruitmentFeeRequestRepository;
import jakarta.persistence.LockModeType;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
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
 *   <li>Fee milestones are billable events, recorded once per placement and kind (idempotent).
 *   <li>D-04 (signed 2026-10-25): the client agreement (policy {@code recruitment.agreement}, per client or a default)
 *       is copied onto the placement once. When its trigger happens (offer accepted, or the candidate's start), the
 *       fee (feePercent × the offered annual salary, read on the server only) becomes one fee request for finance.
 *       The guarantee runs from the start for guaranteeDays; an exit within it applies the agreement's rule:
 *       a free replacement on the job order, a partial credit request for finance, or nothing.
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
    return offer(application, offerDate, null, null);
  }

  /** Records the client's offer; the offered annual salary, when given, is kept apart as restricted data. */
  @Transactional(rollbackOn = {Exception.class})
  public CandidateApplication offer(CandidateApplication application, LocalDate offerDate, BigDecimal annualSalary, Currency currency) {
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
    if (annualSalary != null) {
      OfferPrivateTerms terms = offerTerms(application);
      if (terms == null) {
        terms = new OfferPrivateTerms();
        terms.setApplication(application);
      }
      terms.setAnnualSalary(annualSalary);
      terms.setCurrency(currency);
      JPA.save(terms);
    }
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
    long placed = activePlacements(order);
    if (placed >= order.getHeadcount()) {
      throw new ApiException(422, "HEADCOUNT_FILLED", "Every position of this job order is already filled.", null);
    }
    Placement placement = new Placement();
    placement.setApplication(application);
    placement.setStartDate(startDate);
    placement.setGuaranteeStatusSelect(PlacementRepository.GUARANTEE_TERMS_PENDING);
    // a free replacement promised by the agreement after an early exit on this job order: no new fee
    Placement replaced = openReplacement(order);
    if (replaced != null) {
      placement.setReplacementOf(replaced);
      placement.setFeeWaived(true);
    }
    application.setStageSelect(CandidateApplicationRepository.STAGE_PLACED);
    if (placed + 1 >= order.getHeadcount()) order.setStatusSelect(ClientJobOrderRepository.STATUS_FILLED);
    JPA.save(placement);
    recordMilestone(placement, RecruitmentFeeMilestoneRepository.KIND_OFFER_ACCEPTED, application.getOfferDate());
    settle(placement, LocalDate.now());
    return placement;
  }

  /** Placements that hold a position: one whose candidate left with a free replacement opened no longer does. */
  public static long activePlacements(ClientJobOrder order) {
    return Query.of(Placement.class).filter("self.application.jobOrder = ?1 AND (self.exitOutcomeSelect IS NULL OR self.exitOutcomeSelect != ?2)",
        order, PlacementRepository.OUTCOME_REPLACEMENT_OPENED).count();
  }

  /** The earliest early exit on the job order whose free replacement has not been placed yet. */
  static Placement openReplacement(ClientJobOrder order) {
    for (Placement exited : Query.of(Placement.class).filter("self.application.jobOrder = ?1 AND self.exitOutcomeSelect = ?2",
        order, PlacementRepository.OUTCOME_REPLACEMENT_OPENED).order("id").fetch()) {
      if (Query.of(Placement.class).filter("self.replacementOf = ?1", exited).count() == 0) return exited;
    }
    return null;
  }

  /** Records the candidate's start (once) and, when the client agreement invoices on the start date, the fee request. */
  @Transactional(rollbackOn = {Exception.class})
  public Placement started(Placement placement, LocalDate startedOn) {
    Locks.parent(placement);
    recordMilestone(placement, RecruitmentFeeMilestoneRepository.KIND_CANDIDATE_STARTED, startedOn);
    settle(placement, LocalDate.now());
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

  // --- D-04: client agreement, fee requests and the guarantee ------------------------------------------

  /** Records (or replaces) the offered pay; it is read on the server only, to compute the fee. */
  @Transactional(rollbackOn = {Exception.class})
  public CandidateApplication saveOfferTerms(CandidateApplication application, BigDecimal annualSalary, Currency currency) {
    JPA.em().lock(application, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    if (application.getOfferDate() == null) {
      throw new ApiException(422, "STAGE_TRANSITION", "Record the client's offer first.", null);
    }
    Placement placement = Query.of(Placement.class).filter("self.application = ?1", application).fetchOne();
    if (placement != null && feeRequest(placement, RecruitmentFeeRequestRepository.KIND_FEE_INVOICE) != null) {
      throw new ApiException(422, "FEE_REQUESTED", "The fee was already requested from finance; the offer terms are kept as they were.", null);
    }
    OfferPrivateTerms terms = offerTerms(application);
    if (terms == null) {
      terms = new OfferPrivateTerms();
      terms.setApplication(application);
    }
    terms.setAnnualSalary(annualSalary);
    terms.setCurrency(currency);
    JPA.save(terms);
    if (placement != null) settle(placement, LocalDate.now());
    return application;
  }

  /**
   * Copies the client agreement in force today onto the placement (once) and, when its trigger has happened, records
   * the fee request (once). Never fails: what is still missing is read back with {@link #feeStatus}.
   */
  @Transactional(rollbackOn = {Exception.class})
  public void settle(Placement placement, LocalDate today) {
    applyTerms(placement, today);
    if (feeBlocker(placement) == null) {
      OfferPrivateTerms terms = offerTerms(placement.getApplication());
      BigDecimal amount = PlacementTerms.fee(terms.getAnnualSalary(), placement.getFeePercent());
      RecruitmentFeeRequest request = request(placement, RecruitmentFeeRequestRepository.KIND_FEE_INVOICE, amount,
          terms.getCurrency(), placement.getFeePercent(), null);
      notifyFinance(request, "RECRUITMENT_FEE_REQUESTED", "Placement fee " + placement.getApplication().getJobOrder().getReference());
    }
  }

  /** The fee request, idempotently: an existing one is returned; otherwise it is created now or refused with the reason. */
  @Transactional(rollbackOn = {Exception.class})
  public RecruitmentFeeRequest requestFee(Placement placement, LocalDate today) {
    Locks.parent(placement);
    settle(placement, today);
    RecruitmentFeeRequest existing = feeRequest(placement, RecruitmentFeeRequestRepository.KIND_FEE_INVOICE);
    if (existing != null) return existing;
    String reason = feeBlocker(placement);
    throw switch (reason == null ? "" : reason) {
      case "POLICY_NOT_SET" -> new ApiException(422, "POLICY_NOT_SET", "The client agreement (policy '" + PlacementTerms.KEY
          + "') is not set for this client and there is no default; a policy owner sets it under Policies.", null);
      case "WAIVED_REPLACEMENT" -> new ApiException(422, "FEE_WAIVED", "This placement is the free replacement the client agreement promised; it has no fee.", null);
      case "OFFER_TERMS_MISSING" -> new ApiException(422, "OFFER_TERMS_MISSING", "Record the offered annual salary first; the fee is a share of it.", null);
      case "NOT_DUE" -> new ApiException(422, "FEE_NOT_DUE", "The client agreement invoices the fee when the candidate starts; record the start first.", null);
      default -> new ApiException(422, "FEE_NOT_DUE", "The fee cannot be requested yet.", null);
    };
  }

  /**
   * Records that the candidate left and applies the client agreement: within the guarantee, REPLACE reopens the job
   * order for a free replacement, PARTIAL_REFUND asks finance to credit refundPercent of the fee, NONE does nothing.
   */
  @Transactional(rollbackOn = {Exception.class})
  public Placement exit(Placement placement, LocalDate exitedOn, int reason, LocalDate today) {
    ClientJobOrder order = Locks.parent(placement.getApplication().getJobOrder());
    JPA.em().lock(placement, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    if (placement.getExitedOn() != null) {
      throw new ApiException(409, "ALREADY_EXITED", "This candidate's departure is already recorded.", null);
    }
    LocalDate startedOn = startedOn(placement);
    if (startedOn == null) {
      throw new ApiException(422, "NOT_STARTED", "Record that the candidate started before recording a departure.", null);
    }
    if (exitedOn.isBefore(startedOn)) {
      throw ApiException.invalidField("exitedOn", "RANGE", "The candidate cannot leave before starting.");
    }
    applyTerms(placement, today);
    if (placement.getAgreementPolicy() == null) {
      throw new ApiException(422, "POLICY_NOT_SET", "The client agreement (policy '" + PlacementTerms.KEY
          + "') is not set for this client and there is no default; a policy owner sets it under Policies.", null);
    }
    RecruitmentFeeRequest fee = feeRequest(placement, RecruitmentFeeRequestRepository.KIND_FEE_INVOICE);
    boolean within = PlacementTerms.within(exitedOn, placement.getGuaranteeEndsOn());
    PlacementTerms.Outcome outcome = PlacementTerms.outcome(rule(placement), within,
        fee != null && fee.getStatusSelect() != RecruitmentFeeRequestRepository.STATUS_CANCELLED);
    placement.setExitedOn(exitedOn);
    placement.setExitReasonSelect(reason);
    placement.setGuaranteeStatusSelect(PlacementRepository.GUARANTEE_EXITED);
    switch (outcome) {
      case REPLACEMENT_OPENED -> {
        placement.setExitOutcomeSelect(PlacementRepository.OUTCOME_REPLACEMENT_OPENED);
        order.setStatusSelect(ClientJobOrderRepository.STATUS_OPEN);
        JPA.save(order);
        Beans.get(Notifier.class).notify(order.getRecruiter(), "RECRUITMENT_REPLACEMENT_OPENED", "PLACEMENT", placement.getId(),
            "Free replacement on " + order.getReference());
      }
      case REFUND_REQUESTED -> {
        placement.setExitOutcomeSelect(PlacementRepository.OUTCOME_REFUND_REQUESTED);
        RecruitmentFeeRequest credit = request(placement, RecruitmentFeeRequestRepository.KIND_REFUND_CREDIT,
            PlacementTerms.refund(fee.getAmountBeforeTax(), placement.getRefundPercent()), fee.getCurrency(), placement.getRefundPercent(), fee);
        notifyFinance(credit, "RECRUITMENT_REFUND_REQUESTED", "Placement fee credit " + order.getReference());
      }
      case NO_FEE_TO_REFUND -> placement.setExitOutcomeSelect(PlacementRepository.OUTCOME_NO_FEE_TO_REFUND);
      case OUTSIDE_GUARANTEE -> placement.setExitOutcomeSelect(PlacementRepository.OUTCOME_OUTSIDE_GUARANTEE);
      default -> placement.setExitOutcomeSelect(PlacementRepository.OUTCOME_NO_REMEDY);
    }
    return JPA.save(placement);
  }

  /** Copies the agreement in force today onto the placement once, and dates the guarantee once the start is known. */
  void applyTerms(Placement placement, LocalDate today) {
    if (placement.getAgreementPolicy() == null) {
      Optional<PolicyService.Applied> applied = Beans.get(PolicyService.class)
          .current(PlacementTerms.KEY, agreementScope(placement), today);
      if (applied.isEmpty()) return;
      PlacementTerms.Agreement agreement = PlacementTerms.Agreement.of(applied.get().value());
      placement.setAgreementPolicy(JPA.find(PolicyVersion.class, applied.get().versionId()));
      placement.setFeePercent(agreement.feePercent());
      placement.setInvoiceOnSelect(PlacementTerms.OFFER_ACCEPTED.equals(agreement.invoiceOn())
          ? PlacementRepository.INVOICE_ON_OFFER_ACCEPTED : PlacementRepository.INVOICE_ON_START_DATE);
      placement.setGuaranteeDays(agreement.guaranteeDays());
      placement.setReplacementSelect(switch (agreement.replacement()) {
        case PlacementTerms.REPLACE -> PlacementRepository.RULE_REPLACE;
        case PlacementTerms.PARTIAL_REFUND -> PlacementRepository.RULE_PARTIAL_REFUND;
        default -> PlacementRepository.RULE_NONE;
      });
      placement.setRefundPercent(agreement.refundPercent());
      if (placement.getGuaranteeStatusSelect() == PlacementRepository.GUARANTEE_TERMS_PENDING) {
        placement.setGuaranteeStatusSelect(PlacementRepository.GUARANTEE_TERMS_APPLIED);
      }
    }
    LocalDate startedOn = startedOn(placement);
    if (placement.getGuaranteeEndsOn() == null && startedOn != null && placement.getGuaranteeDays() != null) {
      placement.setGuaranteeEndsOn(PlacementTerms.guaranteeEnd(startedOn, placement.getGuaranteeDays()));
    }
    JPA.save(placement);
  }

  /** Why no fee request can be recorded now, or null when it can (or already is). */
  public static String feeBlocker(Placement placement) {
    if (feeRequest(placement, RecruitmentFeeRequestRepository.KIND_FEE_INVOICE) != null) return null;
    if (Boolean.TRUE.equals(placement.getFeeWaived())) return "WAIVED_REPLACEMENT";
    if (placement.getAgreementPolicy() == null) return "POLICY_NOT_SET";
    String invoiceOn = invoiceOn(placement);
    if (!PlacementTerms.due(invoiceOn, milestone(placement, RecruitmentFeeMilestoneRepository.KIND_OFFER_ACCEPTED) != null,
        startedOn(placement) != null)) {
      return "NOT_DUE";
    }
    return offerTerms(placement.getApplication()) == null ? "OFFER_TERMS_MISSING" : null;
  }

  /** REQUESTED / CANCELLED / ISSUED once requested; otherwise what it waits for (see {@link #feeBlocker}). */
  public static String feeStatus(Placement placement) {
    RecruitmentFeeRequest request = feeRequest(placement, RecruitmentFeeRequestRepository.KIND_FEE_INVOICE);
    if (request != null) return requestStatus(request);
    String blocker = feeBlocker(placement);
    return blocker == null ? "NOT_DUE" : blocker;
  }

  public static String requestStatus(RecruitmentFeeRequest request) {
    return switch (request.getStatusSelect()) {
      case RecruitmentFeeRequestRepository.STATUS_CANCELLED -> "CANCELLED";
      case RecruitmentFeeRequestRepository.STATUS_ISSUED -> "ISSUED";
      default -> "REQUESTED";
    };
  }

  public static String invoiceOn(Placement placement) {
    return Integer.valueOf(PlacementRepository.INVOICE_ON_OFFER_ACCEPTED).equals(placement.getInvoiceOnSelect())
        ? PlacementTerms.OFFER_ACCEPTED : PlacementTerms.START_DATE;
  }

  public static String rule(Placement placement) {
    Integer rule = placement.getReplacementSelect();
    if (rule == null) return null;
    return rule == PlacementRepository.RULE_REPLACE ? PlacementTerms.REPLACE
        : rule == PlacementRepository.RULE_PARTIAL_REFUND ? PlacementTerms.PARTIAL_REFUND : PlacementTerms.NONE;
  }

  /** The agreement's scope: the client account id (a policy owner may also set a default for every client). */
  public static String agreementScope(Placement placement) {
    return String.valueOf(placement.getApplication().getJobOrder().getClient().getId());
  }

  public static LocalDate startedOn(Placement placement) {
    RecruitmentFeeMilestone started = milestone(placement, RecruitmentFeeMilestoneRepository.KIND_CANDIDATE_STARTED);
    return started == null ? null : started.getOccurredOn();
  }

  static RecruitmentFeeMilestone milestone(Placement placement, int kind) {
    return Query.of(RecruitmentFeeMilestone.class).filter("self.placement = ?1 AND self.kindSelect = ?2", placement, kind).fetchOne();
  }

  public static RecruitmentFeeRequest feeRequest(Placement placement, int kind) {
    return Query.of(RecruitmentFeeRequest.class).filter("self.placement = ?1 AND self.kindSelect = ?2", placement, kind).fetchOne();
  }

  public static OfferPrivateTerms offerTerms(CandidateApplication application) {
    return Query.of(OfferPrivateTerms.class).filter("self.application = ?1", application).fetchOne();
  }

  private static RecruitmentFeeRequest request(Placement placement, int kind, BigDecimal amount, Currency currency, BigDecimal rate,
      RecruitmentFeeRequest refundOf) {
    RecruitmentFeeRequest request = new RecruitmentFeeRequest();
    request.setPlacement(placement);
    request.setKindSelect(kind);
    request.setClient(placement.getApplication().getJobOrder().getClient());
    request.setAmountBeforeTax(amount);
    request.setCurrency(currency);
    request.setRatePercent(rate);
    request.setAgreementPolicy(placement.getAgreementPolicy());
    request.setRefundOf(refundOf);
    request.setStatusSelect(RecruitmentFeeRequestRepository.STATUS_REQUESTED);
    request.setRequestedBy(AuthUtils.getUser());
    request.setRequestedAt(LocalDateTime.now());
    return JPA.save(request);
  }

  /** The finance role named in D-07's role templates. */
  public static final String FINANCE_ROLE = "ioeti-finance";

  /** People holding the finance role (directly or through their group): they act on fee and credit requests. */
  public static List<User> financeHolders() {
    Set<User> holders = new LinkedHashSet<>(Query.of(User.class).filter(
        "(self.blocked IS NULL OR self.blocked = false) AND EXISTS (SELECT r FROM Role r WHERE r.name = ?1 AND r MEMBER OF self.roles)",
        FINANCE_ROLE).fetch(100));
    holders.addAll(Query.of(User.class).filter(
        "(self.blocked IS NULL OR self.blocked = false) AND self.group IS NOT NULL AND EXISTS (SELECT r FROM Role r WHERE r.name = ?1 AND r MEMBER OF self.group.roles)",
        FINANCE_ROLE).fetch(100));
    return new ArrayList<>(holders);
  }

  private static void notifyFinance(RecruitmentFeeRequest request, String kind, String title) {
    Notifier notifier = Beans.get(Notifier.class);
    for (User holder : financeHolders()) notifier.notify(holder, kind, "PLACEMENT", request.getPlacement().getId(), title);
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
