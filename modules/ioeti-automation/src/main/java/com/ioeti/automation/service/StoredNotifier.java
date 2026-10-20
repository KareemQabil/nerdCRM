package com.ioeti.automation.service;

import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.User;
import com.axelor.db.JPA;
import com.ioeti.automation.db.InboxNotice;
import com.ioeti.core.notify.Notifier;
import java.time.LocalDateTime;

/**
 * Stores notices in the recipient's inbox, inside the caller's transaction (so a rolled-back
 * workflow step leaves no notice behind). A notice to oneself, to nobody or to a blocked user is
 * dropped.
 */
public class StoredNotifier implements Notifier {

  static final int MAX_TITLE = 300;

  @Override
  public void notify(User recipient, String kind, String subject, Long subjectId, String title) {
    User actor = AuthUtils.getUser();
    if (recipient == null || Boolean.TRUE.equals(recipient.getBlocked()) || recipient.equals(actor)) return;
    InboxNotice notice = new InboxNotice();
    notice.setRecipient(recipient);
    notice.setActor(actor);
    notice.setKind(kind);
    notice.setSubject(subject);
    notice.setSubjectId(subjectId);
    notice.setTitle(title == null ? kind : title.length() > MAX_TITLE ? title.substring(0, MAX_TITLE) : title);
    notice.setSeen(false);
    notice.setCreatedAt(LocalDateTime.now());
    JPA.save(notice);
  }
}
