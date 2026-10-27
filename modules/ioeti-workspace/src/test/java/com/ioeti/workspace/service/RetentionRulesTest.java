package com.ioeti.workspace.service;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.ioeti.core.api.ApiException;
import com.ioeti.core.policy.PolicyCatalog;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

/** D-07: the retention review's own rules (the queue itself is proven live by scripts/retention_probe.py). */
class RetentionRulesTest {

  static final LocalDate TODAY = LocalDate.of(2026, 10, 27);

  private static String code(Runnable call) {
    ApiException e = assertThrows(ApiException.class, call::run);
    return e.fieldErrors().get(0).field() + ":" + e.fieldErrors().get(0).code();
  }

  @Test
  void everyDataTypeThePolicyOffersHasAQueueAndALock() {
    for (String type : PolicyCatalog.DATA_TYPES) {
      assertTrue(RetentionService.SOURCES.containsKey(type), type);
      assertTrue(RetentionService.LOCKS.containsKey(type), type);
    }
    assertEquals(PolicyCatalog.DATA_TYPES.size(), RetentionService.SOURCES.size());
    assertTrue(PolicyCatalog.DATA_TYPES.containsAll(RetentionService.ANONYMIZABLE));
  }

  @Test
  void onlyLeadsAndCandidatesCanBeAnonymized() {
    assertEquals(java.util.List.of("LEADS", "CANDIDATES"), RetentionService.ANONYMIZABLE);
  }

  @Test
  void anUnknownDataTypeIsNotFound() {
    assertEquals(404, assertThrows(ApiException.class, () -> RetentionService.type("EVERYTHING")).status());
    assertEquals(404, assertThrows(ApiException.class, () -> RetentionService.type(null)).status());
    assertEquals("LEADS", RetentionService.type("LEADS"));
  }

  @Test
  void aKeptRecordIsReviewedAgainAfterTodayAndWithinOneMorePeriod() {
    assertEquals("reviewAgainOn:REQUIRED", code(() -> RetentionService.checkReviewAgainOn(null, TODAY, 12)));
    assertEquals("reviewAgainOn:PAST", code(() -> RetentionService.checkReviewAgainOn(TODAY, TODAY, 12)));
    assertEquals("reviewAgainOn:RANGE", code(() -> RetentionService.checkReviewAgainOn(TODAY.plusMonths(12).plusDays(1), TODAY, 12)));
    assertDoesNotThrow(() -> RetentionService.checkReviewAgainOn(TODAY.plusDays(1), TODAY, 12));
    assertDoesNotThrow(() -> RetentionService.checkReviewAgainOn(TODAY.plusMonths(12), TODAY, 12));
  }

  @Test
  void aDecisionNeedsAReasonOfAtMost500Characters() {
    assertEquals("reason:REQUIRED", code(() -> RetentionService.reason("  ")));
    assertEquals("reason:REQUIRED", code(() -> RetentionService.reason(null)));
    assertEquals("reason:TOO_LONG", code(() -> RetentionService.reason("x".repeat(501))));
    assertEquals("open dispute", RetentionService.reason("  open dispute "));
  }
}
