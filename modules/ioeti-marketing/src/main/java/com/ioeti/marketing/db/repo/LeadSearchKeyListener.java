package com.ioeti.marketing.db.repo;

import com.axelor.apps.crm.db.Lead;
import com.ioeti.core.text.ArabicNormalizer;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/** Keeps {@code Lead.ioetiSearchKey} in step with the lead's names, e-mail and phones. */
public class LeadSearchKeyListener {

  @PrePersist
  @PreUpdate
  public void refresh(Lead lead) {
    lead.setIoetiSearchKey(key(lead));
  }

  public static String key(Lead lead) {
    String email = lead.getEmailAddress() == null ? null : lead.getEmailAddress().getAddress();
    String key = Stream.of(
            ArabicNormalizer.normalize(lead.getFirstName()),
            ArabicNormalizer.normalize(lead.getName()),
            ArabicNormalizer.normalize(lead.getEnterpriseName()),
            ArabicNormalizer.emailKey(email),
            ArabicNormalizer.phoneKey(lead.getMobilePhone()),
            ArabicNormalizer.phoneKey(lead.getFixedPhone()))
        .filter(s -> !s.isEmpty())
        .collect(Collectors.joining(" | "));
    return key.length() > 1000 ? key.substring(0, 1000) : key;
  }
}
