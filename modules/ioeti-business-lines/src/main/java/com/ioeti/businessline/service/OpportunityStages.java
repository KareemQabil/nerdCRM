package com.ioeti.businessline.service;

import com.axelor.apps.base.AxelorException;
import com.axelor.apps.base.db.Currency;
import com.axelor.apps.crm.db.LostReason;
import com.axelor.apps.crm.db.Opportunity;
import com.axelor.apps.crm.db.OpportunityStatus;
import com.axelor.apps.crm.db.repo.OpportunityRepository;
import com.axelor.apps.crm.service.app.AppCrmService;
import com.axelor.inject.Beans;
import com.google.inject.Inject;
import com.google.inject.persist.Transactional;
import com.ioeti.core.api.ApiException;
import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * Opportunity stages on the native pipeline (journeys plan, phase 2).
 *
 * <ul>
 *   <li>The kinds come from the CRM configuration: its closed-won stage is WON, its closed-lost stage is
 *       LOST, every other stage is OPEN.
 *   <li>Moving between open stages is free, like the native kanban. Losing needs its own command with a
 *       reason. Winning needs the evidence the business line sets (D-11, {@link WonEvidence}): an active
 *       contract, or an accepted quotation with uploaded evidence; without the line's setting it fails closed.
 *   <li>A lost opportunity is reopened at the configured default stage.
 *   <li>Planning figures (amount, currency, expected close date, probability) are the salesperson's own
 *       estimate; they are never shown as revenue.
 * </ul>
 */
public class OpportunityStages {

  private final AppCrmService appCrm;

  @Inject
  public OpportunityStages(AppCrmService appCrm) {
    this.appCrm = appCrm;
  }

  public String kind(OpportunityStatus status) {
    if (status == null) return "OPEN";
    try {
      if (status.equals(appCrm.getClosedWinOpportunityStatus())) return "WON";
      if (status.equals(appCrm.getClosedLostOpportunityStatus())) return "LOST";
    } catch (AxelorException e) {
      // a CRM app without closed stages configured: every stage is open
    }
    return "OPEN";
  }

  @Transactional(rollbackOn = {Exception.class})
  public Opportunity move(Opportunity opportunity, OpportunityStatus target) {
    String from = kind(opportunity.getOpportunityStatus());
    String to = kind(target);
    if ("WON".equals(to)) {
      if (!"OPEN".equals(from)) throw new ApiException(422, "STAGE_CLOSED", "Reopen the opportunity before moving it.", null);
      Beans.get(WonEvidence.class).check(opportunity);
      opportunity.setOpportunityStatus(target);
      return Beans.get(OpportunityRepository.class).save(opportunity);
    }
    if ("LOST".equals(to)) {
      throw new ApiException(422, "USE_LOSE", "Mark the opportunity lost with a reason instead.", null);
    }
    if (!"OPEN".equals(from)) {
      throw new ApiException(422, "STAGE_CLOSED", "Reopen the opportunity before moving it.", null);
    }
    opportunity.setOpportunityStatus(target);
    return Beans.get(OpportunityRepository.class).save(opportunity);
  }

  @Transactional(rollbackOn = {Exception.class})
  public Opportunity lose(Opportunity opportunity, LostReason reason, String note) throws AxelorException {
    if (!"OPEN".equals(kind(opportunity.getOpportunityStatus()))) {
      throw new ApiException(422, "STAGE_CLOSED", "Only an open opportunity can be marked lost.", null);
    }
    opportunity.setOpportunityStatus(appCrm.getClosedLostOpportunityStatus());
    opportunity.setLostReason(reason);
    opportunity.setLostReasonStr(note);
    return Beans.get(OpportunityRepository.class).save(opportunity);
  }

  @Transactional(rollbackOn = {Exception.class})
  public Opportunity reopen(Opportunity opportunity) throws AxelorException {
    if (!"LOST".equals(kind(opportunity.getOpportunityStatus()))) {
      throw new ApiException(422, "NOT_LOST", "Only a lost opportunity can be reopened.", null);
    }
    opportunity.setOpportunityStatus(appCrm.getOpportunityDefaultStatus());
    opportunity.setLostReason(null);
    opportunity.setLostReasonStr(null);
    return Beans.get(OpportunityRepository.class).save(opportunity);
  }

  @Transactional(rollbackOn = {Exception.class})
  public Opportunity plan(Opportunity opportunity, BigDecimal amount, Currency currency, LocalDate expectedClose, BigDecimal probability,
      boolean amountGiven, boolean currencyGiven, boolean closeGiven, boolean probabilityGiven) {
    if (amountGiven) opportunity.setAmount(amount == null ? BigDecimal.ZERO : amount);
    if (currencyGiven) opportunity.setCurrency(currency);
    if (closeGiven) opportunity.setExpectedCloseDate(expectedClose);
    if (probabilityGiven) opportunity.setProbability(probability == null ? BigDecimal.ZERO : probability);
    return Beans.get(OpportunityRepository.class).save(opportunity);
  }
}
