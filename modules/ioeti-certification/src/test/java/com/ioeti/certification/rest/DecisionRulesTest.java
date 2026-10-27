package com.ioeti.certification.rest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.axelor.auth.db.Group;
import com.axelor.auth.db.Role;
import com.axelor.auth.db.User;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ioeti.certification.db.CertificationCycle;
import com.ioeti.certification.db.ClientCertificate;
import com.ioeti.certification.service.CertificationDecisionService;
import com.ioeti.certification.service.CertificationService;
import com.ioeti.certification.service.DecisionRules;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.policy.PolicyService;
import java.time.LocalDate;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** D-02 rules without a database: who may decide, the committee tally, certificate dates, numbers and states. */
class DecisionRulesTest {

  private static final ObjectMapper JSON = new ObjectMapper();

  private static JsonNode json(String value) throws Exception {
    return JSON.readTree(value.replace('\'', '"'));
  }

  private static Role role(String name) {
    Role role = new Role(name);
    return role;
  }

  @Test
  void modeComesFromThePolicyAndFailsClosedOtherwise() throws Exception {
    assertEquals(new DecisionRules.Mode("INDEPENDENT_REVIEWER", 1), DecisionRules.mode(json("{'mode':'INDEPENDENT_REVIEWER'}")));
    assertEquals(new DecisionRules.Mode("COMMITTEE", 3), DecisionRules.mode(json("{'mode':'COMMITTEE','committeeSize':3}")));
    for (String bad : new String[] {"{}", "{'mode':'COMMITTEE'}", "{'mode':'COMMITTEE','committeeSize':1}", "{'mode':'VOTE'}"}) {
      assertEquals("POLICY_NOT_SET", assertThrows(ApiException.class, () -> DecisionRules.mode(json(bad)), bad).code());
    }
    assertEquals("POLICY_NOT_SET", assertThrows(ApiException.class, () -> DecisionRules.mode(null)).code());
  }

  @Test
  void committeeTallyWaitsForEveryVoteThenMajorityWinsAndATieRefuses() {
    assertNull(DecisionRules.tally(3, List.of("GRANT", "GRANT")), "two of three votes: still open");
    assertEquals("GRANT", DecisionRules.tally(3, List.of("GRANT", "REFUSE", "GRANT")));
    assertEquals("REFUSE", DecisionRules.tally(3, List.of("REFUSE", "GRANT", "REFUSE")));
    assertEquals("REFUSE", DecisionRules.tally(2, List.of("GRANT", "REFUSE")), "tie refuses");
    assertEquals("REFUSE", DecisionRules.tally(4, List.of("GRANT", "GRANT", "REFUSE", "REFUSE")), "tie refuses");
    assertEquals("GRANT", DecisionRules.tally(4, List.of("GRANT", "GRANT", "GRANT", "REFUSE")));
    // an independent reviewer is a round of one vote
    assertEquals("GRANT", DecisionRules.tally(1, List.of("GRANT")));
    assertEquals("REFUSE", DecisionRules.tally(1, List.of("REFUSE")));
    assertNull(DecisionRules.tally(1, List.of()));
  }

  @Test
  void eligibilityNeedsTheRoleAndNoAuditOfTheClient() {
    assertEquals("NO_DECISION_RIGHT", DecisionRules.cannotDecide(false, false, false));
    assertEquals("NO_DECISION_RIGHT", DecisionRules.cannotDecide(false, true, false));
    assertEquals("AUDITED_CLIENT", DecisionRules.cannotDecide(true, true, false), "impartiality is always enforced");
    assertEquals("ALREADY_VOTED", DecisionRules.cannotDecide(true, false, true));
    assertNull(DecisionRules.cannotDecide(true, false, false));
  }

  @Test
  void theDecisionRoleIsHeldDirectlyOrThroughTheGroupByAnActivePerson() {
    User direct = new User();
    direct.setBlocked(false); // a new User is blocked by default
    direct.setRoles(new HashSet<>(Set.of(role(DecisionRules.DECISION_ROLE))));
    assertTrue(DecisionRules.holdsDecisionRole(direct));
    User viaGroup = new User();
    viaGroup.setBlocked(false);
    Group group = new Group();
    group.setRoles(new HashSet<>(Set.of(role(DecisionRules.DECISION_ROLE))));
    viaGroup.setGroup(group);
    assertTrue(DecisionRules.holdsDecisionRole(viaGroup));
    User other = new User();
    other.setBlocked(false);
    other.setRoles(new HashSet<>(Set.of(role("ioeti-gm"))));
    assertFalse(DecisionRules.holdsDecisionRole(other));
    direct.setBlocked(true);
    assertFalse(DecisionRules.holdsDecisionRole(direct), "a blocked person decides nothing");
    assertFalse(DecisionRules.holdsDecisionRole(null));
  }

  @Test
  void validityAndSurveillanceDatesComeFromTheSchemePolicy() {
    LocalDate issued = LocalDate.of(2026, 10, 27);
    assertEquals(LocalDate.of(2029, 10, 27), DecisionRules.expiry(issued, 36));
    assertEquals(LocalDate.of(2027, 2, 28), DecisionRules.expiry(LocalDate.of(2026, 8, 31), 6), "end of a shorter month");
    assertThrows(IllegalArgumentException.class, () -> DecisionRules.expiry(issued, 0));
    LocalDate expires = DecisionRules.expiry(issued, 36);
    assertEquals(List.of(LocalDate.of(2027, 10, 27), LocalDate.of(2028, 10, 27)), DecisionRules.surveillanceDue(issued, expires, 12),
        "surveillance strictly before expiry (the third year ends with recertification)");
    assertEquals(5, DecisionRules.surveillanceDue(issued, expires, 6).size());
    assertEquals(List.of(), DecisionRules.surveillanceDue(issued, expires, 0));
  }

  @Test
  void numbersArePerSchemeAndYearAndTheCheckTakesOnlyAnExactShape() {
    assertEquals("ISO9001-2026-0001", DecisionRules.number("ISO9001", 2026, 1));
    assertEquals("ISO22000-2027-0123", DecisionRules.number(" iso 22000 ", 2027, 123));
    assertEquals("ISO9001-2026-12345", DecisionRules.number("ISO9001", 2026, 12345));
    assertEquals("ISO9001-2026-0001", DecisionRules.normaliseNumber(" iso9001-2026-0001 "));
    assertNull(DecisionRules.normaliseNumber("%"));
    assertNull(DecisionRules.normaliseNumber("ISO9001%"));
    assertNull(DecisionRules.normaliseNumber("a"));
    assertNull(DecisionRules.normaliseNumber(null));
    assertNull(DecisionRules.normaliseNumber("x".repeat(61)));
  }

  @Test
  void certificateStatesSuspendRestoreWithdrawAndExpire() {
    LocalDate expires = LocalDate.of(2029, 10, 27);
    assertEquals("ACTIVE", DecisionRules.effectiveStatus("ACTIVE", expires, expires), "valid through its expiry day");
    assertEquals("EXPIRED", DecisionRules.effectiveStatus("ACTIVE", expires, expires.plusDays(1)));
    assertEquals("EXPIRED", DecisionRules.effectiveStatus("SUSPENDED", expires, expires.plusDays(1)));
    assertEquals("WITHDRAWN", DecisionRules.effectiveStatus("WITHDRAWN", expires, expires.plusDays(1)));
    assertEquals("SUSPENDED", DecisionRules.next("ACTIVE", "suspend"));
    assertEquals("ACTIVE", DecisionRules.next("SUSPENDED", "restore"));
    assertEquals("WITHDRAWN", DecisionRules.next("ACTIVE", "withdraw"));
    assertEquals("WITHDRAWN", DecisionRules.next("SUSPENDED", "withdraw"));
    assertEquals("CERTIFICATE_STATE", assertThrows(ApiException.class, () -> DecisionRules.next("ACTIVE", "restore")).code());
    assertEquals("CERTIFICATE_STATE", assertThrows(ApiException.class, () -> DecisionRules.next("SUSPENDED", "suspend")).code());
    assertEquals("CERTIFICATE_STATE", assertThrows(ApiException.class, () -> DecisionRules.next("WITHDRAWN", "restore")).code(),
        "withdrawal is final");
    assertEquals("CERTIFICATE_STATE", assertThrows(ApiException.class, () -> DecisionRules.next("WITHDRAWN", "withdraw")).code());
    assertEquals("CERTIFICATE_EXPIRED", assertThrows(ApiException.class, () -> DecisionRules.next("EXPIRED", "suspend")).code());
    assertEquals(404, assertThrows(ApiException.class, () -> DecisionRules.next("ACTIVE", "reissue")).status());
  }

  @Test
  void publicCheckOnlyWhileTheChannelIsOn() throws Exception {
    LocalDate today = LocalDate.of(2026, 10, 27);
    assertFalse(CertificateCheckController.channelOn(policy(null), today), "never set");
    assertFalse(CertificateCheckController.channelOn(policy("{'channels':[]}"), today));
    assertFalse(CertificateCheckController.channelOn(policy("{'channels':['LEAD_FORMS','EMAIL']}"), today));
    assertTrue(CertificateCheckController.channelOn(policy("{'channels':['LEAD_FORMS','CERTIFICATE_CHECK']}"), today));
  }

  @Test
  void publicCheckIsRateLimitedPerAddress() {
    CertificateCheckController.resetForTests();
    long now = 1_000_000;
    for (int i = 0; i < 3; i++) assertEquals(0, CertificateCheckController.admit("10.0.0.1", 3, now + i));
    long retry = CertificateCheckController.admit("10.0.0.1", 3, now + 10);
    assertTrue(retry > 0 && retry <= CertificateCheckController.WINDOW_MILLIS, String.valueOf(retry));
    assertEquals(0, CertificateCheckController.admit("10.0.0.2", 3, now + 10), "another address is counted on its own");
    assertEquals(0, CertificateCheckController.admit("10.0.0.1", 3, now + CertificateCheckController.WINDOW_MILLIS + 1), "after the window");
    CertificateCheckController.resetForTests();
  }

  @Test
  void phaseAndDecisionStatusFollowTheCertificateThePoliciesAndTheAudits() {
    ClientCertificate certificate = new ClientCertificate();
    List<String> none = List.of();
    assertEquals("CERTIFIED", CertificationService.phase(certificate, none));
    assertEquals("STAGE1_PENDING", CertificationService.phase(null, List.of("STAGE1_NOT_COMPLETED", "STAGE2_NOT_COMPLETED")));
    assertEquals("FINDINGS_OPEN", CertificationService.phase(null, List.of("OPEN_MAJOR_NONCONFORMITIES")));
    assertEquals("READY_FOR_DECISION", CertificationService.phase(null, none));
    CertificationCycle cycle = new CertificationCycle();
    assertEquals("GRANTED", CertificationDecisionService.status(cycle, certificate, List.of("cert.decision"), List.of("STAGE1_NOT_COMPLETED")));
    assertEquals("BLOCKED_BY_POLICY", CertificationDecisionService.status(cycle, null, List.of("cert.cycle"), none),
        "fail closed comes before readiness");
    assertEquals("NOT_READY", CertificationDecisionService.status(cycle, null, none, List.of("STAGE2_NOT_COMPLETED")));
  }

  private static PolicyService policy(String value) throws Exception {
    JsonNode node = value == null ? null : json(value);
    return new PolicyService() {
      @Override
      public Optional<Applied> current(String key, String scope, LocalDate on) {
        assertEquals("channels.enabled", key);
        return node == null ? Optional.empty() : Optional.of(new Applied(1L, key, null, node, on));
      }
    };
  }
}
