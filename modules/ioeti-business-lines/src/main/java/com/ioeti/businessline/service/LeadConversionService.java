package com.ioeti.businessline.service;

import com.axelor.apps.base.AxelorException;
import com.axelor.apps.base.db.Partner;
import com.axelor.apps.base.service.app.AppBaseService;
import com.axelor.apps.crm.db.Lead;
import com.axelor.apps.crm.db.Opportunity;
import com.axelor.apps.crm.db.repo.LeadRepository;
import com.axelor.apps.crm.service.OpportunityService;
import com.axelor.auth.db.User;
import com.axelor.common.StringUtils;
import com.google.inject.Inject;
import com.google.inject.persist.Transactional;
import com.ioeti.businessline.db.BusinessLine;
import com.ioeti.core.api.ApiException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Lead → Account (+ Contact) + Opportunity in ONE transaction, using the native AOS conversion.
 *
 * <p>The partner/contact field maps mirror {@code ConvertLeadWizardController.getPartnerMap} and
 * {@code getContactMap} (AOS 9.1.10, {@code e7cbea53}, axelor-crm web/ConvertLeadWizardController
 * lines 195–260), which take an {@code ActionRequest} and cannot be called here. The conversion
 * itself is {@code ConvertLeadWizardService.generateDataAndConvertLead} (through {@link
 * PersistingConvertLeadWizardService}, which saves what it creates): it creates the partner and
 * contact, moves events and related messages, and marks the lead converted. The opportunity is then
 * created through {@code OpportunityService.saveOpportunity} with the lead as its origin.
 *
 * <p>Everything joins this transaction, so a concurrent conversion that loses the lead's version
 * check rolls back its partner, contact and opportunity: no duplicates. Authorization, version and
 * line eligibility are checked by the caller (the REST command) before this runs.
 */
public class LeadConversionService {

  public record Result(Partner account, Partner contact, Opportunity opportunity) {}

  private final PersistingConvertLeadWizardService convertLeadWizardService;
  private final OpportunityService opportunityService;
  private final AppBaseService appBaseService;

  @Inject
  public LeadConversionService(
      PersistingConvertLeadWizardService convertLeadWizardService,
      OpportunityService opportunityService,
      AppBaseService appBaseService) {
    this.convertLeadWizardService = convertLeadWizardService;
    this.opportunityService = opportunityService;
    this.appBaseService = appBaseService;
  }

  @Transactional(rollbackOn = {Exception.class})
  public Result convert(
      Lead lead, Partner existingAccount, String opportunityName, BusinessLine line, User owner)
      throws AxelorException {
    if (Boolean.TRUE.equals(lead.getIsConverted())) {
      throw new ApiException(409, "ALREADY_CONVERTED", "This lead has already been converted.", null);
    }
    boolean company = StringUtils.notBlank(lead.getEnterpriseName());
    List<Partner> contacts = new ArrayList<>();
    Partner account =
        convertLeadWizardService.generateDataAndConvertLead(
            lead,
            existingAccount == null
                ? LeadRepository.CONVERT_LEAD_CREATE_PARTNER
                : LeadRepository.CONVERT_LEAD_SELECT_PARTNER,
            company
                ? LeadRepository.CONVERT_LEAD_CREATE_CONTACT
                : LeadRepository.CONVERT_LEAD_NO_CONTACT_CREATION,
            existingAccount,
            existingAccount == null ? partnerMap(lead, company) : null,
            null,
            contacts,
            company ? contactMap(lead) : null);
    Partner contact = contacts.isEmpty() ? null : contacts.get(0);

    Opportunity opportunity = new Opportunity();
    opportunity.setName(opportunityName);
    opportunity.setPartner(account);
    opportunity.setContact(contact);
    opportunity.setUser(owner);
    opportunity.setTeam(lead.getTeam());
    opportunity.setSource(lead.getSource());
    opportunity.setIoetiBusinessLine(line);
    opportunity.setIoetiOriginLead(lead);
    opportunityService.saveOpportunity(opportunity);
    return new Result(account, contact, opportunity);
  }

  /** Mirrors ConvertLeadWizardController.getPartnerMap (AOS 9.1.10). */
  Map<String, Object> partnerMap(Lead lead, boolean company) {
    Map<String, Object> map = new HashMap<>();
    map.put("industrySector", lead.getIndustrySector());
    map.put("emailAddress", lead.getEmailAddress());
    map.put("mobilePhone", lead.getMobilePhone());
    map.put("fixedPhone", lead.getFixedPhone());
    map.put("webSite", lead.getWebSite());
    map.put("source", lead.getSource());
    map.put("department", lead.getDepartment());
    map.put("team", lead.getTeam());
    map.put("user", lead.getUser());
    map.put("isKeyAccount", lead.getIsKeyAccount());
    map.put("leadScoringSelect", lead.getLeadScoringSelect());
    map.put("partnerCategory", lead.getType());
    map.put("sizeSelect", lead.getSizeSelect());
    map.put("isNurturing", lead.getIsNurturing());
    map.put("agency", lead.getAgency());
    map.put("isProspect", true);
    if (!company) {
      map.put("firstName", lead.getFirstName());
      map.put("name", lead.getName());
      map.put("titleSelect", lead.getTitleSelect());
      map.put("partnerTypeSelect", 2);
    } else {
      map.put("partnerTypeSelect", 1);
      map.put("name", lead.getEnterpriseName());
    }
    map.put("localization", appBaseService.getAppBase().getDefaultPartnerLocalization());
    return map;
  }

  /** Mirrors ConvertLeadWizardController.getContactMap (AOS 9.1.10), without the picture copy. */
  Map<String, Object> contactMap(Lead lead) {
    Map<String, Object> map = new HashMap<>();
    map.put("firstName", lead.getFirstName());
    map.put("name", lead.getName());
    map.put("titleSelect", lead.getTitleSelect());
    map.put("emailAddress", lead.getEmailAddress());
    map.put("mobilePhone", lead.getMobilePhone());
    map.put("fixedPhone", lead.getFixedPhone());
    map.put("user", lead.getUser());
    map.put("team", lead.getTeam());
    map.put("jobTitleFunction", lead.getJobTitleFunction());
    map.put("companyDepartment", lead.getCompanyDepartment());
    return map;
  }
}
