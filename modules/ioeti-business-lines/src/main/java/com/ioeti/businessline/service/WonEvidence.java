package com.ioeti.businessline.service;

import com.axelor.apps.crm.db.Opportunity;

/**
 * D-11 (signed 2026-10-25): an opportunity is won only on evidence of a binding commitment, which each business line sets
 * ({@code sales.won-evidence}: an active contract, or an accepted quotation with uploaded evidence). The evidence lives in
 * the commercial module, so this module asks through this interface; without that module nothing can be won.
 */
public interface WonEvidence {

  /** Throws a client-facing refusal when the opportunity may not be marked won. */
  void check(Opportunity opportunity);

  /** Fail closed: without a module that can see contracts and quotations, nothing is won. */
  class Unavailable implements WonEvidence {
    @Override
    public void check(Opportunity opportunity) {
      throw com.ioeti.core.api.ApiException.policyBlocked("D-11");
    }
  }
}
