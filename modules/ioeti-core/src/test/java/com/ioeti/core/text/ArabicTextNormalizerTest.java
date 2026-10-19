package com.ioeti.core.text;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class ArabicTextNormalizerTest {

  @Test
  void unifiesAlefHamzaTaMarbutaAndYa() {
    assertEquals(
        ArabicTextNormalizer.normalize("مؤسسة الإسكندرية للضيافة"),
        ArabicTextNormalizer.normalize("موسسه الاسكندريه للضيافه"));
    assertEquals("مستشفي", ArabicTextNormalizer.normalize("مستشفى"));
  }

  @Test
  void removesTashkeelAndTatweel() {
    assertEquals("فندق", ArabicTextNormalizer.normalize("فُنْدُق"));
    assertEquals("فندق", ArabicTextNormalizer.normalize("فـنـدق"));
  }

  @Test
  void convertsArabicIndicDigitsAndCollapsesPunctuation() {
    assertEquals("فندق 5 نجوم", ArabicTextNormalizer.normalize("فندق ٥ - نجوم!"));
    assertEquals("iso 22000", ArabicTextNormalizer.normalize("ISO ۲۲۰۰۰"));
  }

  @Test
  void normalisesLatinAccentsAndCase() {
    assertEquals("cafe royal", ArabicTextNormalizer.normalize("  Café   ROYAL "));
  }

  @Test
  void sameTextIgnoresSpellingVariantsButNotBlank() {
    assertTrue(ArabicTextNormalizer.sameText("شركة النيل", "شركه النيل"));
    assertFalse(ArabicTextNormalizer.sameText("", ""));
    assertFalse(ArabicTextNormalizer.sameText(null, null));
  }

  @Test
  void detectsArabicLetters() {
    assertTrue(ArabicTextNormalizer.containsArabic("ISO أيزو"));
    assertFalse(ArabicTextNormalizer.containsArabic("ISO 9001"));
    assertFalse(ArabicTextNormalizer.containsArabic(null));
  }
}
