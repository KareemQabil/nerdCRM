package com.ioeti.fundraising.service;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * D-05 (signed 2026-10-25) donation receipt rules, free of persistence so each one is unit tested.
 *
 * <ul>
 *   <li>A receipt is issued only for a recorded collection: never for a pledge, an installment or a voided collection.
 *   <li>One receipt in force per collection; a voided receipt stays on file and a reissue gets a new number.
 *   <li>Numbers run per calendar year of issue: {@code DR-2026-000001}, never reused.
 * </ul>
 */
public final class ReceiptRules {

  static final Pattern NUMBER = Pattern.compile("DR-(\\d{4})-(\\d{6})");

  private ReceiptRules() {}

  /** The receipt number for a year and a sequence: DR-yyyy-nnnnnn. */
  public static String number(int year, long sequence) {
    if (sequence < 1 || sequence > 999_999) throw new IllegalArgumentException("sequence out of range");
    return String.format("DR-%04d-%06d", year, sequence);
  }

  /** The next number of a year after the highest one already issued in that year (null: none yet). */
  public static String next(int year, String highest) {
    if (highest == null) return number(year, 1);
    Matcher m = NUMBER.matcher(highest);
    if (!m.matches() || Integer.parseInt(m.group(1)) != year) throw new IllegalArgumentException("not a receipt number of " + year);
    return number(year, Long.parseLong(m.group(2)) + 1);
  }

  /** Why a receipt cannot be issued for this collection, or null when it can. */
  public static String refusal(boolean collectionVoided, boolean receiptInForce) {
    if (collectionVoided) return "COLLECTION_VOIDED";
    if (receiptInForce) return "RECEIPT_EXISTS";
    return null;
  }
}
