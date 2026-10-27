package com.ioeti.core.text;

import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Normalizes text for search and duplicate detection, so that common Arabic spelling variants and
 * digits match: alef forms (أ إ آ ٱ → ا), taa marbuta (ة → ه), alef maqsura (ى → ي), hamza on waw and
 * yaa (ؤ → و, ئ → ي), tatweel and diacritics removed, Arabic-Indic and Persian digits → 0-9, Latin
 * letters lowercased, punctuation and repeated spaces collapsed. Used only for matching; the original
 * text is always kept and shown.
 */
public final class ArabicNormalizer {

  private static final Pattern DIACRITICS = Pattern.compile("[\\u064B-\\u065F\\u0670\\u06D6-\\u06ED\\u0640]");
  private static final Pattern NON_WORD = Pattern.compile("[^\\p{L}\\p{N}@+]+");

  private ArabicNormalizer() {}

  public static String normalize(String text) {
    if (text == null) return "";
    StringBuilder out = new StringBuilder(text.length());
    String stripped = DIACRITICS.matcher(text).replaceAll("");
    for (int i = 0; i < stripped.length(); i++) {
      char c = stripped.charAt(i);
      switch (c) {
        case 'أ', 'إ', 'آ', 'ٱ' -> out.append('ا');
        case 'ة' -> out.append('ه');
        case 'ى', 'ئ' -> out.append('ي');
        case 'ؤ' -> out.append('و');
        default -> {
          if (c >= '٠' && c <= '٩') out.append((char) ('0' + (c - '٠')));
          else if (c >= '۰' && c <= '۹') out.append((char) ('0' + (c - '۰')));
          else out.append(c);
        }
      }
    }
    return NON_WORD.matcher(out.toString().toLowerCase(Locale.ROOT)).replaceAll(" ").trim();
  }

  /** Digits only, Arabic-Indic digits included; the last 9 digits identify a phone across prefixes. */
  public static String phoneKey(String phone) {
    String digits = normalize(phone).replaceAll("[^0-9]", "");
    return digits.length() > 9 ? digits.substring(digits.length() - 9) : digits;
  }

  public static String emailKey(String email) {
    return email == null ? "" : email.strip().toLowerCase(Locale.ROOT);
  }
}
