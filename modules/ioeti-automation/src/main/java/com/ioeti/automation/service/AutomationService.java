package com.ioeti.automation.service;

import com.axelor.auth.db.User;
import com.axelor.db.JPA;
import com.axelor.inject.Beans;
import com.google.inject.persist.Transactional;
import com.ioeti.automation.db.InboxNotice;
import com.ioeti.automation.db.OutboundMessage;
import com.ioeti.core.notify.Notifier;
import jakarta.persistence.LockModeType;
import java.util.List;

/** Writes of the inbox and the outbox. */
public class AutomationService {

  @Transactional(rollbackOn = {Exception.class})
  public void markRead(List<InboxNotice> notices) {
    for (InboxNotice n : notices) {
      n.setSeen(true);
      JPA.save(n);
    }
  }

  @Transactional(rollbackOn = {Exception.class})
  public void deliver(User recipient, String subject, Long subjectId, String message) {
    Beans.get(Notifier.class).notify(recipient, "MENTION", subject, subjectId, message);
  }

  @Transactional(rollbackOn = {Exception.class})
  public OutboundMessage save(OutboundMessage message) {
    if (message.getId() != null) JPA.em().lock(message, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    return JPA.save(message);
  }
}
