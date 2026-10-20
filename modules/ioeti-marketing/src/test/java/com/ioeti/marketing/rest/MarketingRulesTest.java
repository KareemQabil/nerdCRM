package com.ioeti.marketing.rest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.axelor.apps.crm.db.Lead;
import com.axelor.apps.crm.db.repo.EventRepository;
import com.axelor.message.db.EmailAddress;
import com.ioeti.core.api.ApiException;
import com.ioeti.marketing.db.repo.LeadSearchKeyListener;
import org.junit.jupiter.api.Test;

class MarketingRulesTest {

  @Test
  void contactFormatsAreCheckedBeforeSaving() {
    assertTrue(MarketingRestController.EMAIL.matcher("sara@example.test").matches());
    assertFalse(MarketingRestController.EMAIL.matcher("sara@example").matches());
    assertFalse(MarketingRestController.EMAIL.matcher("a b@example.test").matches());
    assertTrue(MarketingRestController.PHONE.matcher("+20 100 123 4567").matches());
    assertTrue(MarketingRestController.PHONE.matcher("٠١٠٠١٢٣٤٥٦٧").matches());
    assertFalse(MarketingRestController.PHONE.matcher("call me").matches());
  }

  @Test
  void channelsMethodsAndFollowUpTypesUseStableNames() {
    assertEquals(2, MarketingRestController.select("channel", "CALL", MarketingRestController.CHANNELS));
    assertEquals("WEB_FORM", MarketingRestController.name(3, MarketingRestController.METHODS));
    assertNull(MarketingRestController.name(9, MarketingRestController.METHODS));
    assertEquals("MEETING", MarketingRestController.followUpType(EventRepository.TYPE_MEETING));
    assertEquals("OTHER", MarketingRestController.followUpType(null));
    assertEquals("DONE", MarketingRestController.status(EventRepository.STATUS_REALIZED));
  }

  @Test
  void unknownValuesAndLongTextAreFieldErrors() {
    assertEquals("channel", assertThrows(ApiException.class,
        () -> MarketingRestController.select("channel", "SMS", MarketingRestController.CHANNELS)).fieldErrors().get(0).field());
    assertEquals("TOO_LONG", assertThrows(ApiException.class,
        () -> MarketingRestController.text("name", "x".repeat(81), 80, true)).fieldErrors().get(0).code());
    assertNull(MarketingRestController.text("name", "   ", 80, false));
  }

  @Test
  void theSearchKeyMakesArabicSpellingVariantsMeet() {
    Lead first = new Lead();
    first.setFirstName("أحمد");
    first.setName("عبد الله");
    first.setEnterpriseName("مؤسسة الهدى");
    first.setMobilePhone("+20 100 123 4567");
    EmailAddress email = new EmailAddress();
    email.setAddress("Ahmed@Example.TEST");
    first.setEmailAddress(email);
    Lead second = new Lead();
    second.setFirstName("احمد");
    second.setName("عبد اللّه");
    second.setEnterpriseName("موسسه الهدي");
    second.setMobilePhone("٠١٠٠١٢٣٤٥٦٧");
    String a = LeadSearchKeyListener.key(first);
    String b = LeadSearchKeyListener.key(second);
    assertEquals("احمد | عبد الله | موسسه الهدي | ahmed@example.test | 001234567", a);
    assertEquals("احمد | عبد الله | موسسه الهدي | 001234567", b);
  }
}
