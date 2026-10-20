package com.ioeti.fundraising.rest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.ioeti.core.api.ApiException;
import com.ioeti.fundraising.db.PledgeInstallment;
import com.ioeti.fundraising.db.repo.FundingOpportunityRepository;
import com.ioeti.fundraising.db.repo.PledgeInstallmentRepository;
import com.ioeti.fundraising.service.FundraisingService;
import java.math.BigDecimal;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

class FundraisingRulesTest {

  @Test
  void stagesMoveForwardOneStepAndOnlyOpenOnesCanEnd() {
    assertTrue(FundraisingService.canMove(FundingOpportunityRepository.STAGE_IDENTIFIED, FundingOpportunityRepository.STAGE_PROPOSAL));
    assertTrue(FundraisingService.canMove(FundingOpportunityRepository.STAGE_PROPOSAL, FundingOpportunityRepository.STAGE_SUBMITTED));
    assertTrue(FundraisingService.canMove(FundingOpportunityRepository.STAGE_SUBMITTED, FundingOpportunityRepository.STAGE_DECLINED));
    // approval has its own command that records the commitment
    assertFalse(FundraisingService.canMove(FundingOpportunityRepository.STAGE_SUBMITTED, FundingOpportunityRepository.STAGE_APPROVED));
    assertFalse(FundraisingService.canMove(FundingOpportunityRepository.STAGE_IDENTIFIED, FundingOpportunityRepository.STAGE_SUBMITTED));
    assertFalse(FundraisingService.canMove(FundingOpportunityRepository.STAGE_APPROVED, FundingOpportunityRepository.STAGE_WITHDRAWN));
  }

  @Test
  void collectionStatusSeparatesDueOverduePartialAndCollected() {
    PledgeInstallment installment = new PledgeInstallment();
    installment.setAmount(new BigDecimal("1000"));
    installment.setDueDate(LocalDate.of(2026, 10, 1));
    installment.setStatusSelect(PledgeInstallmentRepository.STATUS_SCHEDULED);
    LocalDate before = LocalDate.of(2026, 9, 1);
    LocalDate after = LocalDate.of(2026, 11, 1);
    assertEquals("DUE", FundraisingService.collectionStatus(installment, BigDecimal.ZERO, before));
    assertEquals("PARTIAL", FundraisingService.collectionStatus(installment, new BigDecimal("400"), before));
    assertEquals("OVERDUE", FundraisingService.collectionStatus(installment, new BigDecimal("400"), after));
    assertEquals("COLLECTED", FundraisingService.collectionStatus(installment, new BigDecimal("1000"), after));
    installment.setStatusSelect(PledgeInstallmentRepository.STATUS_CANCELLED);
    assertEquals("CANCELLED", FundraisingService.collectionStatus(installment, BigDecimal.ZERO, after));
  }

  @Test
  void amountsArePositiveWithAtMostTwoDecimals() {
    assertEquals(new BigDecimal("10.50"), FundraisingRestController.amount("amount", new BigDecimal("10.50")));
    assertEquals("amount", assertThrows(ApiException.class,
        () -> FundraisingRestController.amount("amount", new BigDecimal("10.123"))).fieldErrors().get(0).field());
    assertThrows(ApiException.class, () -> FundraisingRestController.amount("amount", BigDecimal.ZERO));
    assertThrows(ApiException.class, () -> FundraisingRestController.amount("amount", null));
  }

  @Test
  void stableApiNames() {
    assertEquals(4, FundraisingRestController.select("stage", "APPROVED", FundraisingRestController.STAGES));
    assertEquals("FOUNDATION", FundraisingRestController.name(2, FundraisingRestController.DONOR_TYPES));
    assertThrows(ApiException.class, () -> FundraisingRestController.select("kind", "LOAN", FundraisingRestController.KINDS));
  }
}
