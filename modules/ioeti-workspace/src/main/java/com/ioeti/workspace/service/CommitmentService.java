package com.ioeti.workspace.service;

import com.axelor.apps.base.AxelorException;
import com.axelor.apps.base.service.app.AppBaseService;
import com.axelor.apps.contract.db.Contract;
import com.axelor.apps.contract.db.repo.ContractRepository;
import com.axelor.apps.contract.service.ContractService;
import com.axelor.apps.sale.db.SaleOrder;
import com.axelor.apps.sale.db.repo.SaleOrderRepository;
import com.axelor.apps.sale.service.saleorder.status.SaleOrderConfirmService;
import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.User;
import com.axelor.db.JPA;
import com.google.inject.Inject;
import com.google.inject.persist.Transactional;
import com.ioeti.commercial.service.QuoteApprovalService;
import com.ioeti.content.db.DocumentRevision;
import com.ioeti.content.db.RecordDocument;
import com.ioeti.content.service.ContentService;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.db.PolicyVersion;
import com.ioeti.core.policy.PolicyService;
import jakarta.persistence.LockModeType;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Objects;

/**
 * D-11 (signed 2026-10-25): binding commitments, each on uploaded evidence.
 *
 * <ul>
 *   <li><b>Client acceptance</b> of a finalized, still valid quotation: a signed copy of the quotation or a purchase order,
 *       filed as a document on the quotation. Recording it confirms the order with the native AOS confirmation.
 *   <li><b>Contract activation</b>: a signed copy filed as a document on the contract; a holder of the role the business
 *       line's {@code sales.contract-signatory} policy names then activates it with the native AOS activation.
 * </ul>
 *
 * The evidence is pinned to the document's revision and content hash, so a later revision does not change what was
 * relied on. E-signature completion (D-10) is a later channel.
 */
public class CommitmentService {

  public static final String SIGNATORY = "sales.contract-signatory";
  public static final String SIGNED_QUOTE = "SIGNED_QUOTE";
  public static final String PURCHASE_ORDER = "PURCHASE_ORDER";

  private final PolicyService policies;
  private final AppBaseService appBaseService;
  private final SaleOrderConfirmService confirmService;
  private final ContractService contractService;

  @Inject
  public CommitmentService(PolicyService policies, AppBaseService appBaseService, SaleOrderConfirmService confirmService,
      ContractService contractService) {
    this.policies = policies;
    this.appBaseService = appBaseService;
    this.confirmService = confirmService;
    this.contractService = contractService;
  }

  /** The evidence a record relies on: a document filed on that record, not archived, with its current revision. */
  public record Evidence(RecordDocument document, DocumentRevision revision) {}

  public static Evidence evidence(Long documentId, int subject, Long subjectId) {
    RecordDocument document = documentId == null ? null : JPA.find(RecordDocument.class, documentId);
    if (document == null || !Objects.equals(document.getSubjectSelect(), subject) || !Objects.equals(document.getSubjectId(), subjectId)
        || Boolean.TRUE.equals(document.getArchived())) {
      throw ApiException.invalidField("documentId", "UNAVAILABLE", "Choose a document filed on this record.");
    }
    DocumentRevision revision = ContentService.latest(document);
    if (revision == null) throw ApiException.invalidField("documentId", "UNAVAILABLE", "Choose a document filed on this record.");
    return new Evidence(document, revision);
  }

  // --- client acceptance --------------------------------------------------------------------------------------------

  /** Checks a quotation can be accepted on {@code acceptedOn}: finalized, valid on that day, not in the future. */
  public static void checkAcceptable(SaleOrder quote, LocalDate acceptedOn, LocalDate today) {
    if (!Integer.valueOf(SaleOrderRepository.STATUS_FINALIZED_QUOTATION).equals(quote.getStatusSelect())) {
      throw new ApiException(422, "QUOTE_NOT_FINALIZED", "Only a finalized quotation is accepted.", null);
    }
    if (acceptedOn == null) throw ApiException.invalidField("acceptedOn", "REQUIRED", "Give the date the client accepted.");
    LocalDate finalized = quote.getIoetiApprovedAt() == null ? null : quote.getIoetiApprovedAt().toLocalDate();
    if (acceptedOn.isAfter(today) || (finalized != null && acceptedOn.isBefore(finalized))) {
      throw ApiException.invalidField("acceptedOn", "RANGE", "The acceptance date is between the finalizing date and today.");
    }
    if (quote.getEndOfValidityDate() != null && acceptedOn.isAfter(quote.getEndOfValidityDate())) {
      throw new ApiException(422, "QUOTE_EXPIRED", "The quotation was no longer valid on that date.", null);
    }
  }

  /** Records the client's acceptance on its evidence and confirms the order natively. */
  @Transactional(rollbackOn = {Exception.class})
  public SaleOrder accept(SaleOrder quote, String kind, String reference, LocalDate acceptedOn, Evidence evidence)
      throws AxelorException {
    JPA.em().lock(quote, LockModeType.PESSIMISTIC_WRITE);
    checkAcceptable(quote, acceptedOn, appBaseService.getTodayDate(quote.getCompany()));
    quote.setIoetiAcceptanceKind(kind);
    quote.setIoetiAcceptanceReference(reference);
    quote.setIoetiAcceptedOn(acceptedOn);
    quote.setIoetiAcceptanceDocument(evidence.document().getId());
    quote.setIoetiAcceptanceRevision(evidence.revision().getNumber());
    quote.setIoetiAcceptanceSha256(evidence.revision().getSha256());
    quote.setIoetiAcceptedBy(AuthUtils.getUser());
    quote.setIoetiAcceptedAt(LocalDateTime.now());
    confirmService.confirmSaleOrder(quote);
    return quote;
  }

  // --- contract activation -------------------------------------------------------------------------------------------

  /** The signatory policy in force for a contract's business line (fails closed). */
  public PolicyService.Applied signatory(Contract contract) {
    return policies.require(SIGNATORY, scopeOf(contract), appBaseService.getTodayDate(contract.getCompany()));
  }

  static String scopeOf(Contract contract) {
    return contract.getOpportunity() == null || contract.getOpportunity().getIoetiBusinessLine() == null ? null
        : contract.getOpportunity().getIoetiBusinessLine().getCode();
  }

  /** Whether a person holds the role the signatory policy names. */
  public static boolean isSignatory(User user, PolicyService.Applied policy) {
    return QuoteApprovalService.holds(user, policy.value().path("signatory").asText());
  }

  /**
   * Activates a draft contract on its signature evidence: the caller holds the signatory role, the contract was signed
   * on or before today, and it starts on {@code startOn} (the native activation date).
   */
  @Transactional(rollbackOn = {Exception.class})
  public Contract activate(Contract contract, LocalDate signedOn, LocalDate startOn, Evidence evidence) throws AxelorException {
    JPA.em().lock(contract, LockModeType.PESSIMISTIC_WRITE);
    if (!Integer.valueOf(ContractRepository.DRAFT_CONTRACT).equals(contract.getStatusSelect())) {
      throw new ApiException(422, "CONTRACT_NOT_DRAFT", "Only a draft contract is activated.", null);
    }
    PolicyService.Applied policy = signatory(contract);
    if (!isSignatory(AuthUtils.getUser(), policy)) {
      throw new ApiException(403, "NOT_SIGNATORY", "Contracts of this business line are activated by "
          + policy.value().path("signatory").asText() + ".", null);
    }
    LocalDate today = appBaseService.getTodayDate(contract.getCompany());
    if (signedOn == null) throw ApiException.invalidField("signedOn", "REQUIRED", "Give the date the contract was signed.");
    if (signedOn.isAfter(today)) throw ApiException.invalidField("signedOn", "RANGE", "The signature date cannot be in the future.");
    LocalDate start = startOn == null ? signedOn : startOn;
    if (start.isBefore(signedOn) || start.isAfter(today)) {
      throw ApiException.invalidField("startOn", "RANGE", "The contract starts between its signature date and today.");
    }
    contract.setIoetiSignatureDocument(evidence.document().getId());
    contract.setIoetiSignatureRevision(evidence.revision().getNumber());
    contract.setIoetiSignatureSha256(evidence.revision().getSha256());
    contract.setIoetiSignedOn(signedOn);
    contract.setIoetiActivatedBy(AuthUtils.getUser());
    contract.setIoetiActivatedAt(LocalDateTime.now());
    contract.setIoetiSignatoryPolicy(JPA.find(PolicyVersion.class, policy.versionId()));
    contractService.ongoingCurrentVersion(contract, start);
    return contract;
  }
}
