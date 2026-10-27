package com.ioeti.core.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class PiiMaskerTest {

  @Test
  void masksEmailPhoneAndNationalId() {
    assertEquals(
        "Partner Nile View: contact [email], mobile [phone], ID [national-id].",
        PiiMasker.mask(
            "Partner Nile View: contact sara.adel@nileview.example, mobile +20 100 123 4567, ID 29001011234567."));
  }

  @Test
  void masksArabicIndicDigits() {
    assertEquals("هاتف [phone] رقم قومي [national-id]",
        PiiMasker.mask("هاتف ٠١٠٠١٢٣٤٥٦٧ رقم قومي ٢٩٠٠١٠١١٢٣٤٥٦٧"));
  }

  @Test
  void keepsReferencesDatesAndAmounts() {
    String text = "Quotation SO-000123 due 2026-10-20 (logged 2026-10-20T09:30:00): 3000.00 EGP, line 12, version 4";
    assertEquals(text, PiiMasker.mask(text));
  }

  @Test
  void boundsLengthAndAcceptsNull() {
    assertNull(PiiMasker.mask(null));
    String masked = PiiMasker.mask("x".repeat(2000));
    assertEquals(PiiMasker.MAX_LENGTH + 1, masked.length());
    assertTrue(masked.endsWith("…"));
  }
}
