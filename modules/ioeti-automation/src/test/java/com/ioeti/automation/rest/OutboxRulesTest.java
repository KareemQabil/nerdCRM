package com.ioeti.automation.rest;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.axelor.apps.crm.db.Lead;
import com.axelor.message.db.EmailAddress;
import com.ioeti.automation.db.repo.OutboundMessageRepository;
import com.ioeti.core.api.ApiException;
import org.junit.jupiter.api.Test;

class OutboxRulesTest {

  static Lead lead(String email, boolean optedOut) {
    Lead lead = new Lead();
    if (email != null) {
      EmailAddress address = new EmailAddress();
      address.setAddress(email);
      lead.setEmailAddress(address);
    }
    lead.setIsDoNotSendEmail(optedOut);
    return lead;
  }

  @Test
  void anOptOutBlocksEvenADraft() {
    assertEquals("OPTED_OUT", assertThrows(ApiException.class,
        () -> AutomationRestController.checkReachable(lead("a@example.test", true), OutboundMessageRepository.CHANNEL_EMAIL)).code());
  }

  @Test
  void aLeadWithoutAnAddressCannotBeWritten() {
    assertEquals("NO_ADDRESS", assertThrows(ApiException.class,
        () -> AutomationRestController.checkReachable(lead(null, false), OutboundMessageRepository.CHANNEL_EMAIL)).code());
    assertEquals("NO_ADDRESS", assertThrows(ApiException.class,
        () -> AutomationRestController.checkReachable(lead("  ", false), OutboundMessageRepository.CHANNEL_EMAIL)).code());
  }

  @Test
  void aReachableLeadPassesTheCheck() {
    assertDoesNotThrow(() -> AutomationRestController.checkReachable(lead("a@example.test", false), OutboundMessageRepository.CHANNEL_EMAIL));
  }

  @Test
  void onlyEmailIsAChannel() {
    assertEquals("channel", assertThrows(ApiException.class,
        () -> AutomationRestController.select("channel", "WHATSAPP", AutomationRestController.CHANNELS)).fieldErrors().get(0).field());
  }
}
