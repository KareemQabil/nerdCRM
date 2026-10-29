package com.ioeti.certification.rest;

import com.axelor.apps.base.db.Partner;
import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.User;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.ioeti.certification.db.CertificateEvent;
import com.ioeti.certification.db.CertificationAudit;
import com.ioeti.certification.db.CertificationCycle;
import com.ioeti.certification.db.CertificationDecision;
import com.ioeti.certification.db.CertificationVote;
import com.ioeti.certification.db.ClientCertificate;
import com.ioeti.certification.db.repo.CertificationAuditRepository;
import com.ioeti.certification.rest.CertificationRestController.AuditorView;
import com.ioeti.certification.rest.CertificationRestController.TimelineEvent;
import com.ioeti.certification.service.CertificationDecisionService;
import com.ioeti.certification.service.CertificationService;
import com.ioeti.certification.service.DecisionRules;
import com.ioeti.core.policy.PolicyService;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * D-02 views of a cycle's decision and certificate. Decision data is part of the cycle: whoever may read the cycle reads
 * it (people's names are PERSONAL, reasons are BUSINESS). While a committee round is open, it shows who voted but not how,
 * so members decide independently; votes and reasons are shown once the round is decided. The same holds for committee
 * rounds on a certificate change (suspend, restore, withdraw; owner decision 2026-10-29); the requester's reason is shown
 * from the start, since it is what the committee votes on.
 */
final class DecisionViews {

  private DecisionViews() {}

  static CertDecisionPanel panel(CertificationCycle cycle) {
    CertificationDecisionService service = Beans.get(CertificationDecisionService.class);
    LocalDate today = CertificationDecisionService.today();
    User me = AuthUtils.getUser();
    List<String> missing = service.missingPolicies(cycle, today);
    Optional<PolicyService.Applied> decisionPolicy = service.decisionPolicy(cycle, today);
    Optional<PolicyService.Applied> cyclePolicy = service.cyclePolicy(cycle, today);
    String mode = null;
    Integer required = null;
    if (decisionPolicy.isPresent()) {
      try {
        DecisionRules.Mode m = DecisionRules.mode(decisionPolicy.get().value());
        mode = m.mode();
        required = m.requiredVotes();
      } catch (RuntimeException unreadable) {
        missing = new ArrayList<>(missing);
        missing.add(0, CertificationDecisionService.DECISION_POLICY);
      }
    }
    CertificationDecision open = CertificationDecisionService.openRound(cycle);
    if (open != null) {
      // an open round keeps the mode it was opened under
      mode = open.getMode();
      required = open.getRequiredVotes();
    }
    ClientCertificate certificate = CertificationDecisionService.certificate(cycle);
    List<String> blockers = CertificationService.decisionBlockers(cycle);
    List<String> audit = CertificationService.auditBlockers(cycle);
    boolean stagesDone = !audit.contains(CertificationService.BLOCKER_STAGE1) && !audit.contains(CertificationService.BLOCKER_STAGE2);
    String reason = CertificationDecisionService.cannotDecide(me, cycle, open);
    boolean canVote = reason == null && missing.isEmpty() && certificate == null && stagesDone;
    boolean canGrant = canVote && audit.isEmpty();

    List<CertificationVote> openVotes = open == null ? List.of() : CertificationDecisionService.votes(open);
    List<User> eligible = CertificationDecisionService.eligible(cycle).stream()
        .filter(u -> openVotes.stream().noneMatch(v -> v.getVoter().equals(u))).toList();
    String nobody = null;
    if (certificate == null) {
      if (CertificationDecisionService.roleHolders().isEmpty()) nobody = "NO_ROLE_HOLDERS";
      else if (CertificationDecisionService.eligible(cycle).isEmpty()) nobody = "ALL_AUDITED_CLIENT";
      else if (required != null && eligible.size() < required - openVotes.size()) nobody = "NOT_ENOUGH_ELIGIBLE";
    }
    List<CertRoundView> past = new ArrayList<>();
    for (CertificationDecision round : CertificationDecisionService.rounds(cycle)) {
      if (open == null || !round.equals(open)) past.add(round(round));
    }
    Integer validity = cyclePolicy.map(p -> p.value().path("validityMonths").asInt()).orElse(null);
    Integer surveillance = cyclePolicy.map(p -> p.value().path("surveillanceMonths").asInt()).orElse(null);
    boolean canManage = certificate != null && !DecisionRules.NO_DECISION_RIGHT.equals(reason) && !DecisionRules.AUDITED_CLIENT.equals(reason)
        && decisionPolicy.isPresent();
    CertChangeRoundView openChange = null;
    List<CertChangeRoundView> pastChanges = new ArrayList<>();
    if (certificate != null) {
      CertificationDecision change = CertificationDecisionService.openChange(certificate);
      String cannotVote = change == null ? null : CertificationDecisionService.cannotDecide(me, cycle, change);
      if (change != null && cannotVote == null && decisionPolicy.isEmpty()) cannotVote = "POLICY_NOT_SET";
      if (change != null) openChange = change(change, cannotVote);
      for (CertificationDecision round : CertificationDecisionService.changeRounds(certificate)) {
        if (change == null || !round.equals(change)) pastChanges.add(change(round, null));
      }
    }
    return new CertDecisionPanel(cycle.getId(), cycle.getVersion(), service.status(cycle, today), missing, mode, required, validity, surveillance,
        blockers, canVote, canGrant, certificate == null ? reason : null, eligible.stream().map(u -> new AuditorView(u.getId(), u.getName())).toList(),
        nobody, open == null ? null : round(open), past, certificate == null ? null : certificate(certificate, today), canManage,
        openChange, pastChanges);
  }

  /**
   * A committee round on a certificate change. While open: who voted (not how), and whether the person reading may vote
   * ({@code cannotVote} null) or why not; once decided: every vote with its reason.
   */
  static CertChangeRoundView change(CertificationDecision round, String cannotVote) {
    boolean decided = DecisionRules.ROUND_DECIDED.equals(round.getStatus());
    List<CertificationVote> votes = CertificationDecisionService.votes(round);
    List<CertVoteView> rows = votes.stream().map(v -> new CertVoteView(v.getVoter().getId(), v.getVoter().getName(),
        decided ? v.getVote() : null, decided ? v.getReason() : null, v.getCastAt())).toList();
    User requester = round.getRequestedBy();
    boolean open = !decided;
    return new CertChangeRoundView(round.getId(), round.getChangeAction(), round.getMode(), round.getRequiredVotes(), round.getStatus(),
        round.getOutcome(), requester == null ? null : requester.getId(), requester == null ? null : requester.getName(), round.getRequestReason(),
        round.getCreatedOn(), round.getDecidedAt(), votes.size(),
        decided ? (int) votes.stream().filter(v -> DecisionRules.APPROVE.equals(v.getVote())).count() : null,
        decided ? (int) votes.stream().filter(v -> DecisionRules.REJECT.equals(v.getVote())).count() : null, rows,
        open && cannotVote == null, open ? cannotVote : null);
  }

  static CertRoundView round(CertificationDecision round) {
    boolean decided = DecisionRules.ROUND_DECIDED.equals(round.getStatus());
    List<CertificationVote> votes = CertificationDecisionService.votes(round);
    List<CertVoteView> rows = votes.stream().map(v -> new CertVoteView(v.getVoter().getId(), v.getVoter().getName(),
        decided ? v.getVote() : null, decided ? v.getReason() : null, v.getCastAt())).toList();
    return new CertRoundView(round.getId(), round.getMode(), round.getRequiredVotes(), round.getStatus(), round.getOutcome(), round.getDecidedAt(),
        votes.size(), decided ? (int) votes.stream().filter(v -> DecisionRules.GRANT.equals(v.getVote())).count() : null,
        decided ? (int) votes.stream().filter(v -> DecisionRules.REFUSE.equals(v.getVote())).count() : null, rows);
  }

  static IsoCertificateView certificate(ClientCertificate c, LocalDate today) {
    List<CertificationAudit> followUps = Query.of(CertificationAudit.class).filter("self.cycle = :cycle AND self.statusSelect = :done AND self.typeSelect = :type")
        .bind("cycle", c.getCycle()).bind("done", CertificationAuditRepository.STATUS_COMPLETED)
        .bind("type", CertificationAuditRepository.TYPE_SURVEILLANCE).fetch(50);
    List<LocalDate> due = DecisionRules.surveillanceDue(c.getIssuedOn(), c.getExpiresOn(), c.getSurveillanceMonths());
    List<CertDueView> schedule = new ArrayList<>();
    for (int i = 0; i < due.size(); i++) schedule.add(new CertDueView(i + 1, due.get(i), i < followUps.size(), due.get(i).isBefore(today) && i >= followUps.size()));
    List<CertEventView> events = CertificationDecisionService.events(c).stream()
        .map(e -> new CertEventView(e.getAction(), e.getReason(), e.getActor().getName(), e.getOccurredAt())).toList();
    return new IsoCertificateView(c.getId(), c.getVersion(), c.getNumber(), c.getCycle().getBusinessLine().getCode(), c.getIssuedOn(), c.getExpiresOn(),
        DecisionRules.effectiveStatus(c.getStatus(), c.getExpiresOn(), today), c.getSurveillanceMonths(), schedule, c.getExpiresOn(), events);
  }

  /** The decision rounds, votes and certificate events in the cycle's audit history. */
  static void timeline(CertificationCycle cycle, List<TimelineEvent> events) {
    for (CertificationDecision round : CertificationDecisionService.rounds(cycle)) {
      for (CertificationVote vote : CertificationDecisionService.votes(round)) {
        events.add(new TimelineEvent(vote.getCastAt(), "DECISION_VOTE", null, vote.getVoter().getName()));
      }
      if (round.getDecidedAt() != null) events.add(new TimelineEvent(round.getDecidedAt(), "DECISION_" + round.getOutcome(), null, null));
    }
    ClientCertificate certificate = CertificationDecisionService.certificate(cycle);
    if (certificate != null) {
      for (CertificateEvent e : CertificationDecisionService.events(certificate)) {
        events.add(new TimelineEvent(e.getOccurredAt(), "CERTIFICATE_" + e.getAction(), certificate.getNumber(), e.getActor().getName()));
      }
      // committee votes on certificate changes; an approved change shows as the certificate event above
      for (CertificationDecision round : CertificationDecisionService.changeRounds(certificate)) {
        for (CertificationVote vote : CertificationDecisionService.votes(round)) {
          events.add(new TimelineEvent(vote.getCastAt(), "CERTIFICATE_CHANGE_VOTE", certificate.getNumber(), vote.getVoter().getName()));
        }
        if (DecisionRules.REJECTED.equals(round.getOutcome())) {
          events.add(new TimelineEvent(round.getDecidedAt(), "CERTIFICATE_CHANGE_REJECTED", certificate.getNumber(), null));
        }
      }
    }
  }

  /** What the public certificate check shows, and nothing more. A client that is a person is not named. */
  static CertCheckView publicView(ClientCertificate c, LocalDate today) {
    Partner client = c.getCycle().getClient();
    boolean company = client.getPartnerTypeSelect() != null && client.getPartnerTypeSelect() == 1;
    return new CertCheckView(c.getNumber(), c.getCycle().getBusinessLine().getCode(), company ? client.getName() : null,
        DecisionRules.effectiveStatus(c.getStatus(), c.getExpiresOn(), today), c.getExpiresOn());
  }

  public record CertDecisionCommand(Integer version, String vote, String reason) {}
  public record CertActionCommand(Integer version, String reason) {}
  public record CertChangeVoteCommand(Integer version, String vote, String reason) {}
  public record CertDecisionPanel(
      Long cycleId, Integer cycleVersion, String status, List<String> missingPolicies, String mode, Integer requiredVotes,
      Integer validityMonths, Integer surveillanceMonths, List<String> blockers, boolean canVote, boolean canGrant,
      String cannotDecideReason, List<AuditorView> eligibleDeciders, String nobodyReason, CertRoundView openRound,
      List<CertRoundView> pastRounds, IsoCertificateView certificate, boolean canManageCertificate, CertChangeRoundView openChange,
      List<CertChangeRoundView> pastChanges) {}
  public record CertRoundView(
      Long id, String mode, Integer requiredVotes, String status, String outcome, LocalDateTime decidedAt, int votesCast,
      Integer grantVotes, Integer refuseVotes, List<CertVoteView> votes) {}
  public record CertChangeRoundView(
      Long id, String action, String mode, Integer requiredVotes, String status, String outcome, Long requestedById, String requestedByName,
      String reason, LocalDateTime openedAt, LocalDateTime decidedAt, int votesCast, Integer approveVotes, Integer rejectVotes,
      List<CertVoteView> votes, boolean canVote, String cannotVoteReason) {}
  public record CertVoteView(Long voterId, String voterName, String vote, String reason, LocalDateTime castAt) {}
  public record IsoCertificateView(
      Long id, Integer version, String number, String standardCode, LocalDate issuedOn, LocalDate expiresOn, String status,
      Integer surveillanceMonths, List<CertDueView> surveillance, LocalDate recertificationDueBy, List<CertEventView> events) {}
  public record CertDueView(int index, LocalDate dueOn, boolean done, boolean overdue) {}
  public record CertEventView(String action, String reason, String actorName, LocalDateTime at) {}
  public record CertCheckView(String number, String standardCode, String clientName, String status, LocalDate expiresOn) {}
}
