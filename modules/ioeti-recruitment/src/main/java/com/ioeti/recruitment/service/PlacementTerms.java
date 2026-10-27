package com.ioeti.recruitment.service;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;

/**
 * D-04 (signed 2026-10-25) arithmetic for a placement, kept free of persistence so every rule is unit tested.
 *
 * <ul>
 *   <li>The fee is the client agreement's percentage of the offered annual salary, rounded half up to 2 decimals.
 *   <li>The guarantee runs from the day the candidate started for {@code guaranteeDays} days; the last day counts.
 *   <li>A candidate who leaves on or before the last day left within the guarantee, and the agreement's rule applies:
 *       REPLACE opens a free replacement, PARTIAL_REFUND credits {@code refundPercent} of the fee, NONE does nothing.
 * </ul>
 */
public final class PlacementTerms {

  /** The policy that holds each client agreement (scope: the client account id; a default may apply). */
  public static final String KEY = "recruitment.agreement";

  public static final String START_DATE = "START_DATE", OFFER_ACCEPTED = "OFFER_ACCEPTED";
  public static final String REPLACE = "REPLACE", PARTIAL_REFUND = "PARTIAL_REFUND", NONE = "NONE";

  private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);

  private PlacementTerms() {}

  /** The client agreement as the policy stores it. */
  public record Agreement(BigDecimal feePercent, String invoiceOn, int guaranteeDays, String replacement, BigDecimal refundPercent) {

    public static Agreement of(JsonNode value) {
      return new Agreement(value.path("feePercent").decimalValue(), value.path("invoiceOn").asText(),
          value.path("guaranteeDays").asInt(), value.path("replacement").asText(),
          value.hasNonNull("refundPercent") ? value.path("refundPercent").decimalValue() : null);
    }
  }

  /** What an early exit leads to. */
  public enum Outcome { REPLACEMENT_OPENED, REFUND_REQUESTED, NO_REMEDY, OUTSIDE_GUARANTEE, NO_FEE_TO_REFUND }

  /** feePercent × annual salary, rounded half up to 2 decimals. */
  public static BigDecimal fee(BigDecimal annualSalary, BigDecimal feePercent) {
    return annualSalary.multiply(feePercent).divide(HUNDRED, 2, RoundingMode.HALF_UP);
  }

  /** The share of the fee credited back: refundPercent × fee, rounded half up to 2 decimals. */
  public static BigDecimal refund(BigDecimal fee, BigDecimal refundPercent) {
    return fee.multiply(refundPercent).divide(HUNDRED, 2, RoundingMode.HALF_UP);
  }

  /** The last day of the guarantee: the start day plus guaranteeDays (0 days: the start day itself). */
  public static LocalDate guaranteeEnd(LocalDate startedOn, int guaranteeDays) {
    return startedOn.plusDays(guaranteeDays);
  }

  /** Leaving on the last day of the guarantee is still within it. */
  public static boolean within(LocalDate exitedOn, LocalDate guaranteeEndsOn) {
    return !exitedOn.isAfter(guaranteeEndsOn);
  }

  /** Days left in the guarantee from today (0 on the last day and after it). */
  public static long daysLeft(LocalDate guaranteeEndsOn, LocalDate today) {
    return Math.max(0, ChronoUnit.DAYS.between(today, guaranteeEndsOn));
  }

  /** Whether the agreement's fee trigger has happened. */
  public static boolean due(String invoiceOn, boolean offerAccepted, boolean started) {
    return OFFER_ACCEPTED.equals(invoiceOn) ? offerAccepted : started;
  }

  /** The agreement's rule applied to an exit; a refund needs a fee request to credit. */
  public static Outcome outcome(String rule, boolean within, boolean feeRequested) {
    if (!within) return Outcome.OUTSIDE_GUARANTEE;
    return switch (rule) {
      case REPLACE -> Outcome.REPLACEMENT_OPENED;
      case PARTIAL_REFUND -> feeRequested ? Outcome.REFUND_REQUESTED : Outcome.NO_FEE_TO_REFUND;
      default -> Outcome.NO_REMEDY;
    };
  }

  /**
   * The guarantee as people read it: TERMS_PENDING (no client agreement applied yet), NOT_STARTED (the candidate has
   * not started), ACTIVE (until the last day), CLOSED (the period passed), EARLY_EXIT or EXITED_AFTER.
   */
  public static String guaranteeStatus(boolean termsApplied, LocalDate startedOn, LocalDate guaranteeEndsOn, LocalDate exitedOn,
      LocalDate today) {
    if (exitedOn != null) return guaranteeEndsOn != null && within(exitedOn, guaranteeEndsOn) ? "EARLY_EXIT" : "EXITED_AFTER";
    if (!termsApplied) return "TERMS_PENDING";
    if (startedOn == null || guaranteeEndsOn == null) return "NOT_STARTED";
    return today.isAfter(guaranteeEndsOn) ? "CLOSED" : "ACTIVE";
  }
}
