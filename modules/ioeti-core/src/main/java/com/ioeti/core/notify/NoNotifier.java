package com.ioeti.core.notify;

import com.axelor.auth.db.User;

/** Default {@link Notifier} when no inbox module is installed. */
public class NoNotifier implements Notifier {

  @Override
  public void notify(User recipient, String kind, String subject, Long subjectId, String title) {}
}
