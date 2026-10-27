package com.ioeti.fundraising.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

/** D-05: receipt numbering and when a receipt may be issued, without a database. */
class ReceiptRulesTest {

  @Test
  void numbersRunPerYearAndAreZeroPadded() {
    assertEquals("DR-2026-000001", ReceiptRules.number(2026, 1));
    assertEquals("DR-2026-000001", ReceiptRules.next(2026, null));
    assertEquals("DR-2026-000043", ReceiptRules.next(2026, "DR-2026-000042"));
    assertEquals("DR-2026-001000", ReceiptRules.next(2026, "DR-2026-000999"));
    // padded numbers sort as text, so the highest issued number is MAX(number) within the year
    assertEquals(1, "DR-2026-000010".compareTo("DR-2026-000009"));
  }

  @Test
  void aNumberIsNeverReusedOrTakenFromAnotherYear() {
    assertThrows(IllegalArgumentException.class, () -> ReceiptRules.next(2027, "DR-2026-000042"));
    assertThrows(IllegalArgumentException.class, () -> ReceiptRules.next(2026, "INV-2026-000042"));
    assertThrows(IllegalArgumentException.class, () -> ReceiptRules.number(2026, 0));
    assertThrows(IllegalArgumentException.class, () -> ReceiptRules.next(2026, "DR-2026-999999"));
  }

  @Test
  void onlyARecordedCollectionWithoutAReceiptInForceGetsOne() {
    assertNull(ReceiptRules.refusal(false, false));
    assertEquals("RECEIPT_EXISTS", ReceiptRules.refusal(false, true));
    assertEquals("COLLECTION_VOIDED", ReceiptRules.refusal(true, false));
    assertEquals("COLLECTION_VOIDED", ReceiptRules.refusal(true, true));
  }
}
