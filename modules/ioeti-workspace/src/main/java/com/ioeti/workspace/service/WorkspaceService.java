package com.ioeti.workspace.service;

import com.ioeti.core.notify.Notifier;
import com.axelor.apps.contract.db.Contract;
import com.axelor.apps.contract.db.repo.ContractRepository;
import com.axelor.apps.crm.db.Opportunity;
import com.axelor.apps.crm.service.OpportunityService;
import com.axelor.apps.sale.db.SaleOrder;
import com.axelor.apps.sale.db.repo.SaleOrderRepository;
import com.axelor.apps.supplychain.db.Timetable;
import com.axelor.auth.AuthUtils;
import com.axelor.db.JPA;
import com.axelor.db.Model;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.google.inject.persist.Transactional;
import com.ioeti.core.api.ApiException;
import com.ioeti.workspace.db.InvoiceRequest;
import com.ioeti.workspace.db.ReviewEvent;
import com.ioeti.workspace.db.ReviewRequest;
import com.ioeti.workspace.db.repo.InvoiceRequestRepository;
import com.ioeti.workspace.db.repo.ReviewEventRepository;
import com.ioeti.workspace.db.repo.ReviewRequestRepository;
import jakarta.persistence.LockModeType;
import java.time.LocalDateTime;

/**
 * Cross-record commercial workflows on native records.
 *
 * <ul>
 *   <li>A review request asks for a review of a draft quotation (at its current version) or a draft
 *       contract; one pending request per record. Reviewers may send it back with a reason; the
 *       approval and rejection decisions are D-11 and fail closed in the API.
 *   <li>An invoice request records that one payment milestone of a confirmed order should be
 *       invoiced; one open request per milestone. Issuing the invoice is D-06.
 *   <li>A renewal opens one native opportunity for an active or closed contract (unique link).
 * </ul>
 *
 * <p>Requests lock the quotation, contract or milestone row ({@code PESSIMISTIC_FORCE_INCREMENT}), so
 * concurrent requests serialize and the second sees 409.
 */
public class WorkspaceService {

  @Transactional(rollbackOn = {Exception.class})
  public <T extends Model> T create(T record) {
    return JPA.save(record);
  }

  @Transactional(rollbackOn = {Exception.class})
  public ReviewRequest requestReview(SaleOrder quote, Contract contract) {
    Model subject = quote != null ? quote : contract;
    JPA.em().lock(subject, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    if (quote != null) {
      if (!Integer.valueOf(SaleOrderRepository.STATUS_DRAFT_QUOTATION).equals(quote.getStatusSelect())) {
        throw new ApiException(422, "QUOTE_NOT_DRAFT", "Only a draft quotation is reviewed.", null);
      }
      if (quote.getSaleOrderLineList() == null || quote.getSaleOrderLineList().isEmpty()) {
        throw new ApiException(422, "NO_LINES", "Add at least one line before asking for a review.", null);
      }
    } else if (!Integer.valueOf(ContractRepository.DRAFT_CONTRACT).equals(contract.getStatusSelect())) {
      throw new ApiException(422, "CONTRACT_NOT_DRAFT", "Only a draft contract is reviewed.", null);
    }
    String field = quote != null ? "quote" : "contract";
    if (Query.of(ReviewRequest.class).filter("self." + field + " = ?1 AND self.statusSelect = ?2", subject,
        ReviewRequestRepository.STATUS_PENDING).count() > 0) {
      throw new ApiException(409, "REVIEW_PENDING", "A review of this record is already pending.", null);
    }
    ReviewRequest review = new ReviewRequest();
    review.setQuote(quote);
    review.setContract(contract);
    review.setSubjectVersionNumber(quote == null ? null : quote.getVersionNumber());
    review.setStatusSelect(ReviewRequestRepository.STATUS_PENDING);
    review.setRequestedBy(AuthUtils.getUser());
    review.setRequestedAt(LocalDateTime.now());
    JPA.save(review);
    event(review, ReviewEventRepository.KIND_REQUESTED, null);
    return review;
  }

  @Transactional(rollbackOn = {Exception.class})
  public ReviewRequest requestChanges(ReviewRequest review, int reason) {
    JPA.em().lock(review, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    pending(review);
    review.setStatusSelect(ReviewRequestRepository.STATUS_CHANGES_REQUESTED);
    review.setReviewedBy(AuthUtils.getUser());
    review.setReasonSelect(reason);
    event(review, ReviewEventRepository.KIND_CHANGES_REQUESTED, reason);
    ReviewRequest saved = JPA.save(review);
    Opportunity opportunity = review.getQuote() != null ? review.getQuote().getOpportunity()
        : review.getContract() != null ? review.getContract().getOpportunity() : null;
    Beans.get(Notifier.class).notify(review.getRequestedBy(), "REVIEW_CHANGES_REQUESTED", opportunity == null ? null : "OPPORTUNITY",
        opportunity == null ? null : opportunity.getId(), review.getQuote() != null
            ? "Quotation " + review.getQuote().getSaleOrderSeq() : "Contract " + review.getContract().getContractId());
    return saved;
  }

  @Transactional(rollbackOn = {Exception.class})
  public ReviewRequest withdraw(ReviewRequest review) {
    JPA.em().lock(review, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    pending(review);
    review.setStatusSelect(ReviewRequestRepository.STATUS_WITHDRAWN);
    event(review, ReviewEventRepository.KIND_WITHDRAWN, null);
    return JPA.save(review);
  }

  private static void pending(ReviewRequest review) {
    if (review.getStatusSelect() != ReviewRequestRepository.STATUS_PENDING) {
      throw new ApiException(422, "REVIEW_STATE", "Only a pending review can change.", null);
    }
  }

  @Transactional(rollbackOn = {Exception.class})
  public InvoiceRequest requestInvoice(Timetable milestone) {
    JPA.em().lock(milestone, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    SaleOrder order = milestone.getSaleOrder();
    if (order == null || !Integer.valueOf(SaleOrderRepository.STATUS_ORDER_CONFIRMED).equals(order.getStatusSelect())) {
      throw new ApiException(422, "ORDER_NOT_CONFIRMED", "Only milestones of a confirmed order can be invoiced.", null);
    }
    if (Boolean.TRUE.equals(milestone.getInvoiced())) {
      throw new ApiException(422, "ALREADY_INVOICED", "This milestone is already invoiced.", null);
    }
    if (Query.of(InvoiceRequest.class).filter("self.milestone = ?1 AND self.statusSelect = ?2", milestone,
        InvoiceRequestRepository.STATUS_REQUESTED).count() > 0) {
      throw new ApiException(409, "INVOICE_REQUEST_EXISTS", "This milestone already has an open invoice request.", null);
    }
    InvoiceRequest request = new InvoiceRequest();
    request.setQuote(order);
    request.setMilestone(milestone);
    request.setAmountBeforeTax(milestone.getAmount());
    request.setStatusSelect(InvoiceRequestRepository.STATUS_REQUESTED);
    request.setRequestedBy(AuthUtils.getUser());
    request.setRequestedAt(LocalDateTime.now());
    return JPA.save(request);
  }

  @Transactional(rollbackOn = {Exception.class})
  public InvoiceRequest cancel(InvoiceRequest request) {
    JPA.em().lock(request, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    if (request.getStatusSelect() != InvoiceRequestRepository.STATUS_REQUESTED) {
      throw new ApiException(422, "REQUEST_STATE", "This invoice request is already cancelled.", null);
    }
    request.setStatusSelect(InvoiceRequestRepository.STATUS_CANCELLED);
    request.setCancelledAt(LocalDateTime.now());
    return JPA.save(request);
  }

  /** Opens the renewal opportunity of a contract through the native opportunity service. */
  @Transactional(rollbackOn = {Exception.class})
  public Opportunity renew(Contract contract) {
    JPA.em().lock(contract, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    Integer status = contract.getStatusSelect();
    if (!Integer.valueOf(ContractRepository.ACTIVE_CONTRACT).equals(status)
        && !Integer.valueOf(ContractRepository.CLOSED_CONTRACT).equals(status)) {
      throw new ApiException(422, "CONTRACT_NOT_ACTIVE", "Only an active or closed contract is renewed.", null);
    }
    if (Query.of(Opportunity.class).filter("self.ioetiRenewalOf = ?1", contract).count() > 0) {
      throw new ApiException(409, "RENEWAL_EXISTS", "This contract already has a renewal opportunity.", null);
    }
    Opportunity original = contract.getOpportunity();
    Opportunity renewal = new Opportunity();
    renewal.setName("Renewal: " + (contract.getName() == null ? contract.getContractId() : contract.getName()));
    renewal.setPartner(contract.getPartner());
    renewal.setUser(AuthUtils.getUser());
    renewal.setIoetiBusinessLine(original == null ? null : original.getIoetiBusinessLine());
    renewal.setIoetiRenewalOf(contract);
    Beans.get(OpportunityService.class).saveOpportunity(renewal);
    return renewal;
  }

  private void event(ReviewRequest review, int kind, Integer reason) {
    ReviewEvent event = new ReviewEvent();
    event.setReview(review);
    event.setKindSelect(kind);
    event.setReasonSelect(reason);
    event.setActor(AuthUtils.getUser());
    event.setOccurredAt(LocalDateTime.now());
    JPA.save(event);
  }
}
