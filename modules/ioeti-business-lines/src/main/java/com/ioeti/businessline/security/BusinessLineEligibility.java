package com.ioeti.businessline.security;

import com.axelor.app.AppSettings;
import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.User;
import com.ioeti.businessline.db.BusinessLine;
import java.util.Locale;
import java.util.Set;

/**
 * SEC-003: may a user start work (an opportunity) in a business line?
 *
 * <p>Reading a line is not the same as being allowed to sell in it (review on PR #6). Until IOETI
 * signs the role policy (D-07), the rule fails closed: administrators, or members of the line
 * ({@code User.ioetiBusinessLines}). {@code ioeti.security.opportunity.create.scope=readable}
 * relaxes it to "any line the user can read" for an isolated development setup; any other value
 * keeps membership.
 */
public final class BusinessLineEligibility {

  static final String SCOPE_KEY = "ioeti.security.opportunity.create.scope";

  private BusinessLineEligibility() {}

  public static boolean canCreateIn(User user, BusinessLine line) {
    if (user == null || line == null) {
      return false;
    }
    if (AuthUtils.isAdmin(user) || "readable".equals(scope())) {
      return true;
    }
    Set<BusinessLine> lines = user.getIoetiBusinessLines();
    return lines != null && lines.stream().anyMatch(l -> l.getId().equals(line.getId()));
  }

  static String scope() {
    return AppSettings.get().get(SCOPE_KEY, "membership").trim().toLowerCase(Locale.ROOT);
  }
}
