package com.ioeti.fundraising.service;

import com.axelor.auth.AuthUtils;
import com.axelor.db.JPA;
import com.axelor.db.Model;
import com.axelor.db.Query;
import com.google.inject.persist.Transactional;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.Locks;
import com.ioeti.fundraising.db.DonationCollection;
import com.ioeti.fundraising.db.DonorProfile;
import com.ioeti.fundraising.db.DonorSensitiveProfile;
import com.ioeti.fundraising.db.FundingCommitment;
import com.ioeti.fundraising.db.FundingOpportunity;
import com.ioeti.fundraising.db.GrantDeliverable;
import com.ioeti.fundraising.db.PledgeInstallment;
import com.ioeti.fundraising.db.repo.DonationCollectionRepository;
import com.ioeti.fundraising.db.repo.FundingOpportunityRepository;
import com.ioeti.fundraising.db.repo.GrantDeliverableRepository;
import com.ioeti.fundraising.db.repo.PledgeInstallmentRepository;
import jakarta.persistence.LockModeType;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Fundraising rules. Money moves through stages that are kept apart and never added into each
 * other: a proposed amount (opportunity), a committed amount (the donor's approval), scheduled
 * installments and collections actually received. A pledge is not cash: only a collection recorded
 * against a bank reference counts as collected.
 *
 * <ul>
 *   <li>Opportunity stages: IDENTIFIED → PROPOSAL → SUBMITTED → APPROVED (through {@link #approve});
 *       DECLINED and WITHDRAWN end an open opportunity.
 *   <li>Installments of a commitment never add up to more than the committed amount.
 *   <li>A collection belongs to one installment, never exceeds what is still due on it, and its bank
 *       reference is unique, so recording the same payment twice is refused (409).
 *   <li>Collections are voided, never deleted; opportunities are archived, never deleted.
 *   <li>Receipts, restricted-fund allocation, invoices and posting to accounting wait for D-05/D-06.
 * </ul>
 *
 * <p>Writers on a commitment (approval, schedule, collections, deliverables) lock the commitment row
 * ({@code PESSIMISTIC_FORCE_INCREMENT}), so concurrent changes serialize and the second sees 409.
 */
public class FundraisingService {

  static final Map<Integer, Set<Integer>> MOVES = Map.of(
      FundingOpportunityRepository.STAGE_IDENTIFIED, Set.of(FundingOpportunityRepository.STAGE_PROPOSAL),
      FundingOpportunityRepository.STAGE_PROPOSAL, Set.of(FundingOpportunityRepository.STAGE_SUBMITTED));

  public static boolean canMove(int from, int to) {
    if (isOpen(from) && (to == FundingOpportunityRepository.STAGE_DECLINED || to == FundingOpportunityRepository.STAGE_WITHDRAWN)) {
      return true;
    }
    return MOVES.getOrDefault(from, Set.of()).contains(to);
  }

  public static boolean isOpen(int stage) {
    return stage == FundingOpportunityRepository.STAGE_IDENTIFIED
        || stage == FundingOpportunityRepository.STAGE_PROPOSAL
        || stage == FundingOpportunityRepository.STAGE_SUBMITTED;
  }

  @Transactional(rollbackOn = {Exception.class})
  public <T extends Model> T create(T record) {
    return JPA.save(record);
  }

  @Transactional(rollbackOn = {Exception.class})
  public DonorSensitiveProfile saveSensitive(DonorProfile donor, DonorSensitiveProfile values) {
    JPA.em().lock(donor, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    DonorSensitiveProfile profile = sensitive(donor);
    if (profile == null) {
      profile = new DonorSensitiveProfile();
      profile.setDonor(donor);
    }
    if (values.getGivingCapacity() != null) profile.setGivingCapacity(values.getGivingCapacity());
    if (values.getContactPreference() != null) profile.setContactPreference(values.getContactPreference());
    if (values.getRelationshipNote() != null) profile.setRelationshipNote(values.getRelationshipNote());
    return JPA.save(profile);
  }

  @Transactional(rollbackOn = {Exception.class})
  public FundingOpportunity move(FundingOpportunity opportunity, int stage) {
    JPA.em().lock(opportunity, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    if (!canMove(opportunity.getStageSelect(), stage)) {
      throw new ApiException(422, "STAGE_TRANSITION", "This stage change is not allowed from the current stage.", null);
    }
    opportunity.setStageSelect(stage);
    return JPA.save(opportunity);
  }

  /** Records the donor's approval of a submitted opportunity as a commitment (not cash, not revenue). */
  @Transactional(rollbackOn = {Exception.class})
  public FundingCommitment approve(FundingOpportunity opportunity, FundingCommitment values) {
    JPA.em().lock(opportunity, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    if (commitment(opportunity) != null) {
      throw new ApiException(409, "ALREADY_COMMITTED", "This opportunity already has a commitment.", null);
    }
    if (opportunity.getStageSelect() != FundingOpportunityRepository.STAGE_SUBMITTED) {
      throw new ApiException(422, "STAGE_TRANSITION", "Only a submitted proposal can be approved.", null);
    }
    values.setOpportunity(opportunity);
    opportunity.setStageSelect(FundingOpportunityRepository.STAGE_APPROVED);
    JPA.save(opportunity);
    return JPA.save(values);
  }

  @Transactional(rollbackOn = {Exception.class})
  public FundingOpportunity archive(FundingOpportunity opportunity) {
    JPA.em().lock(opportunity, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    if (commitment(opportunity) != null) {
      throw new ApiException(422, "HAS_COMMITMENT", "An opportunity with a commitment is kept for the record.", null);
    }
    opportunity.setArchived(true);
    return JPA.save(opportunity);
  }

  @Transactional(rollbackOn = {Exception.class})
  public PledgeInstallment schedule(FundingCommitment commitment, LocalDate dueDate, BigDecimal amount) {
    JPA.em().lock(commitment, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    if (scheduled(commitment).add(amount).compareTo(commitment.getCommittedAmount()) > 0) {
      throw new ApiException(422, "SCHEDULE_EXCEEDS_COMMITMENT",
          "The installments would add up to more than the committed amount.", null);
    }
    Integer last = JPA.em().createQuery(
            "SELECT MAX(i.sequence) FROM PledgeInstallment i WHERE i.commitment = :c", Integer.class)
        .setParameter("c", commitment).getSingleResult();
    PledgeInstallment installment = new PledgeInstallment();
    installment.setCommitment(commitment);
    installment.setSequence(last == null ? 1 : last + 1);
    installment.setDueDate(dueDate);
    installment.setAmount(amount);
    installment.setStatusSelect(PledgeInstallmentRepository.STATUS_SCHEDULED);
    return JPA.save(installment);
  }

  @Transactional(rollbackOn = {Exception.class})
  public PledgeInstallment cancel(PledgeInstallment installment) {
    Locks.parent(installment.getCommitment());
    if (installment.getStatusSelect() != PledgeInstallmentRepository.STATUS_SCHEDULED) {
      throw new ApiException(422, "INSTALLMENT_STATE", "This installment is already cancelled.", null);
    }
    if (collected(installment).signum() > 0) {
      throw new ApiException(422, "HAS_COLLECTIONS", "An installment with recorded collections cannot be cancelled.", null);
    }
    installment.setStatusSelect(PledgeInstallmentRepository.STATUS_CANCELLED);
    return JPA.save(installment);
  }

  /** Records money received against a bank reference. The same reference twice is refused (409). */
  @Transactional(rollbackOn = {Exception.class})
  public DonationCollection collect(PledgeInstallment installment, BigDecimal amount, LocalDate receivedOn, String bankReference) {
    Locks.parent(installment.getCommitment());
    // one bank reference across every commitment: concurrent writers of the same reference take turns
    Locks.key("ioeti.collection", bankReference);
    if (Query.of(DonationCollection.class).filter("self.bankReference = ?1", bankReference).count() > 0) {
      throw new ApiException(409, "DUPLICATE_COLLECTION", "A collection with this bank reference is already recorded.", null);
    }
    if (installment.getStatusSelect() != PledgeInstallmentRepository.STATUS_SCHEDULED) {
      throw new ApiException(422, "INSTALLMENT_STATE", "This installment is cancelled.", null);
    }
    if (collected(installment).add(amount).compareTo(installment.getAmount()) > 0) {
      throw new ApiException(422, "OVER_COLLECTION", "This is more than is still due on the installment.", null);
    }
    DonationCollection collection = new DonationCollection();
    collection.setInstallment(installment);
    collection.setAmount(amount);
    collection.setReceivedOn(receivedOn);
    collection.setBankReference(bankReference);
    collection.setStatusSelect(DonationCollectionRepository.STATUS_RECORDED);
    return JPA.save(collection);
  }

  /** Corrections keep the row: a voided collection stays visible and stops counting as collected. */
  @Transactional(rollbackOn = {Exception.class})
  public DonationCollection voidCollection(DonationCollection collection, int reason) {
    Locks.parent(collection.getInstallment().getCommitment());
    if (collection.getStatusSelect() == DonationCollectionRepository.STATUS_VOIDED) {
      throw new ApiException(422, "ALREADY_VOIDED", "This collection is already voided.", null);
    }
    collection.setStatusSelect(DonationCollectionRepository.STATUS_VOIDED);
    collection.setVoidReasonSelect(reason);
    collection.setVoidedAt(LocalDateTime.now());
    collection.setVoidedBy(AuthUtils.getUser());
    return JPA.save(collection);
  }

  @Transactional(rollbackOn = {Exception.class})
  public GrantDeliverable addDeliverable(FundingCommitment commitment, String title, LocalDate dueDate) {
    JPA.em().lock(commitment, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    GrantDeliverable deliverable = new GrantDeliverable();
    deliverable.setCommitment(commitment);
    deliverable.setTitle(title);
    deliverable.setDueDate(dueDate);
    deliverable.setStatusSelect(GrantDeliverableRepository.STATUS_PENDING);
    return JPA.save(deliverable);
  }

  @Transactional(rollbackOn = {Exception.class})
  public GrantDeliverable advance(GrantDeliverable deliverable, int status, LocalDate on) {
    Locks.parent(deliverable.getCommitment());
    if (status != deliverable.getStatusSelect() + 1) {
      throw new ApiException(422, "DELIVERABLE_STATE", "A deliverable is submitted, then accepted.", null);
    }
    deliverable.setStatusSelect(status);
    if (status == GrantDeliverableRepository.STATUS_SUBMITTED) deliverable.setSubmittedOn(on);
    return JPA.save(deliverable);
  }

  // --- reads ---------------------------------------------------------------------------------------

  public static DonorSensitiveProfile sensitive(DonorProfile donor) {
    return Query.of(DonorSensitiveProfile.class).filter("self.donor = ?1", donor).fetchOne();
  }

  public static FundingCommitment commitment(FundingOpportunity opportunity) {
    return Query.of(FundingCommitment.class).filter("self.opportunity = ?1", opportunity).fetchOne();
  }

  public static List<PledgeInstallment> installments(FundingCommitment commitment) {
    return Query.of(PledgeInstallment.class).filter("self.commitment = ?1", commitment).order("sequence").fetch();
  }

  public static BigDecimal scheduled(FundingCommitment commitment) {
    return sum("SELECT SUM(i.amount) FROM PledgeInstallment i WHERE i.commitment = :x AND i.statusSelect = "
        + PledgeInstallmentRepository.STATUS_SCHEDULED, commitment);
  }

  public static BigDecimal collected(FundingCommitment commitment) {
    return sum("SELECT SUM(c.amount) FROM DonationCollection c WHERE c.installment.commitment = :x AND c.statusSelect = "
        + DonationCollectionRepository.STATUS_RECORDED, commitment);
  }

  public static BigDecimal collected(PledgeInstallment installment) {
    return sum("SELECT SUM(c.amount) FROM DonationCollection c WHERE c.installment = :x AND c.statusSelect = "
        + DonationCollectionRepository.STATUS_RECORDED, installment);
  }

  private static BigDecimal sum(String jpql, Object owner) {
    BigDecimal value = JPA.em().createQuery(jpql, BigDecimal.class).setParameter("x", owner).getSingleResult();
    return value == null ? BigDecimal.ZERO : value;
  }

  /** Collection status of an installment on a date: COLLECTED, PARTIAL, OVERDUE, DUE or CANCELLED. */
  public static String collectionStatus(PledgeInstallment installment, BigDecimal collected, LocalDate today) {
    if (installment.getStatusSelect() == PledgeInstallmentRepository.STATUS_CANCELLED) return "CANCELLED";
    if (collected.compareTo(installment.getAmount()) >= 0) return "COLLECTED";
    if (installment.getDueDate().isBefore(today)) return "OVERDUE";
    return collected.signum() > 0 ? "PARTIAL" : "DUE";
  }
}
