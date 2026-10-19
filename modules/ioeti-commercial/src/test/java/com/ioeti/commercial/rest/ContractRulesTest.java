package com.ioeti.commercial.rest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.axelor.apps.contract.db.repo.ContractRepository;
import com.ioeti.core.api.ApiException;
import org.junit.jupiter.api.Test;

class ContractRulesTest {

  @Test
  void contractTypeIsAnExplicitChoice() {
    assertEquals(1, ContractRestController.contractType("BILLING"));
    assertEquals(2, ContractRestController.contractType("FRAMEWORK"));
    for (String bad : new String[] {null, "", "billing", "OTHER"}) {
      ApiException e = assertThrows(ApiException.class, () -> ContractRestController.contractType(bad), String.valueOf(bad));
      assertEquals("contractType", e.fieldErrors().get(0).field());
    }
  }

  @Test
  void statusesAreStableApiValues() {
    assertEquals("DRAFT", ContractRestController.status(ContractRepository.DRAFT_CONTRACT));
    assertEquals("ACTIVE", ContractRestController.status(ContractRepository.ACTIVE_CONTRACT));
    assertEquals("CLOSED", ContractRestController.status(ContractRepository.CLOSED_CONTRACT));
    assertEquals(null, ContractRestController.status(null));
  }
}
