package com.ioeti.admin.service;

import com.axelor.auth.db.User;
import com.axelor.inject.Beans;
import com.fasterxml.jackson.databind.JsonNode;
import com.google.inject.persist.Transactional;
import com.ioeti.core.db.PolicyVersion;
import com.ioeti.core.policy.PolicyService;
import java.time.LocalDate;
import java.util.List;

/**
 * Policy changes and policy-owner appointments from the admin console, each written to the admin change
 * log in the same transaction (owner decisions, 2026-10-25).
 */
public class PolicyAdmin {

  private static PolicyService policies() {
    return Beans.get(PolicyService.class);
  }

  private static AdminService audit() {
    return Beans.get(AdminService.class);
  }

  @Transactional(rollbackOn = {Exception.class})
  public PolicyVersion set(String key, String scope, JsonNode value, LocalDate from, String reason, LocalDate today) {
    PolicyVersion v = policies().set(key, scope, value, from, reason, today);
    audit().audit("POLICY_SET", "POLICY", v.getId(), label(v),
        List.of("from=" + v.getEffectiveFrom(), "value=" + v.getValueJson(), "reason=" + v.getReason()));
    return v;
  }

  @Transactional(rollbackOn = {Exception.class})
  public PolicyVersion retire(String key, String scope, LocalDate from, String reason, LocalDate today) {
    PolicyVersion v = policies().retire(key, scope, from, reason, today);
    audit().audit("POLICY_RETIRED", "POLICY", v.getId(), label(v), List.of("from=" + v.getEffectiveFrom(), "reason=" + v.getReason()));
    return v;
  }

  @Transactional(rollbackOn = {Exception.class})
  public boolean appoint(User user) {
    boolean changed = policies().appoint(user);
    if (changed) audit().audit("POLICY_OWNER_APPOINTED", "USER", user.getId(), user.getCode(), List.of("role=" + PolicyService.OWNER_ROLE));
    return changed;
  }

  @Transactional(rollbackOn = {Exception.class})
  public boolean dismiss(User user) {
    boolean changed = policies().dismiss(user);
    if (changed) audit().audit("POLICY_OWNER_DISMISSED", "USER", user.getId(), user.getCode(), List.of("role=" + PolicyService.OWNER_ROLE));
    return changed;
  }

  private static String label(PolicyVersion v) {
    return v.getPolicyKey() + (v.getScopeKey() == null ? "" : " · " + v.getScopeKey());
  }
}
