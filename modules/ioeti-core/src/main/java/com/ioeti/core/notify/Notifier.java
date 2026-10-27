package com.ioeti.core.notify;

import com.axelor.auth.db.User;

/**
 * In-app notices to IOETI users about records they work on. Never outbound: nothing here sends an
 * e-mail, SMS or chat message (D-10), and nothing escalates on a timer (D-12).
 *
 * <p>Workflow modules call it inside their own transaction. Without {@code ioeti-automation} the
 * default implementation does nothing; with it, the notice is stored in the recipient's inbox.
 */
public interface Notifier {

  /**
   * @param recipient who should see the notice (ignored when null, blocked or the actor)
   * @param kind a stable code such as {@code REVIEW_CHANGES_REQUESTED}
   * @param subject the record type the notice links to, such as {@code QUOTE} or {@code HANDOVER}
   * @param subjectId the record id; the recipient's own permissions still apply when it is opened
   * @param title a short, non-sensitive text
   */
  void notify(User recipient, String kind, String subject, Long subjectId, String title);
}
