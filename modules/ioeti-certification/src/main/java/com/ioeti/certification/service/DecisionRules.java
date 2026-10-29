package com.ioeti.certification.service;

import com.axelor.auth.db.Role;
import com.axelor.auth.db.User;
import com.fasterxml.jackson.databind.JsonNode;
import com.ioeti.core.api.ApiException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * D-02 (signed 2026-10-25) certification decision and certificate rules, without a database.
 *
 * <ul>
 *   <li><b>Who decides.</b> The scheme's {@code cert.decision} policy names the mode: one independent reviewer, or a
 *       committee of {@code committeeSize} people. Nothing is decided while the policy is not set (fail closed).
 *   <li><b>Eligibility.</b> A decision maker holds the {@value #DECISION_ROLE} role (directly or through their group) and
 *       was never the auditor of any audit, of any cycle, of the same client (any status: impartiality is about having
 *       been on the audit team at all).
 *   <li><b>Committee tally.</b> The decision is taken when the required number of distinct eligible people have voted.
 *       GRANT needs a strict majority of those votes; a tie, or a majority to refuse, refuses.
 *   <li><b>Certificate.</b> Number {@code <scheme>-<year>-<serial 4 digits>}, serial per scheme and year; expiry is the
 *       issue date plus the scheme's {@code validityMonths}; surveillance is due every {@code surveillanceMonths} from
 *       issue, before expiry; recertification is due by expiry.
 *   <li><b>Certificate states.</b> ACTIVE ↔ SUSPENDED (suspend / restore), ACTIVE or SUSPENDED → WITHDRAWN (final). A
 *       certificate past its expiry reads as EXPIRED and cannot change state any more.
 *   <li><b>Certificate changes</b> (owner decision 2026-10-29) follow the same mode: an independent reviewer acts alone; a
 *       committee of N votes APPROVE or REJECT on the change, a strict majority of the N approves, a tie or a majority
 *       against rejects. One change round may be open per certificate; a different change meanwhile is 409 CHANGE_PENDING.
 * </ul>
 */
public final class DecisionRules {

  /** The Axelor role that carries the certification decision right. */
  public static final String DECISION_ROLE = "ioeti-cert-decision-maker";

  public static final String INDEPENDENT_REVIEWER = "INDEPENDENT_REVIEWER";
  public static final String COMMITTEE = "COMMITTEE";
  public static final String GRANT = "GRANT";
  public static final String REFUSE = "REFUSE";
  public static final List<String> VOTES = List.of(GRANT, REFUSE);

  public static final String ROUND_OPEN = "OPEN";
  public static final String ROUND_DECIDED = "DECIDED";

  public static final String ACTIVE = "ACTIVE";
  public static final String SUSPENDED = "SUSPENDED";
  public static final String WITHDRAWN = "WITHDRAWN";
  public static final String EXPIRED = "EXPIRED";

  public static final String SUSPEND = "suspend";
  public static final String RESTORE = "restore";
  public static final String WITHDRAW = "withdraw";
  /** Certificate action (path segment) → the event it records. */
  public static final Map<String, String> EVENTS = Map.of(SUSPEND, "SUSPENDED", RESTORE, "RESTORED", WITHDRAW, "WITHDRAWN");
  /** Certificate action (path segment) → the action a change round records. */
  public static final Map<String, String> CHANGE_ACTIONS = Map.of(SUSPEND, "SUSPEND", RESTORE, "RESTORE", WITHDRAW, "WITHDRAW");

  /** Votes and outcomes of a certificate change round. */
  public static final String APPROVE = "APPROVE";
  public static final String REJECT = "REJECT";
  public static final List<String> CHANGE_VOTES = List.of(APPROVE, REJECT);
  public static final String APPROVED = "APPROVED";
  public static final String REJECTED = "REJECTED";

  /** What a suspend / restore / withdraw request does. */
  public static final String CHANGE_APPLY = "APPLY";
  public static final String CHANGE_OPEN = "OPEN";
  public static final String CHANGE_VOTE = "VOTE";
  public static final String CHANGE_PENDING = "CHANGE_PENDING";

  /** Why someone cannot decide on a cycle, in the order they are checked. */
  public static final String NO_DECISION_RIGHT = "NO_DECISION_RIGHT";
  public static final String AUDITED_CLIENT = "AUDITED_CLIENT";
  public static final String ALREADY_VOTED = "ALREADY_VOTED";

  static final Pattern NUMBER = Pattern.compile("[A-Z0-9][A-Z0-9._/-]{2,59}");

  private DecisionRules() {}

  /** How a round decides: the mode and the number of votes it needs. */
  public record Mode(String mode, int requiredVotes) {}

  /** Reads the cert.decision policy value: an independent reviewer needs one vote, a committee committeeSize votes. */
  public static Mode mode(JsonNode value) {
    String mode = value == null ? "" : value.path("mode").asText("");
    if (INDEPENDENT_REVIEWER.equals(mode)) return new Mode(mode, 1);
    if (COMMITTEE.equals(mode) && value.path("committeeSize").canConvertToInt() && value.path("committeeSize").asInt() >= 2) {
      return new Mode(mode, value.path("committeeSize").asInt());
    }
    // the policy validator refuses anything else; a stored value that does not read is treated as not set
    throw new ApiException(422, "POLICY_NOT_SET", "The policy 'cert.decision' does not name a usable decision mode.", null);
  }

  /**
   * The outcome once {@code required} votes are in, else null (still collecting). GRANT needs a strict majority of the
   * votes; a tie refuses, because certification is granted only when most of the committee says so.
   */
  public static String tally(int required, List<String> votes) {
    if (votes.size() < required) return null;
    long grants = votes.stream().filter(GRANT::equals).count();
    return grants * 2 > votes.size() ? GRANT : REFUSE;
  }

  /**
   * The outcome of a certificate change round once {@code required} votes are in, else null: the same rule as a grant
   * ({@link #tally}), APPROVE counting as GRANT. A strict majority approves; a tie or a majority against rejects.
   */
  public static String changeTally(int required, List<String> votes) {
    String outcome = tally(required, votes.stream().map(v -> APPROVE.equals(v) ? GRANT : REFUSE).toList());
    return outcome == null ? null : GRANT.equals(outcome) ? APPROVED : REJECTED;
  }

  /**
   * What a request to change a certificate does. With a change round open: the same action records the person's APPROVE
   * vote ({@value #CHANGE_VOTE}); another action is refused with 409 {@value #CHANGE_PENDING}, whatever the policy now says
   * (a round keeps the mode it was opened with). Without one: an independent reviewer applies it at once
   * ({@value #CHANGE_APPLY}); a committee opens a round ({@value #CHANGE_OPEN}).
   *
   * @param policyMode the scheme's mode now (only read when no round is open)
   * @param openAction the action of the open change round, or null
   * @param action the requested action (SUSPEND, RESTORE or WITHDRAW)
   */
  public static String changeStep(String policyMode, String openAction, String action) {
    if (openAction != null) {
      if (openAction.equals(action)) return CHANGE_VOTE;
      throw new ApiException(409, CHANGE_PENDING,
          "A committee vote on another change to this certificate (" + openAction + ") is still open; it must finish first.", null);
    }
    if (COMMITTEE.equals(policyMode)) return CHANGE_OPEN;
    if (INDEPENDENT_REVIEWER.equals(policyMode)) return CHANGE_APPLY;
    throw new ApiException(422, "POLICY_NOT_SET", "The policy 'cert.decision' does not name a usable decision mode.", null);
  }

  /** Whether a person holds the decision role, directly or through their group. */
  public static boolean holdsDecisionRole(User user) {
    if (user == null || Boolean.TRUE.equals(user.getBlocked())) return false;
    Stream<Role> mine = user.getRoles() == null ? Stream.empty() : user.getRoles().stream();
    Stream<Role> group = user.getGroup() == null || user.getGroup().getRoles() == null ? Stream.empty() : user.getGroup().getRoles().stream();
    return Stream.concat(mine, group).anyMatch(r -> DECISION_ROLE.equals(r.getName()));
  }

  /** Why a person cannot decide (null: they can). */
  public static String cannotDecide(boolean holdsRole, boolean auditedClient, boolean alreadyVoted) {
    if (!holdsRole) return NO_DECISION_RIGHT;
    if (auditedClient) return AUDITED_CLIENT;
    if (alreadyVoted) return ALREADY_VOTED;
    return null;
  }

  /** The expiry of a certificate issued on a date: the issue date plus the scheme's validity in months. */
  public static LocalDate expiry(LocalDate issuedOn, int validityMonths) {
    if (validityMonths < 1) throw new IllegalArgumentException("validityMonths");
    return issuedOn.plusMonths(validityMonths);
  }

  /** Surveillance due dates: every {@code months} from issue, strictly before expiry. */
  public static List<LocalDate> surveillanceDue(LocalDate issuedOn, LocalDate expiresOn, int months) {
    List<LocalDate> due = new ArrayList<>();
    if (months < 1) return due;
    for (int n = 1; n <= 120; n++) {
      LocalDate date = issuedOn.plusMonths((long) n * months);
      if (!date.isBefore(expiresOn)) break;
      due.add(date);
    }
    return due;
  }

  /** The certificate number: scheme code, issue year and a 4-digit serial (per scheme and year). */
  public static String number(String schemeCode, int year, int serial) {
    String scheme = schemeCode.strip().toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]", "");
    return scheme + "-" + year + "-" + String.format("%04d", serial);
  }

  /** A number typed by someone checking a certificate, normalised; null when it cannot be a certificate number. */
  public static String normaliseNumber(String raw) {
    if (raw == null) return null;
    String n = raw.strip().toUpperCase(Locale.ROOT);
    return NUMBER.matcher(n).matches() ? n : null;
  }

  /** What a certificate reads as today: its stored status, or EXPIRED once past expiry (a withdrawal stays withdrawn). */
  public static String effectiveStatus(String stored, LocalDate expiresOn, LocalDate today) {
    if (WITHDRAWN.equals(stored)) return WITHDRAWN;
    return expiresOn != null && today.isAfter(expiresOn) ? EXPIRED : stored;
  }

  /** The status after an action, or 422 CERTIFICATE_STATE when the action does not apply to the current status. */
  public static String next(String effective, String action) {
    if (EXPIRED.equals(effective)) {
      throw new ApiException(422, "CERTIFICATE_EXPIRED", "This certificate has expired; it can no longer change.", null);
    }
    String next = switch (action) {
      case SUSPEND -> ACTIVE.equals(effective) ? SUSPENDED : null;
      case RESTORE -> SUSPENDED.equals(effective) ? ACTIVE : null;
      case WITHDRAW -> ACTIVE.equals(effective) || SUSPENDED.equals(effective) ? WITHDRAWN : null;
      default -> throw ApiException.notFound();
    };
    if (next == null) {
      throw new ApiException(422, "CERTIFICATE_STATE", "This action does not apply to a certificate that is " + effective + ".", null);
    }
    return next;
  }
}
