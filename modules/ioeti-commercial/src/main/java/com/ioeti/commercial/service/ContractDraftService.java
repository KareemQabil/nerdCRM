package com.ioeti.commercial.service;

import com.axelor.apps.base.AxelorException;
import com.axelor.apps.base.db.Company;
import com.axelor.apps.contract.db.Contract;
import com.axelor.apps.contract.db.repo.ContractRepository;
import com.axelor.apps.contract.service.ContractService;
import com.axelor.apps.crm.db.Opportunity;
import com.axelor.db.JPA;
import com.google.inject.Inject;
import com.google.inject.persist.Transactional;
import com.ioeti.core.api.ApiException;
import jakarta.persistence.LockModeType;

/**
 * Draft customer contracts from opportunities, through the native AOS
 * {@code ContractService.generateContractFromOpportunity} (axelor-contract 9.1.10).
 *
 * <p>AOS allows one contract per opportunity, but checks it only in the form
 * ({@code OpportunityContractController.checkContractIsGenerated}), which is not atomic. Here the
 * opportunity row is locked with {@code PESSIMISTIC_FORCE_INCREMENT} before the check. Concurrent
 * requests therefore run one after the other, and the second fails its version check (409) or
 * finds the contract (409 {@code CONTRACT_EXISTS}).
 */
public class ContractDraftService {

  private final ContractService contractService;
  private final ContractRepository contractRepository;

  @Inject
  public ContractDraftService(ContractService contractService, ContractRepository contractRepository) {
    this.contractService = contractService;
    this.contractRepository = contractRepository;
  }

  @Transactional(rollbackOn = {Exception.class})
  public Contract createDraft(Opportunity opportunity, Company company, int contractType)
      throws AxelorException {
    JPA.em().lock(opportunity, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    if (contractService.contractsFromOpportunityAreGenerated(opportunity.getId())) {
      throw new ApiException(
          409, "CONTRACT_EXISTS", "A contract already exists for this opportunity.", null);
    }
    if (opportunity.getCompany() == null) {
      // native opportunity-form default, as for quotations (QuoteService.quotingCompany)
      opportunity.setCompany(company);
    }
    Contract contract = contractService.generateContractFromOpportunity(opportunity, null);
    // the native wizard leaves the type to the user (billing or framework contract)
    contract.setContractTypeSelect(contractType);
    return contractRepository.save(contract);
  }
}
