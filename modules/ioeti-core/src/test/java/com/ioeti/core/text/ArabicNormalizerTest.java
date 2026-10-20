package com.ioeti.core.text;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class ArabicNormalizerTest {

  @Test
  void arabicSpellingVariantsMatch() {
    assertEquals(ArabicNormalizer.normalize("أحمد"), ArabicNormalizer.normalize("احمد"));
    assertEquals(ArabicNormalizer.normalize("إسلام"), ArabicNormalizer.normalize("اسلام"));
    assertEquals(ArabicNormalizer.normalize("شركة النيل"), ArabicNormalizer.normalize("شركه النيل"));
    assertEquals(ArabicNormalizer.normalize("مصطفى"), ArabicNormalizer.normalize("مصطفي"));
    assertEquals(ArabicNormalizer.normalize("مُحَمَّد"), ArabicNormalizer.normalize("محمد"));
    assertEquals(ArabicNormalizer.normalize("القاهـــرة"), ArabicNormalizer.normalize("القاهرة"));
  }

  @Test
  void latinIsLowercasedAndPunctuationCollapsed() {
    assertEquals("nile foods co", ArabicNormalizer.normalize("  Nile-Foods,  Co. "));
  }

  @Test
  void phonesMatchAcrossDigitsAndPrefixes() {
    assertEquals(ArabicNormalizer.phoneKey("+20 100 555 0101"), ArabicNormalizer.phoneKey("٠١٠٠٥٥٥٠١٠١"));
    assertEquals("", ArabicNormalizer.phoneKey(null));
  }

  @Test
  void emailsCompareCaseInsensitively() {
    assertEquals("sara@example.com", ArabicNormalizer.emailKey(" Sara@Example.com "));
  }
}
