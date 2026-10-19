package com.ioeti.commercial.rest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.axelor.apps.base.AxelorException;
import com.axelor.apps.base.db.repo.TraceBackRepository;
import com.axelor.apps.base.exceptions.ObserverBaseException;
import com.axelor.apps.sale.db.repo.SaleOrderRepository;
import com.ioeti.core.api.ApiException;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

class QuoteRulesTest {

  @Test
  void quantityMustBePositiveBoundedAndAtMostFourDecimals() {
    assertEquals(new BigDecimal("2.5"), QuoteRestController.checkedQuantity(new BigDecimal("2.5")));
    assertEquals(new BigDecimal("100000"), QuoteRestController.checkedQuantity(new BigDecimal("100000")));
    assertEquals(new BigDecimal("1.25000"), QuoteRestController.checkedQuantity(new BigDecimal("1.25000")));
    for (String bad : new String[] {"0", "-1", "100000.0001", "1.00001"}) {
      ApiException error = assertThrows(ApiException.class,
          () -> QuoteRestController.checkedQuantity(new BigDecimal(bad)), bad);
      assertEquals(422, error.status());
      assertEquals("quantity", error.fieldErrors().get(0).field());
    }
    assertThrows(ApiException.class, () -> QuoteRestController.checkedQuantity(null));
  }

  @Test
  void statusesAreStableApiValues() {
    assertEquals("DRAFT", QuoteRestController.status(SaleOrderRepository.STATUS_DRAFT_QUOTATION));
    assertEquals("FINALIZED", QuoteRestController.status(SaleOrderRepository.STATUS_FINALIZED_QUOTATION));
    assertEquals("CONFIRMED", QuoteRestController.status(SaleOrderRepository.STATUS_ORDER_CONFIRMED));
    assertEquals("CANCELED", QuoteRestController.status(SaleOrderRepository.STATUS_CANCELED));
    assertEquals(null, QuoteRestController.status(null));
  }

  @Test
  void nativeRefusalsBecomeSafeContractErrorsAndOtherFailuresPropagate() {
    ApiException setup = assertThrows(ApiException.class, () -> QuoteRestController.runNative(() -> {
      throw new AxelorException(TraceBackRepository.CATEGORY_CONFIGURATION_ERROR, "internal detail");
    }));
    assertEquals("SETUP_REQUIRED", setup.code());
    assertEquals(false, setup.getMessage().contains("internal detail"));
    ApiException rule = assertThrows(ApiException.class, () -> QuoteRestController.runNative(() -> {
      throw new AxelorException(TraceBackRepository.CATEGORY_INCONSISTENCY, "internal detail");
    }));
    assertEquals("QUOTE_REJECTED", rule.code());
    ApiException observed = assertThrows(ApiException.class, () -> QuoteRestController.runNative(() -> {
      throw new ObserverBaseException(
          new AxelorException(TraceBackRepository.CATEGORY_CONFIGURATION_ERROR, "x"), "x");
    }));
    assertEquals("SETUP_REQUIRED", observed.code());
    assertThrows(IllegalStateException.class, () -> QuoteRestController.runNative(() -> {
      throw new IllegalStateException("bug");
    }));
  }
}
