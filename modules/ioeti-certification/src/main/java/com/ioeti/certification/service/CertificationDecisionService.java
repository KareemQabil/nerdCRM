package com.ioeti.certification.service;

import com.axelor.apps.base.db.Partner;
import com.axelor.apps.base.service.app.AppBaseService;
import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.User;
import com.axelor.db.JPA;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.google.inject.Inject;
import com.google.inject.persist.Transactional;
import com.ioeti.certification.db.CertificateEvent;
import com.ioeti.certification.db.CertificationAudit;
import com.ioeti.certification.db.CertificationCycle;
import com.ioeti.certification.db.CertificationDecision;
import com.ioeti.certification.db.CertificationVote;
import com.ioeti.certification.db.ClientCertificate;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.Locks;
import com.ioeti.core.db.PolicyVersion;
import com.ioeti.core.notify.Notifier;
import com.ioeti.core.policy.PolicyService;
import jakarta.persistence.LockModeType;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * D-02 (signed 2026-10-25): certification decisions and certificates, driven by the scheme's policies.
 *
 * <ul>
 *   <li>{@code cert.decision} (per scheme, i.e. the cycle's standard code): INDEPENDENT_REVIEWER or COMMITTEE of
 *       committeeSize. {@code cert.cycle}: validityMonths and surveillanceMonths. Both must be in force, or every decision
 *       is refused with 422 POLICY_NOT_SET.
 *   <li>A decision maker holds the decision role and was never the auditor of any audit of the same client (see
 *       {@link DecisionRules}); anyone else is refused with 403.
 *   <li>Stage 1 and Stage 2 must be completed before any vote; a GRANT also needs no open major nonconformity, checked
 *       for each GRANT vote and again when the votes are tallied.
 *   <li>A GRANT issues the certificate in the same transaction; a cycle has at most one certificate. A REFUSE closes the
 *       round; a later round may be opened (e.g. after more corrective action).
 *   <li>Suspending, restoring and withdrawing follow the same mode (owner decision 2026-10-29): one independent reviewer
 *       acts alone; a committee votes on a change round (APPROVE / REJECT, majority approves, a tie rejects). Change rounds
 *       are kept apart from grant rounds ({@link #openRound} ignores them).
 * </ul>
 *
 * <p>Votes lock the cycle row ({@code PESSIMISTIC_FORCE_INCREMENT}): concurrent votes on one cycle take turns and a vote
 * sent with a stale cycle version answers 409. Certificate numbers are allocated under a transaction lock per scheme and
 * year.
 */
public class CertificationDecisionService {

  public static final String DECISION_POLICY = "cert.decision";
  public static final String CYCLE_POLICY = "cert.cycle";
  public static final String SUBJECT = "CERT_CYCLE";

  private final PolicyService policies;

  @Inject
  public CertificationDecisionService(PolicyService policies) {
    this.policies = policies;
  }

  /** Today for the person acting (their company's time zone), or the server's for anonymous checks. */
  public static LocalDate today() {
    User me = AuthUtils.getUser();
    return Beans.get(AppBaseService.class).getTodayDate(me == null ? null : me.getActiveCompany());
  }

  public static String scheme(CertificationCycle cycle) {
    return cycle.getBusinessLine().getCode();
  }

  // --- policies ------------------------------------------------------------------------------------------------

  public Optional<PolicyService.Applied> decisionPolicy(CertificationCycle cycle, LocalDate on) {
    return policies.current(DECISION_POLICY, scheme(cycle), on);
  }

  public Optional<PolicyService.Applied> cyclePolicy(CertificationCycle cycle, LocalDate on) {
    return policies.current(CYCLE_POLICY, scheme(cycle), on);
  }

  /** The D-02 policies not in force for the cycle's scheme on the date, in a stable order. */
  public List<String> missingPolicies(CertificationCycle cycle, LocalDate on) {
    List<String> missing = new ArrayList<>();
    if (decisionPolicy(cycle, on).isEmpty()) missing.add(DECISION_POLICY);
    if (cyclePolicy(cycle, on).isEmpty()) missing.add(CYCLE_POLICY);
    return missing;
  }

  // --- records ---------------------------------------------------------------------------------------------------

  public static ClientCertificate certificate(CertificationCycle cycle) {
    return Query.of(ClientCertificate.class).filter("self.cycle = :cycle").bind("cycle", cycle).fetchOne();
  }

  /** The open certification (grant) round of a cycle; certificate change rounds are not grant rounds. */
  public static CertificationDecision openRound(CertificationCycle cycle) {
    return Query.of(CertificationDecision.class).filter("self.cycle = :cycle AND self.status = :open AND self.changeAction IS NULL")
        .bind("cycle", cycle).bind("open", DecisionRules.ROUND_OPEN).order("-id").fetchOne();
  }

  /** The certification (grant) rounds of a cycle, newest first. */
  public static List<CertificationDecision> rounds(CertificationCycle cycle) {
    return Query.of(CertificationDecision.class).filter("self.cycle = :cycle AND self.changeAction IS NULL").bind("cycle", cycle)
        .order("-id").fetch(50);
  }

  /** The open committee round on a change to the certificate (at most one), or null. */
  public static CertificationDecision openChange(ClientCertificate certificate) {
    return Query.of(CertificationDecision.class).filter("self.certificate = :c AND self.status = :open AND self.changeAction IS NOT NULL")
        .bind("c", certificate).bind("open", DecisionRules.ROUND_OPEN).order("-id").fetchOne();
  }

  /** The committee rounds on changes to the certificate, newest first. */
  public static List<CertificationDecision> changeRounds(ClientCertificate certificate) {
    return Query.of(CertificationDecision.class).filter("self.certificate = :c AND self.changeAction IS NOT NULL").bind("c", certificate)
        .order("-id").fetch(50);
  }

  public static List<CertificationVote> votes(CertificationDecision round) {
    return Query.of(CertificationVote.class).filter("self.decision = :round").bind("round", round).order("castAt").order("id").fetch(20);
  }

  public static List<CertificateEvent> events(ClientCertificate certificate) {
    return Query.of(CertificateEvent.class).filter("self.certificate = :c").bind("c", certificate).order("occurredAt").order("id").fetch(100);
  }

  /** Whether the person was ever the auditor of an audit (any status) of any cycle of this client. */
  public static boolean auditedClient(User user, Partner client) {
    return user != null && Query.of(CertificationAudit.class).filter("self.cycle.client = :client AND self.auditor = :user")
        .bind("client", client).bind("user", user).count() > 0;
  }

  /** Active people holding the decision role directly or through their group. */
  public static List<User> roleHolders() {
    return Query.of(User.class).filter("(self.blocked IS NULL OR self.blocked = false) AND EXISTS (SELECT r FROM Role r WHERE r.name = :role"
        + " AND (r MEMBER OF self.roles OR (self.group IS NOT NULL AND r MEMBER OF self.group.roles)))")
        .bind("role", DecisionRules.DECISION_ROLE).order("name").fetch(200);
  }

  /** Role holders who never audited this client: the people who may take part in its decisions. */
  public static List<User> eligible(CertificationCycle cycle) {
    List<User> audited = Query.of(CertificationAudit.class).filter("self.cycle.client = :client").bind("client", cycle.getClient())
        .fetch().stream().map(CertificationAudit::getAuditor).distinct().toList();
    return roleHolders().stream().filter(u -> !audited.contains(u)).toList();
  }

  /** Why the person cannot vote on the cycle now (null: they can). */
  public static String cannotDecide(User user, CertificationCycle cycle, CertificationDecision open) {
    boolean voted = open != null && user != null && votes(open).stream().anyMatch(v -> v.getVoter().equals(user));
    return DecisionRules.cannotDecide(DecisionRules.holdsDecisionRole(user), auditedClient(user, cycle.getClient()), voted);
  }

  /** 403 when the person may not take certification decisions on this cycle (no role, or audited this client). */
  public static void requireDecisionMaker(User user, CertificationCycle cycle) {
    String reason = DecisionRules.cannotDecide(DecisionRules.holdsDecisionRole(user), auditedClient(user, cycle.getClient()), false);
    if (DecisionRules.NO_DECISION_RIGHT.equals(reason)) {
      throw new ApiException(403, reason, "Only people with the certification decision right take certification decisions.", null);
    }
    if (DecisionRules.AUDITED_CLIENT.equals(reason)) {
      throw new ApiException(403, reason, "You audited this client, so you cannot take its certification decisions (impartiality).", null);
    }
  }

  /**
   * Where the decision stands: GRANTED (a certificate exists), BLOCKED_BY_POLICY (a D-02 policy is not set for the
   * scheme), NOT_READY (Stage 1 or Stage 2 not completed), AWAITING_DECISION (votes may be cast; a round may be open), or
   * REFUSED (the last round refused and none is open; a new round may start).
   */
  public String status(CertificationCycle cycle, LocalDate today) {
    return status(cycle, certificate(cycle), missingPolicies(cycle, today), CertificationService.auditBlockers(cycle));
  }

  /** {@link #status(CertificationCycle, LocalDate)} from values the caller already has. */
  public static String status(CertificationCycle cycle, ClientCertificate certificate, List<String> missing, List<String> blockers) {
    if (certificate != null) return "GRANTED";
    if (!missing.isEmpty()) return "BLOCKED_BY_POLICY";
    if (blockers.contains(CertificationService.BLOCKER_STAGE1) || blockers.contains(CertificationService.BLOCKER_STAGE2)) return "NOT_READY";
    if (openRound(cycle) != null) return "AWAITING_DECISION";
    List<CertificationDecision> rounds = rounds(cycle);
    return !rounds.isEmpty() && DecisionRules.REFUSE.equals(rounds.get(0).getOutcome()) ? "REFUSED" : "AWAITING_DECISION";
  }

  // --- decisions -------------------------------------------------------------------------------------------------

  /**
   * Records a vote (an independent reviewer's decision is a round of one vote). Takes the decision once the round has
   * its votes, issuing the certificate on GRANT. Returns the round.
   */
  @Transactional(rollbackOn = {Exception.class})
  public CertificationDecision vote(CertificationCycle cycle, User voter, String vote, String reason, LocalDate today) {
    JPA.em().lock(cycle, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    requireDecisionMaker(voter, cycle);
    PolicyService.Applied decisionPolicy = policies.require(DECISION_POLICY, scheme(cycle), today);
    PolicyService.Applied cyclePolicy = policies.require(CYCLE_POLICY, scheme(cycle), today);
    if (certificate(cycle) != null) {
      throw new ApiException(409, "ALREADY_CERTIFIED", "This cycle already has its certificate.", null);
    }
    List<String> blockers = CertificationService.auditBlockers(cycle);
    if (blockers.contains(CertificationService.BLOCKER_STAGE1) || blockers.contains(CertificationService.BLOCKER_STAGE2)) {
      throw new ApiException(422, "NOT_READY", "Complete the Stage 1 and Stage 2 audits before the certification decision.", null);
    }
    if (DecisionRules.GRANT.equals(vote) && !blockers.isEmpty()) {
      throw new ApiException(422, "NOT_READY", "Close every major nonconformity before granting certification.", null);
    }
    CertificationDecision round = openRound(cycle);
    boolean opened = round == null;
    if (opened) {
      DecisionRules.Mode mode = DecisionRules.mode(decisionPolicy.value());
      round = new CertificationDecision();
      round.setCycle(cycle);
      round.setMode(mode.mode());
      round.setRequiredVotes(mode.requiredVotes());
      round.setStatus(DecisionRules.ROUND_OPEN);
      round.setPolicyVersion(JPA.find(PolicyVersion.class, decisionPolicy.versionId()));
      round = JPA.save(round);
    } else if (votes(round).stream().anyMatch(v -> v.getVoter().equals(voter))) {
      throw new ApiException(409, DecisionRules.ALREADY_VOTED, "You already voted in this decision.", null);
    }
    CertificationVote row = new CertificationVote();
    row.setDecision(round);
    row.setVoter(voter);
    row.setVote(vote);
    row.setReason(reason);
    row.setCastAt(LocalDateTime.now());
    JPA.save(row);
    List<String> cast = votes(round).stream().map(CertificationVote::getVote).toList();
    String outcome = DecisionRules.tally(round.getRequiredVotes(), cast);
    Notifier notifier = Beans.get(Notifier.class);
    if (outcome == null) {
      if (opened) {
        for (User member : eligible(cycle)) {
          notifier.notify(member, "CERT_VOTE_NEEDED", SUBJECT, cycle.getId(), "Certification decision " + cycle.getReference() + " awaits your vote");
        }
      }
      return round;
    }
    if (DecisionRules.GRANT.equals(outcome) && !CertificationService.auditBlockers(cycle).isEmpty()) {
      throw new ApiException(422, "NOT_READY", "Close every major nonconformity before granting certification.", null);
    }
    round.setStatus(DecisionRules.ROUND_DECIDED);
    round.setOutcome(outcome);
    round.setDecidedAt(LocalDateTime.now());
    round = JPA.save(round);
    if (DecisionRules.GRANT.equals(outcome)) issue(cycle, round, cyclePolicy, today, voter);
    notifier.notify(cycle.getManager(), DecisionRules.GRANT.equals(outcome) ? "CERT_GRANTED" : "CERT_REFUSED", SUBJECT, cycle.getId(),
        "Certification decision taken for " + cycle.getReference());
    return round;
  }

  /** Issues the certificate of a granted cycle: next serial of the scheme and year, validity from cert.cycle. */
  ClientCertificate issue(CertificationCycle cycle, CertificationDecision round, PolicyService.Applied cyclePolicy, LocalDate today, User actor) {
    int validity = cyclePolicy.value().path("validityMonths").asInt(0);
    int surveillance = cyclePolicy.value().path("surveillanceMonths").asInt(0);
    if (validity < 1 || surveillance < 1) {
      throw new ApiException(422, "POLICY_NOT_SET", "The policy 'cert.cycle' does not give a usable validity and surveillance rhythm.", null);
    }
    int year = today.getYear();
    String prefix = DecisionRules.number(scheme(cycle), year, 0);
    prefix = prefix.substring(0, prefix.length() - 4);
    Locks.key("ioeti-cert-number", prefix);
    Integer max = JPA.em().createQuery("SELECT MAX(c.serial) FROM ClientCertificate c WHERE c.issueYear = :year AND c.number LIKE :prefix", Integer.class)
        .setParameter("year", year).setParameter("prefix", prefix + "%").getSingleResult();
    int serial = max == null ? 1 : max + 1;
    while (Query.of(ClientCertificate.class).filter("self.number = :n").bind("n", DecisionRules.number(scheme(cycle), year, serial)).count() > 0) {
      serial++;
    }
    ClientCertificate certificate = new ClientCertificate();
    certificate.setCycle(cycle);
    certificate.setDecision(round);
    certificate.setIssueYear(year);
    certificate.setSerial(serial);
    certificate.setNumber(DecisionRules.number(scheme(cycle), year, serial));
    certificate.setIssuedOn(today);
    certificate.setExpiresOn(DecisionRules.expiry(today, validity));
    certificate.setSurveillanceMonths(surveillance);
    certificate.setStatus(DecisionRules.ACTIVE);
    certificate.setCyclePolicy(JPA.find(PolicyVersion.class, cyclePolicy.versionId()));
    certificate = JPA.save(certificate);
    event(certificate, "ISSUED", null, actor);
    return certificate;
  }

  // --- certificate life ------------------------------------------------------------------------------------------

  /**
   * Suspends, restores or withdraws a certificate under the scheme's decision mode (owner decision 2026-10-29). An
   * independent reviewer changes it at once. In a committee, the request opens a change round with the person's APPROVE
   * vote (or, when that action's round is open, records their APPROVE vote); the change applies once the committee
   * approves it. Another change while a round is open → 409 CHANGE_PENDING. Locks the cycle like a grant vote.
   */
  @Transactional(rollbackOn = {Exception.class})
  public ClientCertificate change(ClientCertificate certificate, String action, String reason, User actor, LocalDate today) {
    CertificationCycle cycle = certificate.getCycle();
    JPA.em().lock(cycle, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    requireDecisionMaker(actor, cycle);
    PolicyService.Applied decisionPolicy = policies.require(DECISION_POLICY, scheme(cycle), today);
    String code = DecisionRules.CHANGE_ACTIONS.get(action);
    if (code == null) throw ApiException.notFound();
    CertificationDecision open = openChange(certificate);
    String step = DecisionRules.changeStep(open == null ? DecisionRules.mode(decisionPolicy.value()).mode() : null,
        open == null ? null : open.getChangeAction(), code);
    // the action must apply to the certificate as it is now (422 CERTIFICATE_STATE / CERTIFICATE_EXPIRED)
    DecisionRules.next(DecisionRules.effectiveStatus(certificate.getStatus(), certificate.getExpiresOn(), today), action);
    if (DecisionRules.CHANGE_APPLY.equals(step)) return apply(certificate, action, reason, actor, today);
    if (DecisionRules.CHANGE_VOTE.equals(step)) return castChangeVote(certificate, open, actor, DecisionRules.APPROVE, reason, today);
    DecisionRules.Mode mode = DecisionRules.mode(decisionPolicy.value());
    CertificationDecision round = new CertificationDecision();
    round.setCycle(cycle);
    round.setCertificate(certificate);
    round.setChangeAction(code);
    round.setRequestedBy(actor);
    round.setRequestReason(reason);
    round.setMode(mode.mode());
    round.setRequiredVotes(mode.requiredVotes());
    round.setStatus(DecisionRules.ROUND_OPEN);
    round.setPolicyVersion(JPA.find(PolicyVersion.class, decisionPolicy.versionId()));
    round = JPA.save(round);
    ClientCertificate result = castChangeVote(certificate, round, actor, DecisionRules.APPROVE, reason, today);
    if (DecisionRules.ROUND_OPEN.equals(round.getStatus())) {
      Notifier notifier = Beans.get(Notifier.class);
      for (User member : eligible(cycle)) {
        if (member.equals(actor)) continue;
        notifier.notify(member, "CERT_CHANGE_VOTE_NEEDED", SUBJECT, cycle.getId(),
            "Certificate change on " + cycle.getReference() + " awaits your vote");
      }
    }
    return result;
  }

  /**
   * A committee member's APPROVE or REJECT vote on the certificate's open change round. 409 NO_CHANGE_PENDING when no
   * round is open, 409 ALREADY_VOTED for a second vote; an APPROVE needs the change to still apply (422). Locks the cycle.
   */
  @Transactional(rollbackOn = {Exception.class})
  public ClientCertificate changeVote(ClientCertificate certificate, String vote, String reason, User voter, LocalDate today) {
    CertificationCycle cycle = certificate.getCycle();
    JPA.em().lock(cycle, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    requireDecisionMaker(voter, cycle);
    policies.require(DECISION_POLICY, scheme(cycle), today);
    CertificationDecision open = openChange(certificate);
    if (open == null) {
      throw new ApiException(409, "NO_CHANGE_PENDING", "No committee vote on a change to this certificate is open.", null);
    }
    return castChangeVote(certificate, open, voter, vote, reason, today);
  }

  private ClientCertificate castChangeVote(ClientCertificate certificate, CertificationDecision round, User voter, String vote, String reason,
      LocalDate today) {
    if (votes(round).stream().anyMatch(v -> v.getVoter().equals(voter))) {
      throw new ApiException(409, DecisionRules.ALREADY_VOTED, "You already voted on this change.", null);
    }
    String action = round.getChangeAction().toLowerCase(Locale.ROOT);
    if (DecisionRules.APPROVE.equals(vote)) {
      DecisionRules.next(DecisionRules.effectiveStatus(certificate.getStatus(), certificate.getExpiresOn(), today), action);
    }
    CertificationVote row = new CertificationVote();
    row.setDecision(round);
    row.setVoter(voter);
    row.setVote(vote);
    row.setReason(reason);
    row.setCastAt(LocalDateTime.now());
    JPA.save(row);
    String outcome = DecisionRules.changeTally(round.getRequiredVotes(), votes(round).stream().map(CertificationVote::getVote).toList());
    if (outcome == null) return certificate;
    if (DecisionRules.APPROVED.equals(outcome)) {
      DecisionRules.next(DecisionRules.effectiveStatus(certificate.getStatus(), certificate.getExpiresOn(), today), action);
    }
    round.setStatus(DecisionRules.ROUND_DECIDED);
    round.setOutcome(outcome);
    round.setDecidedAt(LocalDateTime.now());
    JPA.save(round);
    CertificationCycle cycle = certificate.getCycle();
    if (DecisionRules.APPROVED.equals(outcome)) {
      // the history keeps who asked for the change and why; the round keeps the committee's votes
      return apply(certificate, action, round.getRequestReason(), round.getRequestedBy(), today);
    }
    Beans.get(Notifier.class).notify(cycle.getManager(), "CERT_CHANGE_REJECTED", SUBJECT, cycle.getId(),
        "Certificate change on " + cycle.getReference() + " was rejected by the committee");
    return certificate;
  }

  /** Applies a change: the new status, the event in the certificate's history and the programme manager's notice. */
  private ClientCertificate apply(ClientCertificate certificate, String action, String reason, User actor, LocalDate today) {
    CertificationCycle cycle = certificate.getCycle();
    certificate.setStatus(DecisionRules.next(DecisionRules.effectiveStatus(certificate.getStatus(), certificate.getExpiresOn(), today), action));
    ClientCertificate saved = JPA.save(certificate);
    String kind = DecisionRules.EVENTS.get(action);
    event(saved, kind, reason, actor);
    Beans.get(Notifier.class).notify(cycle.getManager(), "CERT_" + kind, SUBJECT, cycle.getId(),
        "Certificate " + saved.getNumber() + " " + kind.toLowerCase());
    return saved;
  }

  private static void event(ClientCertificate certificate, String action, String reason, User actor) {
    CertificateEvent event = new CertificateEvent();
    event.setCertificate(certificate);
    event.setAction(action);
    event.setReason(reason);
    event.setActor(actor);
    event.setOccurredAt(LocalDateTime.now());
    JPA.save(event);
  }

  /**
   * Surveillance and recertification audits follow an issued certificate that is still in force (active or suspended),
   * under the scheme's cert.cycle policy.
   */
  public ClientCertificate requireCertificateForFollowUp(CertificationCycle cycle, LocalDate today) {
    policies.require(CYCLE_POLICY, scheme(cycle), today);
    ClientCertificate certificate = certificate(cycle);
    String status = certificate == null ? null : DecisionRules.effectiveStatus(certificate.getStatus(), certificate.getExpiresOn(), today);
    if (!DecisionRules.ACTIVE.equals(status) && !DecisionRules.SUSPENDED.equals(status)) {
      throw new ApiException(422, "CERTIFICATE_REQUIRED",
          "Surveillance and recertification audits follow a certificate that is in force (active or suspended).", null);
    }
    return certificate;
  }

  /** Tells the eligible decision makers that a cycle just became ready for its decision (policies set, no certificate). */
  public void announceReady(CertificationCycle cycle, LocalDate today) {
    if (!CertificationService.auditBlockers(cycle).isEmpty() || certificate(cycle) != null || openRound(cycle) != null
        || !missingPolicies(cycle, today).isEmpty()) {
      return;
    }
    Notifier notifier = Beans.get(Notifier.class);
    for (User member : eligible(cycle)) {
      notifier.notify(member, "CERT_DECISION_NEEDED", SUBJECT, cycle.getId(), "Certification cycle " + cycle.getReference() + " is ready for its decision");
    }
  }
}
