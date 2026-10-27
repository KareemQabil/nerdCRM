package com.ioeti.commercial.service;

import com.axelor.apps.base.service.app.AppBaseService;
import com.axelor.apps.contract.db.Contract;
import com.axelor.apps.contract.db.repo.ContractRepository;
import com.axelor.apps.crm.db.Opportunity;
import com.axelor.apps.sale.db.SaleOrder;
import com.axelor.db.Query;
import com.google.inject.Inject;
import com.ioeti.businessline.service.WonEvidence;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.policy.PolicyService;

/**
 * D-11: an opportunity is won on the evidence its business line sets in {@code sales.won-evidence} (no default: a line
 * without the setting cannot mark won). {@code ACTIVE_CONTRACT}: a contract of the opportunity was activated on signature
 * evidence. {@code ACCEPTED_QUOTE}: a quotation of the opportunity was accepted by the client with uploaded evidence.
 */
public class PolicyWonEvidence implements WonEvidence {

  public static final String KEY = "sales.won-evidence";

  private final PolicyService policies;
  private final AppBaseService appBaseService;

  @Inject
  public PolicyWonEvidence(PolicyService policies, AppBaseService appBaseService) {
    this.policies = policies;
    this.appBaseService = appBaseService;
  }

  @Override
  public void check(Opportunity opportunity) {
    if (opportunity.getIoetiBusinessLine() == null) {
      throw new ApiException(422, "BUSINESS_LINE_REQUIRED", "Set the opportunity's business line first.", null);
    }
    String line = opportunity.getIoetiBusinessLine().getCode();
    String evidence = policies.require(KEY, line, appBaseService.getTodayDate(opportunity.getCompany())).value().path("evidence").asText();
    boolean found = switch (evidence) {
      case "ACTIVE_CONTRACT" -> Query.of(Contract.class).filter("self.opportunity = ?1 AND self.statusSelect = ?2 AND self.ioetiSignatureDocument IS NOT NULL",
          opportunity, ContractRepository.ACTIVE_CONTRACT).count() > 0;
      case "ACCEPTED_QUOTE" -> Query.of(SaleOrder.class).filter("self.opportunity = ?1 AND self.ioetiAcceptedOn IS NOT NULL AND self.ioetiAcceptanceDocument IS NOT NULL",
          opportunity).count() > 0;
      default -> false;
    };
    if (!found) {
      throw new ApiException(422, "WON_EVIDENCE_MISSING", "ACTIVE_CONTRACT".equals(evidence)
          ? "This business line marks a deal won once its contract is activated on signature evidence."
          : "This business line marks a deal won once the client's acceptance of a quotation is recorded with its evidence.", null);
    }
  }
}
