package com.ioeti.businessline.service;

import com.axelor.apps.base.AxelorException;
import com.axelor.apps.base.db.Partner;
import com.axelor.apps.base.db.repo.CountryRepository;
import com.axelor.apps.base.db.repo.PartnerRepository;
import com.axelor.apps.base.service.PartnerService;
import com.axelor.apps.base.service.app.AppBaseService;
import com.axelor.apps.base.service.wizard.ConvertWizardService;
import com.axelor.apps.crm.db.Lead;
import com.axelor.apps.crm.service.ConvertLeadWizardServiceImpl;
import com.axelor.apps.crm.service.ConvertWizardOpportunityService;
import com.axelor.apps.crm.service.LeadService;
import com.axelor.apps.crm.service.app.AppCrmService;
import com.axelor.message.db.repo.MultiRelatedRepository;
import com.google.inject.Inject;
import java.util.List;
import java.util.Map;

/**
 * The native AOS 9.1.10 conversion, with the new account and contact saved as soon as they are
 * built.
 *
 * <p>{@code ConvertLeadWizardServiceImpl} builds the partner and contact but leaves them unsaved:
 * the native UI saves them through the partner form. {@code convertLead} then links them to the
 * lead and copies the lead's related messages using their ids. Called directly, that would leave
 * them transient and those ids null. Saving them right after creation, in the same transaction,
 * fixes both.
 *
 * <p>Not bound in Guice: the native UI keeps its own implementation. Only the IOETI conversion
 * command uses this class.
 */
public class PersistingConvertLeadWizardService extends ConvertLeadWizardServiceImpl {

  @Inject
  public PersistingConvertLeadWizardService(
      LeadService leadService,
      ConvertWizardService convertWizardService,
      PartnerService partnerService,
      CountryRepository countryRepo,
      AppBaseService appBaseService,
      AppCrmService appCrmService,
      MultiRelatedRepository multiRelatedRepository,
      ConvertWizardOpportunityService convertWizardOpportunityService,
      PartnerRepository partnerRepository) {
    super(
        leadService,
        convertWizardService,
        partnerService,
        countryRepo,
        appBaseService,
        appCrmService,
        multiRelatedRepository,
        convertWizardOpportunityService,
        partnerRepository);
  }

  @Override
  protected Partner createPartnerData(
      Integer leadToPartnerSelect, Partner partner, Map<String, Object> partnerMap, Lead lead)
      throws AxelorException {
    Partner created = super.createPartnerData(leadToPartnerSelect, partner, partnerMap, lead);
    return created == null ? null : partnerRepository.save(created);
  }

  @Override
  protected List<Partner> createContactData(
      Lead lead, List<Partner> contactPartnerList, Map<String, Object> contactPartnerMap)
      throws AxelorException {
    List<Partner> contacts = super.createContactData(lead, contactPartnerList, contactPartnerMap);
    contacts.replaceAll(partnerRepository::save);
    return contacts;
  }
}
