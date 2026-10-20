package com.ioeti.core.api;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Masks restricted personal data in text that IOETI writes to server logs (gap G-007).
 *
 * <p>Native AOS messages can quote the record they refuse, so a log line may carry an e-mail
 * address, a phone number or an Egyptian national ID. Those are RESTRICTED in
 * {@code docs/security/PII_CLASSIFICATION.md}. This keeps the message useful for diagnosis (record
 * names and reasons stay) while removing the values that identify or reach a person.
 */
public final class PiiMasker {

  static final String EMAIL_MASK = "[email]";
  static final String NATIONAL_ID_MASK = "[national-id]";
  static final String PHONE_MASK = "[phone]";
  static final int MAX_LENGTH = 500;

  // Latin, Arabic-Indic (U+0660..) and Eastern Arabic-Indic (U+06F0..) digits
  private static final String D = "[0-9\\u0660-\\u0669\\u06F0-\\u06F9]";
  private static final Pattern EMAIL =
      Pattern.compile("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}");
  // Egyptian national ID: 14 digits starting with the century digit 2 or 3
  private static final Pattern NATIONAL_ID =
      Pattern.compile("(?<!" + D + ")[23\\u0662\\u0663\\u06F2\\u06F3]" + D + "{13}(?!" + D + ")");
  // seven or more digits, optionally led by + and split by spaces, dots or dashes
  private static final Pattern PHONE =
      Pattern.compile("(?<!" + D + "|[A-Za-z])\\+?" + D + "(?:[ .\\-]?" + D + "){6,}(?!" + D + ")");

  // ISO dates and times are kept: they are not personal and they matter for diagnosis
  private static final Pattern DATE =
      Pattern.compile("(?<![0-9])[0-9]{4}-[0-9]{2}-[0-9]{2}(?:[T ][0-9]{2}:[0-9]{2}(?::[0-9]{2})?)?(?![0-9])");

  private PiiMasker() {}

  public static String mask(String text) {
    if (text == null || text.isEmpty()) return text;
    StringBuilder out = new StringBuilder();
    Matcher date = DATE.matcher(text);
    int from = 0;
    while (date.find()) {
      out.append(maskSegment(text.substring(from, date.start()))).append(date.group());
      from = date.end();
    }
    String masked = out.append(maskSegment(text.substring(from))).toString();
    return masked.length() > MAX_LENGTH ? masked.substring(0, MAX_LENGTH) + "…" : masked;
  }

  private static String maskSegment(String text) {
    String masked = EMAIL.matcher(text).replaceAll(EMAIL_MASK);
    masked = NATIONAL_ID.matcher(masked).replaceAll(NATIONAL_ID_MASK);
    return PHONE.matcher(masked).replaceAll(PHONE_MASK);
  }
}
