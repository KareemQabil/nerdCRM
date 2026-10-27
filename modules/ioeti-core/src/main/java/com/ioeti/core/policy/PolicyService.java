package com.ioeti.core.policy;

import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.Role;
import com.axelor.auth.db.User;
import com.axelor.db.JPA;
import com.axelor.db.Query;
import com.fasterxml.jackson.databind.JsonNode;
import com.google.inject.persist.Transactional;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.db.PolicyVersion;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Business-rule policies (owner decisions, 2026-10-25): every rule is a value set by a policy owner,
 * effective from a date, and kept as an append-only history. Workflows ask for the version in force and
 * are refused while none is set ({@code 422 POLICY_NOT_SET}); a record may keep the version id it was
 * decided under. Only holders of the policy-owner role change policies; technical administrators do not,
 * unless they hold it too.
 */
public class PolicyService {

  /** The role that may change policies and appoint other policy owners. */
  public static final String OWNER_ROLE = "ioeti-policy-owner";

  /** The version in force: its id, value and dates. */
  public record Applied(Long versionId, String key, String scope, JsonNode value, LocalDate effectiveFrom) {}

  /** The version in force for a key and scope on a date; a scoped policy falls back to its default where allowed. */
  public Optional<Applied> current(String key, String scope, LocalDate on) {
    PolicyDefinition definition = PolicyCatalog.get(key);
    String stored = scope == null || scope.isBlank() ? null : scope.strip();
    Optional<Applied> scoped = latest(key, stored, on);
    if (scoped.isPresent() || stored == null || !definition.allowsDefault()) return scoped;
    // a scoped value that was explicitly retired does not fall back to the default
    PolicyVersion last = version(key, stored, on);
    return last != null && Boolean.TRUE.equals(last.getRetired()) ? Optional.empty() : latest(key, null, on);
  }

  /** The version in force, or 422 POLICY_NOT_SET naming the policy the owners still have to set. */
  public Applied require(String key, String scope, LocalDate on) {
    return current(key, scope, on).orElseThrow(() -> new ApiException(422, "POLICY_NOT_SET",
        "The policy '" + key + "'" + (scope == null ? "" : " for " + scope) + " is not set; a policy owner sets it under Policies.", null));
  }

  private Optional<Applied> latest(String key, String scope, LocalDate on) {
    PolicyVersion v = version(key, scope, on);
    if (v == null || Boolean.TRUE.equals(v.getRetired())) return Optional.empty();
    return Optional.of(new Applied(v.getId(), key, v.getScopeKey(), PolicyValidator.read(v.getValueJson()), v.getEffectiveFrom()));
  }

  private static PolicyVersion version(String key, String scope, LocalDate on) {
    Query<PolicyVersion> q = scope == null
        ? Query.of(PolicyVersion.class).filter("self.policyKey = ?1 AND self.scopeKey IS NULL AND self.effectiveFrom <= ?2", key, on)
        : Query.of(PolicyVersion.class).filter("self.policyKey = ?1 AND self.scopeKey = ?2 AND self.effectiveFrom <= ?3", key, scope, on);
    return q.order("-effectiveFrom").order("-id").fetchOne();
  }

  /** Every version of a key (all scopes when scope is null), newest first. */
  public List<PolicyVersion> history(String key) {
    PolicyCatalog.get(key);
    return Query.of(PolicyVersion.class).filter("self.policyKey = ?1", key).order("-effectiveFrom").order("-id").fetch(500);
  }

  /** Sets a value from a date (today or later); checked against the definition. Policy owners only. */
  @Transactional(rollbackOn = {Exception.class})
  public PolicyVersion set(String key, String rawScope, JsonNode rawValue, LocalDate effectiveFrom, String reason, LocalDate today) {
    PolicyDefinition definition = PolicyCatalog.get(key);
    User me = requireOwner();
    String scope = PolicyValidator.scope(definition, rawScope);
    String value = PolicyValidator.write(PolicyValidator.value(definition, rawValue));
    return append(key, scope, value, false, effective(effectiveFrom, today), reason(reason), me);
  }

  /** Unsets a policy from a date: from then on, workflows that need it are refused again. Policy owners only. */
  @Transactional(rollbackOn = {Exception.class})
  public PolicyVersion retire(String key, String rawScope, LocalDate effectiveFrom, String reason, LocalDate today) {
    PolicyDefinition definition = PolicyCatalog.get(key);
    User me = requireOwner();
    String scope = PolicyValidator.scope(definition, rawScope);
    LocalDate from = effective(effectiveFrom, today);
    if (latest(key, scope, from).isEmpty()) throw new ApiException(422, "POLICY_NOT_SET", "This policy is not set on that date.", null);
    return append(key, scope, null, true, from, reason(reason), me);
  }

  private static PolicyVersion append(String key, String scope, String value, boolean retired, LocalDate from, String reason, User me) {
    PolicyVersion v = new PolicyVersion();
    v.setPolicyKey(key);
    v.setScopeKey(scope);
    v.setValueJson(value);
    v.setRetired(retired);
    v.setEffectiveFrom(from);
    v.setReason(reason);
    v.setAuthor(me);
    v.setCreatedAt(LocalDateTime.now());
    return JPA.save(v);
  }

  /** A change applies from today or later; the past is never rewritten. */
  private static LocalDate effective(LocalDate from, LocalDate today) {
    LocalDate date = from == null ? today : from;
    if (date.isBefore(today)) throw ApiException.invalidField("effectiveFrom", "PAST", "A policy change cannot take effect in the past.");
    return date;
  }

  private static String reason(String raw) {
    String text = raw == null ? "" : raw.strip();
    if (text.isEmpty()) throw ApiException.invalidField("reason", "REQUIRED", "Say why the policy changes.");
    if (text.length() > 500) throw ApiException.invalidField("reason", "TOO_LONG", "At most 500 characters.");
    return text;
  }

  // --- policy owners -----------------------------------------------------------------------------------------

  public static boolean isOwner(User user) {
    if (user == null || Boolean.TRUE.equals(user.getBlocked())) return false;
    if (user.getRoles() != null && user.getRoles().stream().anyMatch(r -> OWNER_ROLE.equals(r.getName()))) return true;
    return user.getGroup() != null && user.getGroup().getRoles() != null
        && user.getGroup().getRoles().stream().anyMatch(r -> OWNER_ROLE.equals(r.getName()));
  }

  private static User requireOwner() {
    User me = AuthUtils.getUser();
    if (!isOwner(me)) throw ApiException.forbidden();
    return me;
  }

  public static List<User> owners() {
    return Query.of(User.class).filter("(self.blocked IS NULL OR self.blocked = false) AND EXISTS (SELECT r FROM Role r WHERE r.name = ?1 AND r MEMBER OF self.roles)",
        OWNER_ROLE).order("name").fetch(200);
  }

  /**
   * Appoints a policy owner. An existing owner may appoint others; while there is none, an administrator
   * may appoint the first one (bootstrap). Returns whether anything changed.
   */
  @Transactional(rollbackOn = {Exception.class})
  public boolean appoint(User user) {
    User me = AuthUtils.getUser();
    boolean bootstrap = owners().isEmpty() && me != null && AuthUtils.isAdmin(me);
    if (!isOwner(me) && !bootstrap) throw ApiException.forbidden();
    if (user == null || Boolean.TRUE.equals(user.getBlocked())) throw ApiException.invalidField("userId", "UNAVAILABLE", "Choose an active person.");
    Role role = Query.of(Role.class).filter("self.name = ?1", OWNER_ROLE).fetchOne();
    if (role == null) {
      role = new Role(OWNER_ROLE);
      role.setDescription("IOETI policy owner: may change business-rule policies (owner decisions, 2026-10-25)");
      role = JPA.save(role);
    }
    if (user.getRoles() != null && user.getRoles().contains(role)) return false;
    user.addRole(role);
    JPA.save(user);
    return true;
  }

  /** Removes a policy owner (owners only); the last owner cannot be removed, so policies never become unchangeable. */
  @Transactional(rollbackOn = {Exception.class})
  public boolean dismiss(User user) {
    requireOwner();
    Role role = Query.of(Role.class).filter("self.name = ?1", OWNER_ROLE).fetchOne();
    if (role == null || user == null || user.getRoles() == null || !user.getRoles().contains(role)) return false;
    if (owners().size() <= 1) throw new ApiException(409, "LAST_OWNER", "At least one policy owner must remain.", null);
    user.removeRole(role);
    JPA.save(user);
    return true;
  }

  /** How many scopes of each key have a value in force today (for the overview). */
  public static Map<String, Long> setCounts(LocalDate today) {
    Map<String, Long> counts = new java.util.HashMap<>();
    for (PolicyDefinition d : PolicyCatalog.all()) {
      List<String> scopes = JPA.em().createQuery("SELECT DISTINCT v.scopeKey FROM PolicyVersion v WHERE v.policyKey = ?1", String.class)
          .setParameter(1, d.key()).getResultList();
      long n = 0;
      for (String scope : scopes) {
        PolicyVersion v = version(d.key(), scope, today);
        if (v != null && !Boolean.TRUE.equals(v.getRetired())) n++;
      }
      counts.put(d.key(), n);
    }
    return counts;
  }
}
