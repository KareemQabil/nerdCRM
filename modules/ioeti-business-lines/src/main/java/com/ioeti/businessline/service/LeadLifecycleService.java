package com.ioeti.businessline.service;

import com.axelor.apps.base.AxelorException;
import com.axelor.apps.crm.db.Lead;
import com.axelor.apps.crm.db.LeadStatus;
import com.axelor.apps.crm.db.LostReason;
import com.axelor.apps.crm.db.repo.LeadRepository;
import com.axelor.apps.crm.service.LeadService;
import com.axelor.apps.crm.service.app.AppCrmService;
import com.google.inject.Inject;
import com.google.inject.persist.Transactional;
import com.ioeti.core.api.ApiException;

/**
 * Lead qualification commands on the native AOS 9.1.10 {@code LeadService}: stage moves, lose,
 * reopen and assign-to-me.
 *
 * <p>Every rule is the native one:
 * <ul>
 *   <li>{@code kanbanLeadOnMove}: no move to converted or lost, none out of converted;
 *   <li>{@code loseLead}: not twice;
 *   <li>{@code resetLead}: back to the default status, lost reason cleared;
 *   <li>{@code assignToMeLead}: not on a lost lead.
 * </ul>
 *
 * <p>IOETI adds only:
 * <ul>
 *   <li>reopen applies to a lost lead only ({@code NOT_LOST});
 *   <li>every command runs in one transaction that commits on return, so the caller's version check
 *       and the lead's versioned UPDATE turn concurrent changes into 409.
 * </ul>
 */
public class LeadLifecycleService {

  private final LeadService leadService;
  private final LeadRepository leadRepository;
  private final AppCrmService appCrmService;

  @Inject
  public LeadLifecycleService(LeadService leadService, LeadRepository leadRepository, AppCrmService appCrmService) {
    this.leadService = leadService;
    this.leadRepository = leadRepository;
    this.appCrmService = appCrmService;
  }

  @Transactional(rollbackOn = {Exception.class})
  public Lead moveTo(Lead lead, LeadStatus target) throws AxelorException {
    // kanbanLeadOnMove compares the requested status with the stored one (leadRepo.find). Pass an
    // unmanaged stand-in carrying the target, so the managed lead still holds the stored status.
    // A lead without a stored status (imported data) has no native rule to apply.
    if (lead.getLeadStatus() != null) {
      Lead requested = new Lead();
      requested.setId(lead.getId());
      requested.setLeadStatus(target);
      leadService.kanbanLeadOnMove(requested);
    }
    lead.setLeadStatus(target);
    return leadRepository.save(lead);
  }

  @Transactional(rollbackOn = {Exception.class})
  public Lead lose(Lead lead, LostReason reason, String note) throws AxelorException {
    leadService.loseLead(lead, reason, note);
    return leadRepository.save(lead);
  }

  @Transactional(rollbackOn = {Exception.class})
  public Lead reopen(Lead lead) throws AxelorException {
    if (!isLost(lead)) {
      throw new ApiException(422, "NOT_LOST", "Only a lost lead can be reopened.", null);
    }
    leadService.resetLead(lead);
    return leadRepository.save(lead);
  }

  @Transactional(rollbackOn = {Exception.class})
  public Lead assignToMe(Lead lead) throws AxelorException {
    leadService.assignToMeLead(lead);
    return lead;
  }

  public boolean isLost(Lead lead) throws AxelorException {
    return leadService.computeIsLost(lead);
  }

  /** Open stages: neither converted nor lost (those have their own commands). */
  public boolean isOpenStage(LeadStatus status) throws AxelorException {
    return status != null
        && !status.equals(appCrmService.getConvertedLeadStatus())
        && !status.equals(appCrmService.getLostLeadStatus());
  }

  public String kind(LeadStatus status) throws AxelorException {
    if (status == null) return null;
    if (status.equals(appCrmService.getConvertedLeadStatus())) return "CONVERTED";
    if (status.equals(appCrmService.getLostLeadStatus())) return "LOST";
    return "OPEN";
  }
}
