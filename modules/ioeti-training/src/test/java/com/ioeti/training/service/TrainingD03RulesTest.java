package com.ioeti.training.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ioeti.core.api.ApiException;
import com.ioeti.training.service.TrainingRules.Criteria;
import com.ioeti.training.service.TrainingRules.Eligibility;
import com.ioeti.training.service.TrainingRules.Step;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

/** D-03 rules: refund steps, the paid share and credit share, certificate eligibility and national IDs. */
class TrainingD03RulesTest {

  static BigDecimal d(String v) {
    return new BigDecimal(v);
  }

  static JsonNode json(String text) throws Exception {
    return new ObjectMapper().readTree(text);
  }

  // --- refund steps -------------------------------------------------------------------------------------------

  static final List<Step> STEPS = List.of(new Step(14, d("100")), new Step(7, d("50")), new Step(0, d("0")));

  @Test
  void theLargestStepStillMetGivesTheShare() {
    assertEquals(d("100.00"), TrainingRules.refundPercent(STEPS, 30));
    assertEquals(d("100.00"), TrainingRules.refundPercent(STEPS, 14));
    assertEquals(d("50.00"), TrainingRules.refundPercent(STEPS, 13));
    assertEquals(d("50.00"), TrainingRules.refundPercent(STEPS, 7));
    assertEquals(d("0.00"), TrainingRules.refundPercent(STEPS, 6));
    assertEquals(d("0.00"), TrainingRules.refundPercent(STEPS, 0));
  }

  @Test
  void afterTheStartOrBelowEveryStepNothingIsRefunded() {
    assertEquals(d("0.00"), TrainingRules.refundPercent(STEPS, -1));
    assertEquals(d("0.00"), TrainingRules.refundPercent(List.of(new Step(10, d("80"))), 9));
    assertEquals(d("0.00"), TrainingRules.refundPercent(List.of(), 100));
  }

  @Test
  void stepsAreReadInAnyOrderFromThePolicyValue() throws Exception {
    List<Step> steps = TrainingRules.steps(json("{\"steps\":[{\"daysBeforeStart\":0,\"refundPercent\":10},"
        + "{\"daysBeforeStart\":21,\"refundPercent\":90.5},{\"daysBeforeStart\":7,\"refundPercent\":40}]}"));
    assertEquals(3, steps.size());
    assertEquals(d("90.50"), TrainingRules.refundPercent(steps, 21));
    assertEquals(d("40.00"), TrainingRules.refundPercent(steps, 20));
    assertEquals(d("10.00"), TrainingRules.refundPercent(steps, 3));
  }

  @Test
  void daysBeforeStartCountWholeDays() {
    LocalDate start = LocalDate.of(2026, 11, 15);
    assertEquals(14, TrainingRules.daysBeforeStart(start, LocalDate.of(2026, 11, 1)));
    assertEquals(0, TrainingRules.daysBeforeStart(start, start));
    assertEquals(-2, TrainingRules.daysBeforeStart(start, LocalDate.of(2026, 11, 17)));
  }

  @Test
  void thePaidShareIsWhatWasReceivedInProportionNeverMoreThanTheFee() {
    // one enrolment on the whole invoice: what was received
    assertEquals(d("5700.00"), TrainingRules.paidShare(d("5700"), d("11400"), d("11400")));
    // a group invoice of 3 x 3800, half paid: each trainee paid half of their share
    assertEquals(d("1900.00"), TrainingRules.paidShare(d("5700"), d("3800"), d("11400")));
    // fully paid: never more than the fee
    assertEquals(d("3800.00"), TrainingRules.paidShare(d("11400"), d("3800"), d("11400")));
    // received above the total (overpayment) does not raise a share
    assertEquals(d("3800.00"), TrainingRules.paidShare(d("12000"), d("3800"), d("11400")));
    assertEquals(d("0.00"), TrainingRules.paidShare(BigDecimal.ZERO, d("3800"), d("11400")));
    assertEquals(d("0.00"), TrainingRules.paidShare(null, d("3800"), d("11400")));
    // rounded down to the piaster
    assertEquals(d("33.33"), TrainingRules.paidShare(d("100"), d("100"), d("300")));
  }

  @Test
  void refundAndCreditShareNeverExceedTheRefund() {
    assertEquals(d("1900.00"), TrainingRules.refundAmount(d("3800.00"), d("50.00")));
    assertEquals(d("0.00"), TrainingRules.refundAmount(d("3800.00"), d("0.00")));
    assertEquals(d("33.34"), TrainingRules.refundAmount(d("66.67"), d("50.00")));
    // 1900 of an invoice of 11400 = 16.666…% → 16.66% (rounded down, the credit never exceeds the refund)
    assertEquals(d("16.66"), TrainingRules.creditPercent(d("1900.00"), d("11400")));
    assertEquals(d("50.00"), TrainingRules.creditPercent(d("5700.00"), d("11400")));
    assertEquals(d("100.00"), TrainingRules.creditPercent(d("11400.00"), d("11400")));
    assertEquals(d("0.00"), TrainingRules.creditPercent(d("0.00"), d("11400")));
    // a refund below 0.01% of the invoice cannot be credited as a share: nothing is due
    assertEquals(d("0.00"), TrainingRules.creditPercent(d("0.50"), d("11400")));
  }

  @Test
  void aCreditNoteMatchesItsShareWithinTheNativeRounding() {
    assertTrue(TrainingRules.creditMatches(d("1899.24"), d("11400"), d("16.66")));
    assertTrue(TrainingRules.creditMatches(d("1899.26"), d("11400"), d("16.66")));
    assertFalse(TrainingRules.creditMatches(d("5700.00"), d("11400"), d("16.66")));
    assertFalse(TrainingRules.creditMatches(d("1890.00"), d("11400"), d("16.66")));
    assertFalse(TrainingRules.creditMatches(null, d("11400"), d("16.66")));
  }

  // --- eligibility --------------------------------------------------------------------------------------------

  static final Criteria ATTENDANCE_ONLY = new Criteria(d("80"), null);
  static final Criteria ASSESSED = new Criteria(d("80"), d("70"));

  @Test
  void attendanceIsRoundedDownSoItNeverReachesTheThresholdByRounding() {
    assertEquals(d("80.00"), TrainingRules.attendancePercent(4, 5));
    assertEquals(d("66.66"), TrainingRules.attendancePercent(2, 3));
    assertEquals(d("79.99"), TrainingRules.attendancePercent(7999, 10000));
    assertNull(TrainingRules.attendancePercent(0, 0));
  }

  @Test
  void eligibilityNamesTheFirstUnmetCriterion() {
    assertEquals(new Eligibility(true, null, d("80.00")), TrainingRules.evaluate(ATTENDANCE_ONLY, true, 5, 4, null));
    assertEquals("ATTENDANCE_BELOW", TrainingRules.evaluate(ATTENDANCE_ONLY, true, 5, 3, null).reason());
    assertEquals("NO_SESSIONS", TrainingRules.evaluate(ATTENDANCE_ONLY, true, 0, 0, null).reason());
    assertEquals("NOT_CONFIRMED", TrainingRules.evaluate(ATTENDANCE_ONLY, false, 5, 5, null).reason());
    // a score is ignored where the course has no pass mark
    assertTrue(TrainingRules.evaluate(ATTENDANCE_ONLY, true, 5, 5, d("10")).eligible());
  }

  @Test
  void anAssessedCourseNeedsAScoreAtLeastThePassMark() {
    assertEquals("SCORE_MISSING", TrainingRules.evaluate(ASSESSED, true, 5, 5, null).reason());
    assertEquals("SCORE_BELOW", TrainingRules.evaluate(ASSESSED, true, 5, 5, d("69.99")).reason());
    assertTrue(TrainingRules.evaluate(ASSESSED, true, 5, 4, d("70")).eligible());
    // attendance is checked first
    assertEquals("ATTENDANCE_BELOW", TrainingRules.evaluate(ASSESSED, true, 5, 3, d("95")).reason());
    assertEquals("The score is 60 and the pass mark is 70.", TrainingRules.explain("SCORE_BELOW", ASSESSED, d("100"), d("60.00")));
    assertEquals("Attendance is 60% and the course requires 80%.", TrainingRules.explain("ATTENDANCE_BELOW", ASSESSED, d("60.00"), null));
  }

  @Test
  void criteriaAreReadFromThePolicyValue() throws Exception {
    Criteria c = Criteria.of(json("{\"minAttendancePercent\":75}"));
    assertFalse(c.assessed());
    assertEquals(d("75"), c.minAttendancePercent());
    assertTrue(Criteria.of(json("{\"minAttendancePercent\":75,\"passMark\":60}")).assessed());
  }

  @Test
  void scoresAreFrom0To100WithTwoDecimals() {
    assertEquals(d("87.50"), TrainingRules.checkedScore(d("87.5")));
    assertEquals(d("0.00"), TrainingRules.checkedScore(d("0")));
    for (String bad : new String[] {"-1", "100.01", "50.123"}) {
      ApiException e = assertThrows(ApiException.class, () -> TrainingRules.checkedScore(d(bad)), bad);
      assertEquals("score", e.fieldErrors().get(0).field());
    }
    assertEquals("REQUIRED", assertThrows(ApiException.class, () -> TrainingRules.checkedScore(null)).fieldErrors().get(0).code());
  }

  // --- national ID --------------------------------------------------------------------------------------------

  @Test
  void aNationalIdIsFourteenDigitsWithARealBirthDate() {
    assertEquals("29001011234567", TrainingRules.nationalId("29001011234567"));
    assertEquals("29001011234567", TrainingRules.nationalId(" 2900101-1234567 "));
    // Arabic-Indic digits are accepted and stored as ASCII digits
    assertEquals("30512311234567", TrainingRules.nationalId("٣٠٥١٢٣١١٢٣٤٥٦٧"));
    for (String bad : new String[] {"", "1234", "19001011234567", "29013011234567", "29002301234567", "2900101123456X", "290010112345678"}) {
      ApiException e = assertThrows(ApiException.class, () -> TrainingRules.nationalId(bad), bad);
      assertEquals("nationalId", e.fieldErrors().get(0).field());
      // the refusal never repeats the number
      assertFalse(e.getMessage().contains(bad.isEmpty() ? "@" : bad));
    }
  }
}
