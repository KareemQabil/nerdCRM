package com.ioeti.commercial.service;

import com.axelor.apps.base.AxelorException;
import com.axelor.apps.contract.db.Contract;
import com.axelor.apps.contract.db.ContractLine;
import com.axelor.apps.contract.db.ContractVersion;
import com.axelor.apps.contract.db.repo.ContractRepository;
import com.axelor.apps.contract.service.ContractLineService;
import com.axelor.apps.sale.db.SaleOrder;
import com.axelor.apps.sale.db.SaleOrderLine;
import com.axelor.db.JPA;
import com.google.inject.Inject;
import com.google.inject.persist.Transactional;
import com.ioeti.core.api.ApiException;
import jakarta.persistence.LockModeType;

/**
 * Copies a quotation's lines into the current version of a draft contract, through the native AOS
 * {@code ContractLineService} (axelor-contract 9.1.10).
 *
 * <p>Each line is built the native way ({@code fillDefault} and {@code fillAndCompute}: product
 * name, unit, accounting and taxes as configured), then takes the quoted name, quantity and unit
 * price, and is totalled with {@code computeTotal}. The contract records the source quotation
 * ({@code ioetiSourceQuote}).
 *
 * <p>The fill happens once. The contract row is locked with {@code PESSIMISTIC_FORCE_INCREMENT}
 * before the lines are checked, so a repeated or concurrent request answers 409 and never
 * duplicates lines.
 */
public class ContractLinesService {

  private final ContractLineService contractLineService;
  private final ContractRepository contractRepository;

  @Inject
  public ContractLinesService(ContractLineService contractLineService, ContractRepository contractRepository) {
    this.contractLineService = contractLineService;
    this.contractRepository = contractRepository;
  }

  @Transactional(rollbackOn = {Exception.class})
  public Contract fillFromQuote(Contract contract, SaleOrder quote) throws AxelorException {
    JPA.em().lock(contract, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    ContractVersion version = contract.getCurrentContractVersion();
    if (version.getContractLineList() != null && !version.getContractLineList().isEmpty()) {
      throw new ApiException(409, "LINES_EXIST", "This contract already has lines.", null);
    }
    for (SaleOrderLine source : quote.getSaleOrderLineList()) {
      if (source.getProduct() == null) continue; // title and comment lines carry no product
      ContractLine line = contractLineService.fillDefault(new ContractLine(), version);
      line = contractLineService.fillAndCompute(line, contract, source.getProduct());
      line.setProductName(source.getProductName());
      line.setQty(source.getQty());
      line.setPrice(source.getPrice());
      version.addContractLineListItem(line);
      contractLineService.computeTotal(line, contract);
    }
    contract.setIoetiSourceQuote(quote);
    return contractRepository.save(contract);
  }
}
