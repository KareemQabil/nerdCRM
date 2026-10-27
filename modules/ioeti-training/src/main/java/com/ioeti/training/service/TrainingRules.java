package com.ioeti.training.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.ioeti.core.api.ApiException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.DateTimeException;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

/**
 * D-03 (signed 2026-10-25) rules as pure functions, read from the policies the owners set: who meets a course's
 * certificate criteria ({@code training.certificate}), how much of what was paid is refunded on a cancellation
 * ({@code training.cancellation}), and the shape of a national ID ({@code training.national-id}).
 */
public final class TrainingRules {

  static final BigDecimal HUNDRED = new BigDecimal("100");

  private TrainingRules() {}

  // --- certificate criteria -----------------------------------------------------------------------------------

  /** The course's criteria: a minimum attendance and, when the course is assessed, a pass mark. */
  public record Criteria(BigDecimal minAttendancePercent, BigDecimal passMark) {
    public static Criteria of(JsonNode value) {
      return new Criteria(value.path("minAttendancePercent").decimalValue(),
          value.hasNonNull("passMark") ? value.get("passMark").decimalValue() : null);
    }

    public boolean assessed() {
      return passMark != null;
    }
  }

  /** Whether a trainee meets the criteria; {@code reason} names the first unmet one (null when eligible). */
  public record Eligibility(boolean eligible, String reason, BigDecimal attendancePercent) {}

  /** Sessions attended out of the cohort's scheduled sessions, rounded down (79.99% never reads as 80%). */
  public static BigDecimal attendancePercent(int present, int sessions) {
    if (sessions <= 0) return null;
    return BigDecimal.valueOf(present).multiply(HUNDRED).divide(BigDecimal.valueOf(sessions), 2, RoundingMode.DOWN);
  }

  /**
   * Attendance counts the sessions marked present over every scheduled session of the cohort (absent, excused and
   * not yet recorded do not count). The score is checked only where the course has a pass mark.
   */
  public static Eligibility evaluate(Criteria criteria, boolean confirmed, int sessions, int present, BigDecimal score) {
    BigDecimal attendance = attendancePercent(present, sessions);
    if (!confirmed) return new Eligibility(false, "NOT_CONFIRMED", attendance);
    if (attendance == null) return new Eligibility(false, "NO_SESSIONS", null);
    if (attendance.compareTo(criteria.minAttendancePercent()) < 0) return new Eligibility(false, "ATTENDANCE_BELOW", attendance);
    if (criteria.assessed()) {
      if (score == null) return new Eligibility(false, "SCORE_MISSING", attendance);
      if (score.compareTo(criteria.passMark()) < 0) return new Eligibility(false, "SCORE_BELOW", attendance);
    }
    return new Eligibility(true, null, attendance);
  }

  /** A plain sentence for a refusal (the UI shows its own wording per reason code). */
  public static String explain(String reason, Criteria criteria, BigDecimal attendance, BigDecimal score) {
    return switch (reason) {
      case "NOT_CONFIRMED" -> "Only a confirmed trainee can receive a certificate.";
      case "NO_SESSIONS" -> "The cohort has no sessions, so attendance cannot be measured.";
      case "ATTENDANCE_BELOW" -> "Attendance is " + plain(attendance) + "% and the course requires "
          + plain(criteria.minAttendancePercent()) + "%.";
      case "SCORE_MISSING" -> "The course has a pass mark of " + plain(criteria.passMark()) + " and no score is recorded.";
      case "SCORE_BELOW" -> "The score is " + plain(score) + " and the pass mark is " + plain(criteria.passMark()) + ".";
      default -> "This trainee does not meet the course's criteria.";
    };
  }

  /** A score of 0 to 100 with at most two decimals. */
  public static BigDecimal checkedScore(BigDecimal score) {
    if (score == null) throw ApiException.invalidField("score", "REQUIRED", "Give a score from 0 to 100.");
    if (score.signum() < 0 || score.compareTo(HUNDRED) > 0 || score.stripTrailingZeros().scale() > 2) {
      throw ApiException.invalidField("score", "RANGE", "The score must be between 0 and 100, with up to 2 decimals.");
    }
    return score.setScale(2, RoundingMode.UNNECESSARY);
  }

  // --- cancellation and refunds -------------------------------------------------------------------------------

  /** One step of the cancellation policy: cancelling at least this many days before the start refunds this share. */
  public record Step(int daysBeforeStart, BigDecimal refundPercent) {}

  public static List<Step> steps(JsonNode value) {
    List<Step> steps = new ArrayList<>();
    for (JsonNode step : value.path("steps")) {
      steps.add(new Step(step.path("daysBeforeStart").asInt(), step.path("refundPercent").decimalValue()));
    }
    return steps;
  }

  /** Whole days from the cancellation to the cohort's first day (negative once it has started). */
  public static long daysBeforeStart(LocalDate start, LocalDate cancelledOn) {
    return ChronoUnit.DAYS.between(cancelledOn, start);
  }

  /**
   * The refund share for a cancellation this many days before the start: the step with the largest number of days
   * that is still met; none met (too late, or after the start) refunds nothing.
   */
  public static BigDecimal refundPercent(List<Step> steps, long daysBeforeStart) {
    Step best = null;
    for (Step step : steps) {
      if (step.daysBeforeStart() <= daysBeforeStart && (best == null || step.daysBeforeStart() > best.daysBeforeStart())) best = step;
    }
    return best == null ? BigDecimal.ZERO.setScale(2) : best.refundPercent().setScale(2, RoundingMode.HALF_UP);
  }

  /**
   * What was actually paid for one enrolment on an invoice: the money received on the invoice (validated payments,
   * not credit notes), shared in proportion to the enrolment's part of the invoice, never more than that part.
   */
  public static BigDecimal paidShare(BigDecimal received, BigDecimal feeAmount, BigDecimal invoiceTotal) {
    if (received == null || received.signum() <= 0 || feeAmount == null || feeAmount.signum() <= 0
        || invoiceTotal == null || invoiceTotal.signum() <= 0) {
      return BigDecimal.ZERO.setScale(2);
    }
    BigDecimal share = received.min(invoiceTotal).multiply(feeAmount).divide(invoiceTotal, 2, RoundingMode.DOWN);
    return share.min(feeAmount.setScale(2, RoundingMode.DOWN));
  }

  /** The refund: the policy's share of what was paid, to the piaster. */
  public static BigDecimal refundAmount(BigDecimal paid, BigDecimal percent) {
    return paid.multiply(percent).divide(HUNDRED, 2, RoundingMode.HALF_UP);
  }

  /**
   * The share of the invoice the credit note covers (D-06 credit notes are a share of the invoice with two
   * decimals), rounded down so the credit note never exceeds the refund.
   */
  public static BigDecimal creditPercent(BigDecimal refund, BigDecimal invoiceTotal) {
    if (refund.signum() <= 0 || invoiceTotal == null || invoiceTotal.signum() <= 0) return BigDecimal.ZERO.setScale(2);
    return refund.multiply(HUNDRED).divide(invoiceTotal, 2, RoundingMode.DOWN).min(HUNDRED.setScale(2));
  }

  /** The credit note's total matches the refund's share of the invoice, allowing for the native line rounding. */
  public static boolean creditMatches(BigDecimal creditTotal, BigDecimal invoiceTotal, BigDecimal creditPercent) {
    if (creditTotal == null || invoiceTotal == null) return false;
    BigDecimal expected = invoiceTotal.multiply(creditPercent).divide(HUNDRED, 2, RoundingMode.HALF_UP);
    BigDecimal tolerance = expected.multiply(new BigDecimal("0.001")).max(new BigDecimal("0.05"));
    return creditTotal.subtract(expected).abs().compareTo(tolerance) <= 0;
  }

  // --- national ID --------------------------------------------------------------------------------------------

  /**
   * An Egyptian national ID: 14 digits (Arabic-Indic digits are accepted), the first giving the century (2 or 3),
   * then a real date of birth. Spaces and dashes are ignored. Never echoed back in an error.
   */
  public static String nationalId(String raw) {
    StringBuilder digits = new StringBuilder();
    for (char c : (raw == null ? "" : raw).toCharArray()) {
      if (c >= '٠' && c <= '٩') digits.append((char) ('0' + (c - '٠')));
      else if (c >= '۰' && c <= '۹') digits.append((char) ('0' + (c - '۰')));
      else if (c >= '0' && c <= '9') digits.append(c);
      else if (c != ' ' && c != '-') throw badId();
    }
    String id = digits.toString();
    if (id.length() != 14 || (id.charAt(0) != '2' && id.charAt(0) != '3')) throw badId();
    int century = id.charAt(0) == '2' ? 1900 : 2000;
    try {
      LocalDate.of(century + Integer.parseInt(id.substring(1, 3)), Integer.parseInt(id.substring(3, 5)), Integer.parseInt(id.substring(5, 7)));
    } catch (DateTimeException e) {
      throw badId();
    }
    return id;
  }

  private static ApiException badId() {
    return ApiException.invalidField("nationalId", "FORMAT", "Enter the 14 digits of the national ID card.");
  }

  static String plain(BigDecimal value) {
    return value == null ? "-" : value.stripTrailingZeros().toPlainString();
  }
}
