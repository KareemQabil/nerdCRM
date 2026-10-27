package com.ioeti.workspace.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.axelor.apps.sale.db.SaleOrder;
import com.axelor.apps.sale.db.repo.SaleOrderRepository;
import com.ioeti.core.api.ApiException;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

/** D-11: when a client's acceptance of a quotation can be recorded. */
class CommitmentRulesTest {

  static final LocalDate TODAY = LocalDate.of(2026, 10, 25);

  private static SaleOrder finalized(LocalDate finalizedOn, LocalDate validUntil) {
    SaleOrder quote = new SaleOrder();
    quote.setStatusSelect(SaleOrderRepository.STATUS_FINALIZED_QUOTATION);
    quote.setIoetiApprovedAt(finalizedOn.atTime(10, 0));
    quote.setEndOfValidityDate(validUntil);
    return quote;
  }

  private static ApiException refused(SaleOrder quote, LocalDate acceptedOn) {
    return assertThrows(ApiException.class, () -> CommitmentService.checkAcceptable(quote, acceptedOn, TODAY));
  }

  @Test
  void aFinalizedQuotationIsAcceptedBetweenItsFinalizingDateAndToday() {
    SaleOrder quote = finalized(TODAY.minusDays(5), TODAY.plusDays(25));
    CommitmentService.checkAcceptable(quote, TODAY, TODAY);
    CommitmentService.checkAcceptable(quote, TODAY.minusDays(5), TODAY);
    assertEquals("acceptedOn", refused(quote, TODAY.plusDays(1)).fieldErrors().get(0).field());
    assertEquals("acceptedOn", refused(quote, TODAY.minusDays(6)).fieldErrors().get(0).field());
    assertEquals("acceptedOn", refused(quote, null).fieldErrors().get(0).field());
  }

  @Test
  void anAcceptanceAfterTheValidityIsRefusedAndOnlyFinalizedQuotationsAreAccepted() {
    assertEquals("QUOTE_EXPIRED", refused(finalized(TODAY.minusDays(40), TODAY.minusDays(10)), TODAY.minusDays(1)).code());
    CommitmentService.checkAcceptable(finalized(TODAY.minusDays(40), TODAY.minusDays(10)), TODAY.minusDays(10), TODAY);
    SaleOrder draft = finalized(TODAY, TODAY);
    draft.setStatusSelect(SaleOrderRepository.STATUS_DRAFT_QUOTATION);
    assertEquals("QUOTE_NOT_FINALIZED", refused(draft, TODAY).code());
    SaleOrder confirmed = finalized(TODAY, TODAY);
    confirmed.setStatusSelect(SaleOrderRepository.STATUS_ORDER_CONFIRMED);
    assertEquals("QUOTE_NOT_FINALIZED", refused(confirmed, TODAY).code());
  }
}
