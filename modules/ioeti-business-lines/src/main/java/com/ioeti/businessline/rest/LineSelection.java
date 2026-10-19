package com.ioeti.businessline.rest;

import com.axelor.auth.AuthUtils;
import com.axelor.db.JpaSecurity;
import com.axelor.inject.Beans;
import com.ioeti.businessline.db.BusinessLine;
import com.ioeti.businessline.db.repo.BusinessLineRepository;
import com.ioeti.businessline.security.BusinessLineEligibility;
import com.ioeti.core.api.ApiException;
import java.util.Locale;

/** The business line a command may start work in; one rule for every command (SEC-002/003). */
final class LineSelection {

  private LineSelection() {}

  /** Unknown, unreadable, inactive and non-eligible lines are rejected identically (no oracle). */
  static BusinessLine eligible(String rawCode) {
    if (rawCode == null || rawCode.isBlank()) {
      throw ApiException.invalidField("businessLineCode", "REQUIRED", "Business line is required.");
    }
    String code = rawCode.trim().toUpperCase(Locale.ROOT);
    BusinessLine line =
        Beans.get(BusinessLineRepository.class)
            .all()
            .filter("self.code = :code")
            .bind("code", code)
            .fetchOne();
    if (line == null
        || !Beans.get(JpaSecurity.class)
            .isPermitted(JpaSecurity.CAN_READ, BusinessLine.class, line.getId())
        || !Integer.valueOf(BusinessLineRepository.STATUS_ACTIVE).equals(line.getStatusSelect())
        || !BusinessLineEligibility.canCreateIn(AuthUtils.getUser(), line)) {
      throw ApiException.invalidField(
          "businessLineCode", "UNAVAILABLE", "Choose an active business line you can access.");
    }
    return line;
  }
}
