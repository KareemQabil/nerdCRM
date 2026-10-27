package com.ioeti.recruitment.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

/** D-04: fee arithmetic, guarantee dates and the early-exit rule, without a database. */
class PlacementTermsTest {

  @Test
  void feeIsThePercentageOfTheAnnualSalaryRoundedHalfUp() {
    assertEquals(new BigDecimal("36000.00"), PlacementTerms.fee(new BigDecimal("240000"), new BigDecimal("15")));
    assertEquals(new BigDecimal("15296.30"), PlacementTerms.fee(new BigDecimal("123456.78"), new BigDecimal("12.39")));
    // half up at the third decimal: 100.05 × 10% = 10.005 → 10.01
    assertEquals(new BigDecimal("10.01"), PlacementTerms.fee(new BigDecimal("100.05"), new BigDecimal("10")));
    assertEquals(new BigDecimal("0.00"), PlacementTerms.fee(new BigDecimal("240000"), BigDecimal.ZERO));
  }

  @Test
  void refundIsTheRefundPercentageOfTheFee() {
    assertEquals(new BigDecimal("18000.00"), PlacementTerms.refund(new BigDecimal("36000.00"), new BigDecimal("50")));
    assertEquals(new BigDecimal("3333.33"), PlacementTerms.refund(new BigDecimal("10000.00"), new BigDecimal("33.3333")));
  }

  @Test
  void guaranteeEndsGuaranteeDaysAfterTheStartAndTheLastDayCounts() {
    LocalDate start = LocalDate.of(2026, 12, 1);
    LocalDate end = PlacementTerms.guaranteeEnd(start, 90);
    assertEquals(LocalDate.of(2027, 3, 1), end);
    assertEquals(start, PlacementTerms.guaranteeEnd(start, 0));
    assertTrue(PlacementTerms.within(end, end));
    assertTrue(PlacementTerms.within(start, end));
    assertFalse(PlacementTerms.within(end.plusDays(1), end));
    // leap year: 29 February is a day of the guarantee
    assertEquals(LocalDate.of(2028, 3, 1), PlacementTerms.guaranteeEnd(LocalDate.of(2028, 2, 1), 29));
  }

  @Test
  void daysLeftCountsDownToZeroAndNeverBelow() {
    LocalDate end = LocalDate.of(2027, 3, 1);
    assertEquals(90, PlacementTerms.daysLeft(end, LocalDate.of(2026, 12, 1)));
    assertEquals(1, PlacementTerms.daysLeft(end, LocalDate.of(2027, 2, 28)));
    assertEquals(0, PlacementTerms.daysLeft(end, end));
    assertEquals(0, PlacementTerms.daysLeft(end, end.plusDays(10)));
  }

  @Test
  void theFeeIsDueOnTheAgreementsTrigger() {
    assertTrue(PlacementTerms.due(PlacementTerms.OFFER_ACCEPTED, true, false));
    assertFalse(PlacementTerms.due(PlacementTerms.START_DATE, true, false));
    assertTrue(PlacementTerms.due(PlacementTerms.START_DATE, true, true));
  }

  @Test
  void anExitAppliesTheAgreementsRuleOnlyWithinTheGuarantee() {
    assertEquals(PlacementTerms.Outcome.REPLACEMENT_OPENED, PlacementTerms.outcome(PlacementTerms.REPLACE, true, true));
    assertEquals(PlacementTerms.Outcome.REPLACEMENT_OPENED, PlacementTerms.outcome(PlacementTerms.REPLACE, true, false));
    assertEquals(PlacementTerms.Outcome.REFUND_REQUESTED, PlacementTerms.outcome(PlacementTerms.PARTIAL_REFUND, true, true));
    assertEquals(PlacementTerms.Outcome.NO_FEE_TO_REFUND, PlacementTerms.outcome(PlacementTerms.PARTIAL_REFUND, true, false));
    assertEquals(PlacementTerms.Outcome.NO_REMEDY, PlacementTerms.outcome(PlacementTerms.NONE, true, true));
    for (String rule : new String[] {PlacementTerms.REPLACE, PlacementTerms.PARTIAL_REFUND, PlacementTerms.NONE}) {
      assertEquals(PlacementTerms.Outcome.OUTSIDE_GUARANTEE, PlacementTerms.outcome(rule, false, true));
    }
  }

  @Test
  void guaranteeStatusAsPeopleReadIt() {
    LocalDate start = LocalDate.of(2026, 12, 1), end = LocalDate.of(2027, 3, 1);
    assertEquals("TERMS_PENDING", PlacementTerms.guaranteeStatus(false, start, null, null, start));
    assertEquals("NOT_STARTED", PlacementTerms.guaranteeStatus(true, null, null, null, start));
    assertEquals("ACTIVE", PlacementTerms.guaranteeStatus(true, start, end, null, end));
    assertEquals("CLOSED", PlacementTerms.guaranteeStatus(true, start, end, null, end.plusDays(1)));
    assertEquals("EARLY_EXIT", PlacementTerms.guaranteeStatus(true, start, end, end, end.plusDays(5)));
    assertEquals("EXITED_AFTER", PlacementTerms.guaranteeStatus(true, start, end, end.plusDays(1), end.plusDays(5)));
  }

  @Test
  void theAgreementIsReadFromThePolicyValue() throws Exception {
    PlacementTerms.Agreement a = PlacementTerms.Agreement.of(new ObjectMapper().readTree(
        "{\"feePercent\":15,\"invoiceOn\":\"START_DATE\",\"guaranteeDays\":90,\"replacement\":\"REPLACE\"}"));
    assertEquals(0, new BigDecimal("15").compareTo(a.feePercent()));
    assertEquals("START_DATE", a.invoiceOn());
    assertEquals(90, a.guaranteeDays());
    assertEquals("REPLACE", a.replacement());
    assertNull(a.refundPercent());
    PlacementTerms.Agreement b = PlacementTerms.Agreement.of(new ObjectMapper().readTree(
        "{\"feePercent\":12.5,\"invoiceOn\":\"OFFER_ACCEPTED\",\"guaranteeDays\":60,\"replacement\":\"PARTIAL_REFUND\",\"refundPercent\":50}"));
    assertEquals(0, new BigDecimal("12.5").compareTo(b.feePercent()));
    assertEquals(0, new BigDecimal("50").compareTo(b.refundPercent()));
  }
}
