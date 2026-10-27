package com.ioeti.businessline.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.axelor.auth.db.User;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** D-12: the routing rules' own logic (the live routing is proven by scripts/lead_routing_probe.py). */
class LeadRouterRulesTest {

  static final LocalDate TODAY = LocalDate.of(2026, 10, 27);

  private static List<JsonNode> rules(String json) throws Exception {
    List<JsonNode> out = new ArrayList<>();
    new ObjectMapper().readTree(json).forEach(out::add);
    return out;
  }

  private static User user(long id) {
    User u = new User();
    u.setId(id);
    return u;
  }

  @Test
  void theFirstMatchingRuleWinsAndAnEmptyConditionMatchesAnything() throws Exception {
    List<JsonNode> r = rules("[{\"governorate\":\"CAIRO\",\"sourceId\":7,\"teamId\":1},{\"governorate\":\"CAIRO\",\"teamId\":2},{\"teamId\":3}]");
    assertEquals(0, LeadRouter.match(r, "CAIRO", 7L));
    assertEquals(1, LeadRouter.match(r, "CAIRO", 8L));
    assertEquals(1, LeadRouter.match(r, "CAIRO", null));
    assertEquals(2, LeadRouter.match(r, "GIZA", 7L));
    assertEquals(2, LeadRouter.match(r, null, null));
  }

  @Test
  void withoutACatchAllRuleALeadCanMatchNothing() throws Exception {
    List<JsonNode> r = rules("[{\"governorate\":\"ALEXANDRIA\",\"teamId\":1},{\"sourceId\":4,\"teamId\":2}]");
    assertNull(LeadRouter.match(r, "CAIRO", 5L));
    assertNull(LeadRouter.match(r, null, null));
    assertEquals(1, LeadRouter.match(r, "CAIRO", 4L));
  }

  @Test
  void roundRobinGivesTheLeadToWhoeverReceivedOneLeastRecentlyAndNewcomersFirst() {
    User a = user(10), b = user(11), c = user(12);
    LocalDateTime t = LocalDateTime.of(2026, 10, 27, 9, 0);
    assertEquals(b, LeadRouter.pick(List.of(a, b, c), Map.of(10L, t, 12L, t.minusHours(1))));
    assertEquals(c, LeadRouter.pick(List.of(a, b, c), Map.of(10L, t, 11L, t.plusMinutes(5), 12L, t.minusHours(1))));
    // nobody has received one yet: the lowest id, so the order is stable
    assertEquals(a, LeadRouter.pick(List.of(c, a, b), Map.of()));
    assertNull(LeadRouter.pick(List.of(), Map.of()));
  }

  @Test
  void awayIsInclusiveAndAnOpenEndRunsOn() {
    assertFalse(LeadRouter.away(null, null, TODAY));
    assertTrue(LeadRouter.away(TODAY, TODAY, TODAY));
    assertTrue(LeadRouter.away(TODAY.minusDays(3), TODAY.plusDays(3), TODAY));
    assertFalse(LeadRouter.away(TODAY.plusDays(1), TODAY.plusDays(3), TODAY));
    assertFalse(LeadRouter.away(TODAY.minusDays(5), TODAY.minusDays(1), TODAY));
    assertTrue(LeadRouter.away(TODAY.minusDays(1), null, TODAY));
    assertTrue(LeadRouter.away(null, TODAY.plusDays(1), TODAY));
    assertFalse(LeadRouter.away(null, TODAY.minusDays(1), TODAY));
  }
}
