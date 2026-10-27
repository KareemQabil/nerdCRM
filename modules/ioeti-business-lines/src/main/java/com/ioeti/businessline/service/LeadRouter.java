package com.ioeti.businessline.service;

import com.axelor.apps.crm.db.Lead;
import com.axelor.apps.crm.db.repo.LeadRepository;
import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.User;
import com.axelor.db.JPA;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.axelor.team.db.Team;
import com.fasterxml.jackson.databind.JsonNode;
import com.google.inject.Inject;
import com.ioeti.businessline.db.BusinessLine;
import com.ioeti.businessline.db.LeadRouting;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.db.PolicyVersion;
import com.ioeti.core.notify.Notifier;
import com.ioeti.core.policy.PolicyService;
import com.ioeti.core.policy.PolicyService.Applied;
import jakarta.persistence.LockModeType;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * D-12 (signed 2026-10-25): leads are routed by rules (business line, governorate, source → team), then round-robin inside
 * the team, skipping people on leave or at their workload cap. <b>A lead that already has an owner is never reassigned.</b>
 *
 * <ul>
 *   <li>The rules and the cap are the line's {@code leads.routing} policy; without it nothing is routed
 *       ({@code 422 POLICY_NOT_SET} when asked).
 *   <li>The first rule whose governorate and source match (an empty one matches anything) names the team.
 *   <li>Who can receive it: the team's members who are active, belong to the lead's business line (SEC-003), are not away
 *       today, and have fewer open leads than the cap. Among them, whoever received a lead from this team least recently
 *       (never first; then by id). Two routings to one team at once are serialized on the team.
 *   <li>Every routing is logged ({@link LeadRouting}) with the rule, the team and the policy version. The person who
 *       receives the lead gets an in-app notice; when nobody can, the lead stays unassigned and the line's manager is told.
 * </ul>
 * Callers own the transaction.
 */
public class LeadRouter {

  public static final String KEY = "leads.routing";
  public static final String ASSIGNED = "ASSIGNED";
  public static final String NO_RULE = "NO_RULE";
  public static final String NO_ONE_AVAILABLE = "NO_ONE_AVAILABLE";

  /** One routing's result. */
  public record Routed(String outcome, Integer ruleIndex, Team team, User assignee) {}

  private final PolicyService policies;
  private final LeadLifecycleService lifecycle;

  @Inject
  public LeadRouter(PolicyService policies, LeadLifecycleService lifecycle) {
    this.policies = policies;
    this.lifecycle = lifecycle;
  }

  /** The line's routing rules in force today, if the owners set them. */
  public Optional<Applied> rules(BusinessLine line, LocalDate today) {
    return line == null ? Optional.empty() : policies.current(KEY, line.getCode(), today);
  }

  /** Routes an unassigned lead; refused when it has an owner, has no line, or the line has no rules. */
  public Routed route(Lead lead, LocalDate today) {
    if (lead.getUser() != null) {
      throw new ApiException(409, "ALREADY_ASSIGNED", "This lead already has an owner; leads are never reassigned automatically.", null);
    }
    if (lead.getIoetiBusinessLine() == null) throw new ApiException(422, "BUSINESS_LINE_REQUIRED", "Set the lead's business line first.", null);
    Applied applied = policies.require(KEY, lead.getIoetiBusinessLine().getCode(), today);
    return apply(lead, applied, today);
  }

  /** Applies the rules in force to an unassigned lead and records the result. */
  public Routed apply(Lead lead, Applied applied, LocalDate today) {
    JsonNode value = applied.value();
    List<JsonNode> rules = new ArrayList<>();
    value.path("rules").forEach(rules::add);
    Integer index = match(rules, lead.getIoetiGovernorate(), lead.getSource() == null ? null : lead.getSource().getId());
    Routed routed;
    if (index == null) {
      routed = new Routed(NO_RULE, null, null, null);
    } else {
      Team team = JPA.find(Team.class, rules.get(index).path("teamId").asLong());
      // serialize routings to one team, so two leads at once go to two people
      JPA.em().lock(team, LockModeType.PESSIMISTIC_WRITE);
      User next = next(team, lead.getIoetiBusinessLine(), value.path("workloadCap").asInt(), today);
      routed = new Routed(next == null ? NO_ONE_AVAILABLE : ASSIGNED, index, team, next);
    }
    if (routed.assignee() != null) {
      lead.setUser(routed.assignee());
      lead.setTeam(routed.team());
      Beans.get(LeadRepository.class).save(lead);
    }
    log(lead, routed, applied);
    notifyOutcome(lead, routed);
    return routed;
  }

  /** The first rule whose governorate and source match; an empty one matches anything. */
  static Integer match(List<JsonNode> rules, String governorate, Long sourceId) {
    for (int i = 0; i < rules.size(); i++) {
      JsonNode rule = rules.get(i);
      String g = rule.path("governorate").asText("");
      if (!g.isEmpty() && !g.equals(governorate)) continue;
      if (rule.hasNonNull("sourceId") && (sourceId == null || rule.path("sourceId").asLong() != sourceId)) continue;
      return i;
    }
    return null;
  }

  /** Whoever received a lead from this team least recently, among those who can take one now. */
  User next(Team team, BusinessLine line, int cap, LocalDate today) {
    List<User> eligible = members(team).stream().filter(u -> available(u, line, today)).filter(u -> openLeads(u) < cap).toList();
    if (eligible.isEmpty()) return null;
    Map<Long, LocalDateTime> last = new HashMap<>();
    for (Object[] row : JPA.em().createQuery(
            "SELECT r.assignee.id, MAX(r.routedAt) FROM LeadRouting r WHERE r.team = ?1 AND r.assignee IS NOT NULL GROUP BY r.assignee.id", Object[].class)
        .setParameter(1, team).getResultList()) {
      last.put((Long) row[0], (LocalDateTime) row[1]);
    }
    return pick(eligible, last);
  }

  /** Never received first, then the least recent; ties by id (stable). */
  static User pick(List<User> eligible, Map<Long, LocalDateTime> last) {
    return eligible.stream().min(Comparator.<User, LocalDateTime>comparing(u -> last.get(u.getId()), Comparator.nullsFirst(Comparator.naturalOrder()))
        .thenComparing(User::getId)).orElse(null);
  }

  /** The team's members, from either side of the membership (the team's list or the person's teams). */
  static List<User> members(Team team) {
    Set<User> all = new LinkedHashSet<>(team.getMembers() == null ? Set.of() : team.getMembers());
    all.addAll(Query.of(User.class).filter("?1 MEMBER OF self.teamSet", team).fetch(500));
    return all.stream().sorted(Comparator.comparing(User::getId)).toList();
  }

  /** Active, a member of the lead's line, and not away today. */
  static boolean available(User u, BusinessLine line, LocalDate today) {
    if (Boolean.TRUE.equals(u.getBlocked()) || Boolean.TRUE.equals(u.getArchived())) return false;
    if (u.getIoetiBusinessLines() == null || !u.getIoetiBusinessLines().contains(line)) return false;
    return !away(u.getIoetiAwayFrom(), u.getIoetiAwayUntil(), today);
  }

  /** Away on a day within [from, until]; an open end (only one date) means from that day on, or until that day. */
  static boolean away(LocalDate from, LocalDate until, LocalDate today) {
    if (from == null && until == null) return false;
    return (from == null || !today.isBefore(from)) && (until == null || !today.isAfter(until));
  }

  long openLeads(User u) {
    long open = 0;
    for (Lead l : Query.of(Lead.class).filter("self.user = ?1 AND (self.isConverted IS NULL OR self.isConverted = false)", u).fetch(5000)) {
      try {
        if (!lifecycle.isLost(l)) open++;
      } catch (com.axelor.apps.base.AxelorException e) {
        open++;
      }
    }
    return open;
  }

  private static void log(Lead lead, Routed routed, Applied applied) {
    LeadRouting r = new LeadRouting();
    r.setLead(lead);
    r.setOutcome(routed.outcome());
    r.setRuleIndex(routed.ruleIndex());
    r.setTeam(routed.team());
    r.setAssignee(routed.assignee());
    r.setPolicyVersion(JPA.find(PolicyVersion.class, applied.versionId()));
    r.setRoutedBy(AuthUtils.getUser());
    r.setRoutedAt(LocalDateTime.now());
    JPA.save(r);
  }

  private static void notifyOutcome(Lead lead, Routed routed) {
    BusinessLine line = lead.getIoetiBusinessLine();
    String title = "Lead " + lead.getId() + " (" + line.getCode() + ")";
    if (routed.assignee() != null) {
      Beans.get(Notifier.class).notify(routed.assignee(), "LEAD_ROUTED", "LEAD", lead.getId(), title);
    } else if (line.getManager() != null) {
      Beans.get(Notifier.class).notify(line.getManager(), "LEAD_UNROUTED", "LEAD", lead.getId(), title);
    }
  }
}
