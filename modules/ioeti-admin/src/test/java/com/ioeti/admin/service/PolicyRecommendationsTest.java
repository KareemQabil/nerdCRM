package com.ioeti.admin.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.ioeti.admin.service.PolicyRecommendations.Recommendation;
import com.ioeti.core.policy.PolicyCatalog;
import com.ioeti.core.policy.PolicyDefinition;
import com.ioeti.core.policy.PolicyValidator;
import java.time.LocalDate;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** R1: every recommended value is one the policy owners could have typed in themselves (the live apply is in policy_probe.py). */
class PolicyRecommendationsTest {

  static final LocalDate TODAY = LocalDate.of(2026, 10, 27);

  @Test
  void everyRecommendedValuePassesItsPolicysOwnChecks() {
    for (Recommendation r : PolicyRecommendations.fixed(TODAY)) {
      PolicyDefinition d = PolicyCatalog.get(r.key());
      assertEquals(r.scope(), PolicyValidator.scope(d, r.scope()), r.id());
      PolicyValidator.value(d, r.value());
      assertFalse(r.whyAr().isBlank() || r.whyEn().isBlank(), r.id());
    }
  }

  @Test
  void everyPolicyThatDoesNotNeedTheCompanysOwnRecordsHasARecommendation() {
    Set<String> covered = new HashSet<>();
    PolicyRecommendations.fixed(TODAY).forEach(r -> covered.add(r.key()));
    // per business line: the evidence for each line, and routing to each line's responsible team, come from the database
    Set<String> perLine = Set.of("sales.won-evidence", "leads.routing");
    for (PolicyDefinition d : PolicyCatalog.all()) {
      if (!perLine.contains(d.key())) assertTrue(covered.contains(d.key()), d.key());
    }
    // a retention period for every kind of personal data
    assertEquals(Set.copyOf(PolicyCatalog.DATA_TYPES), Set.copyOf(PolicyRecommendations.fixed(TODAY).stream()
        .filter(r -> r.key().equals("privacy.retention")).map(Recommendation::scope).toList()));
  }

  @Test
  void recommendationIdsAreUnique() {
    List<Recommendation> all = PolicyRecommendations.fixed(TODAY);
    assertEquals(all.size(), all.stream().map(Recommendation::id).distinct().count());
  }

  @Test
  void theFixedPublicHolidaysAreTheComingYearsOnly() {
    assertEquals(List.of("2027-01-07", "2027-01-25", "2027-04-25", "2027-05-01", "2027-06-30", "2027-07-23", "2027-10-06"),
        PolicyRecommendations.fixedHolidays(TODAY));
    assertEquals(List.of("2026-01-25", "2026-04-25", "2026-05-01", "2026-06-30", "2026-07-23", "2026-10-06", "2027-01-07"),
        PolicyRecommendations.fixedHolidays(LocalDate.of(2026, 1, 8)));
  }

  @Test
  void theTaxRecommendationIsEgyptsStandardVatRate() {
    Recommendation tax = PolicyRecommendations.fixed(TODAY).stream().filter(r -> r.key().equals("finance.tax")).findFirst().orElseThrow();
    assertEquals(14, tax.value().get("ratePercent").asInt());
    assertEquals(PolicyRecommendations.Basis.FACT, tax.basis());
  }
}
