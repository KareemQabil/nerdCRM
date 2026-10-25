package com.ioeti.core.policy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ioeti.core.api.ApiException;
import org.junit.jupiter.api.Test;

/** The shape checks every policy value goes through (owner decisions, 2026-10-25). */
class PolicyValidatorTest {

  private static final ObjectMapper JSON = new ObjectMapper();

  private static JsonNode json(String text) throws Exception {
    return JSON.readTree(text.replace('\'', '"'));
  }

  private static String code(String key, String value) {
    ApiException e = assertThrows(ApiException.class, () -> PolicyValidator.value(PolicyCatalog.get(key), json(value)));
    return e.fieldErrors().get(0).field() + ":" + e.fieldErrors().get(0).code();
  }

  @Test
  void nothingIsShippedAndEveryPolicyNamesItsDecision() {
    assertTrue(PolicyCatalog.all().size() >= 15);
    PolicyCatalog.all().forEach(d -> {
      assertTrue(d.decision().matches("D-\\d\\d"), d.key());
      assertTrue(!d.titleAr().isBlank() && !d.titleEn().isBlank(), d.key());
    });
    assertEquals(404, assertThrows(ApiException.class, () -> PolicyCatalog.get("finance.tax-rate-made-up")).status());
  }

  @Test
  void percentagesAndWholeNumbersAreChecked() throws Exception {
    assertEquals("{\"ratePercent\":14,\"name\":\"VAT\"}", PolicyValidator.write(PolicyValidator.value(PolicyCatalog.get("finance.tax"), json("{'ratePercent':'14.00','name':' VAT '}"))));
    assertEquals("value.ratePercent:RANGE", code("finance.tax", "{'ratePercent':101,'name':'x'}"));
    assertEquals("value.ratePercent:FORMAT", code("finance.tax", "{'ratePercent':'abc','name':'x'}"));
    assertEquals("value.name:REQUIRED", code("finance.tax", "{'ratePercent':14}"));
    assertEquals("value.days:FORMAT", code("sales.quote-validity", "{'days':2.5}"));
    assertEquals("value.days:RANGE", code("sales.quote-validity", "{'days':0}"));
  }

  @Test
  void approvalTiersGoFromTheSmallestDiscountUp() throws Exception {
    String ok = "{'tiers':[{'maxDiscountPercent':5,'approver':'NONE'},{'maxDiscountPercent':15,'approver':'SALES_MANAGER'},{'maxDiscountPercent':30,'approver':'GM'}]}";
    assertEquals(3, PolicyValidator.value(PolicyCatalog.get("sales.quote-approval"), json(ok)).get("tiers").size());
    assertEquals("value.tiers:ORDER", code("sales.quote-approval", "{'tiers':[{'maxDiscountPercent':15,'approver':'NONE'},{'maxDiscountPercent':5,'approver':'GM'}]}"));
    assertEquals("value.tiers[0].approver:UNAVAILABLE", code("sales.quote-approval", "{'tiers':[{'maxDiscountPercent':5,'approver':'CEO'}]}"));
  }

  @Test
  void rulesBetweenFieldsAreChecked() {
    assertEquals("value.committeeSize:REQUIRED", code("cert.decision", "{'mode':'COMMITTEE'}"));
    assertEquals("value.end:BEFORE_START", code("work.calendar", "{'days':['SUN','MON'],'start':'17:00','end':'09:00'}"));
    assertEquals("value.refundPercent:REQUIRED", code("recruitment.agreement",
        "{'feePercent':15,'invoiceOn':'START_DATE','guaranteeDays':90,'replacement':'PARTIAL_REFUND'}"));
    assertEquals("value.currencies:FORMAT", code("finance.fx", "{'source':'PUBLIC_API','currencies':'usd','maxAgeHours':24}"));
  }

  @Test
  void holidaysAreSortedAndDeduplicatedAndChoicesAreRestricted() throws Exception {
    JsonNode v = PolicyValidator.value(PolicyCatalog.get("work.calendar"),
        json("{'days':['SUN','SUN','MON'],'start':'09:00','end':'17:00','holidays':['2026-12-25','2026-10-06','2026-10-06']}"));
    assertEquals("[\"SUN\",\"MON\"]", v.get("days").toString());
    assertEquals("[\"2026-10-06\",\"2026-12-25\"]", v.get("holidays").toString());
    assertEquals("value.days:UNAVAILABLE", code("work.calendar", "{'days':['SOMEDAY'],'start':'09:00','end':'17:00'}"));
  }

  @Test
  void scopesFollowTheDefinition() {
    assertNull(PolicyValidator.scope(PolicyCatalog.get("work.calendar"), " "));
    assertEquals("scope:UNAVAILABLE", scopeCode("work.calendar", "ISO9001"));
    assertNull(PolicyValidator.scope(PolicyCatalog.get("finance.tax"), null)); // a default value is allowed
    assertEquals("scope:REQUIRED", scopeCode("sales.won-evidence", null)); // every line chooses its own evidence
    assertEquals("ISO9001", PolicyValidator.scope(PolicyCatalog.get("sales.won-evidence"), " ISO9001 "));
    assertEquals("scope:UNAVAILABLE", scopeCode("training.certificate", "course-7"));
    assertEquals("12", PolicyValidator.scope(PolicyCatalog.get("training.certificate"), "12"));
    assertEquals("scope:UNAVAILABLE", scopeCode("privacy.retention", "EVERYTHING"));
  }

  private static String scopeCode(String key, String scope) {
    ApiException e = assertThrows(ApiException.class, () -> PolicyValidator.scope(PolicyCatalog.get(key), scope));
    return e.fieldErrors().get(0).field() + ":" + e.fieldErrors().get(0).code();
  }
}
