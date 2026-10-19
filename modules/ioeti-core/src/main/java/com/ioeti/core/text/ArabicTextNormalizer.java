package com.ioeti.core.text;

import java.text.Normalizer;
import java.util.Locale;

/**
 * Normalises Arabic (and mixed Arabic/Latin) text for matching, not for display.
 *
 * <p>Used as the foundation for duplicate detection of companies and people (spec: "تطبيع النص
 * العربي قبل المقارنة"). Rules:
 *
 * <ul>
 *   <li>remove tashkeel (harakat, tanween, shadda, sukun, superscript alef) and tatweel;
 *   <li>unify alef forms (أ إ آ ٱ) to ا;
 *   <li>ta marbuta ة to ه, alef maqsura ى to ي;
 *   <li>hamza on carriers (ؤ ئ) to و / ي;
 *   <li>Arabic-Indic and Persian digits to ASCII digits;
 *   <li>Latin text: strip accents, lower-case;
 *   <li>collapse whitespace and punctuation to single spaces.
 * </ul>
 */
public final class ArabicTextNormalizer {

  private ArabicTextNormalizer() {}

  public static String normalize(String input) {
    if (input == null) {
      return "";
    }
    String text = Normalizer.normalize(input, Normalizer.Form.NFKC);
    StringBuilder out = new StringBuilder(text.length());
    for (int i = 0; i < text.length(); i++) {
      char c = text.charAt(i);
      if (isTashkeel(c) || c == 'ـ') { // tatweel
        continue;
      }
      out.append(mapChar(c));
    }
    String latin =
        Normalizer.normalize(out.toString(), Normalizer.Form.NFD)
            .replaceAll("\\p{InCombiningDiacriticalMarks}+", "");
    return latin
        .toLowerCase(Locale.ROOT)
        .replaceAll("[\\p{Punct}\\u060C\\u061B\\u061F\\u066A-\\u066D\\u06D4]+", " ")
        .replaceAll("\\s+", " ")
        .trim();
  }

  /** True when both values are equal after normalisation (null and blank are never equal). */
  public static boolean sameText(String a, String b) {
    String na = normalize(a);
    return !na.isEmpty() && na.equals(normalize(b));
  }

  /** True when the text contains at least one Arabic letter. */
  public static boolean containsArabic(String input) {
    return input != null && input.codePoints().anyMatch(cp -> cp >= 0x0621 && cp <= 0x064A);
  }

  private static boolean isTashkeel(char c) {
    return (c >= 'ً' && c <= 'ٟ') || c == 'ٰ' || (c >= 'ۖ' && c <= 'ۭ');
  }

  private static char mapChar(char c) {
    switch (c) {
      case 'أ': // أ
      case 'إ': // إ
      case 'آ': // آ
      case 'ٱ': // ٱ
        return 'ا'; // ا
      case 'ة': // ة
        return 'ه'; // ه
      case 'ى': // ى
        return 'ي'; // ي
      case 'ؤ': // ؤ
        return 'و'; // و
      case 'ئ': // ئ
        return 'ي'; // ي
      default:
        if (c >= '٠' && c <= '٩') {
          return (char) ('0' + (c - '٠'));
        }
        if (c >= '۰' && c <= '۹') {
          return (char) ('0' + (c - '۰'));
        }
        return c;
    }
  }
}
