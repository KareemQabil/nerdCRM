package com.ioeti.marketing.service;

import com.axelor.apps.crm.db.Event;
import com.axelor.apps.crm.db.Lead;
import com.axelor.apps.crm.db.repo.EventRepository;
import com.axelor.apps.crm.db.repo.LeadRepository;
import com.axelor.apps.marketing.db.Campaign;
import com.axelor.auth.AuthUtils;
import com.axelor.db.JPA;
import com.axelor.db.JpaSecurity;
import com.axelor.db.Model;
import com.axelor.inject.Beans;
import com.axelor.message.db.EmailAddress;
import com.axelor.rpc.filter.Filter;
import com.axelor.rpc.filter.JPQLFilter;
import com.google.inject.persist.Transactional;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.text.ArabicNormalizer;
import com.ioeti.marketing.db.LeadConsentEvent;
import com.ioeti.marketing.db.repo.LeadConsentEventRepository;
import com.ioeti.marketing.db.repo.LeadSearchKeyListener;
import jakarta.persistence.LockModeType;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Lead intake and follow-up rules on the native CRM lead.
 *
 * <ul>
 *   <li>Possible duplicates are leads the caller may read with the same e-mail, the same phone (last 9
 *       digits) or the same normalized name and organization. Only readable leads are compared, so the
 *       check never reveals leads outside the caller's scope.
 *   <li>Consent is recorded per channel with how it was given; the native "do not email/call" flags
 *       hold the current state and every change is appended to {@link LeadConsentEvent}.
 *   <li>Follow-ups are native CRM events linked to the lead; nothing is sent to anyone.
 * </ul>
 */
public class MarketingService {

  @Transactional(rollbackOn = {Exception.class})
  public <T extends Model> T create(T record) {
    return JPA.save(record);
  }

  @Transactional(rollbackOn = {Exception.class})
  public void remove(Model record) {
    JPA.remove(JPA.em().contains(record) ? record : JPA.em().merge(record));
  }

  /** Readable leads that look like the candidate (ids, at most 10). */
  public static List<Lead> duplicates(String firstName, String name, String organization, String email, String phone) {
    List<Lead> found = new ArrayList<>();
    Set<Long> seen = new LinkedHashSet<>();
    String emailKey = ArabicNormalizer.emailKey(email);
    String phoneKey = ArabicNormalizer.phoneKey(phone);
    String nameKey = String.join(" | ", List.of(ArabicNormalizer.normalize(firstName), ArabicNormalizer.normalize(name),
        ArabicNormalizer.normalize(organization)).stream().filter(s -> !s.isEmpty()).toList());
    List<String> patterns = new ArrayList<>();
    if (!emailKey.isEmpty()) patterns.add("%" + escape(emailKey) + "%");
    if (phoneKey.length() >= 7) patterns.add("%" + escape(phoneKey) + "%");
    if (!nameKey.isEmpty() && !ArabicNormalizer.normalize(organization).isEmpty()) patterns.add(escape(nameKey) + "%");
    for (String pattern : patterns) {
      for (Lead lead : readable("self.ioetiSearchKey LIKE ?", pattern)) {
        if (seen.add(lead.getId())) found.add(lead);
      }
    }
    return found.size() > 10 ? found.subList(0, 10) : found;
  }

  private static String escape(String text) {
    return text.replace("\\", "").replace("%", "").replace("_", "");
  }

  private static List<Lead> readable(String condition, Object param) {
    Filter security = Beans.get(JpaSecurity.class).getFilter(JpaSecurity.CAN_READ, Lead.class);
    Filter wanted = new JPQLFilter(condition, param);
    return (security == null ? wanted : Filter.and(security, wanted)).build(Lead.class).order("-id").fetch(10);
  }

  @Transactional(rollbackOn = {Exception.class})
  public Lead intake(Lead lead, String email, Campaign campaign) {
    if (email != null) {
      EmailAddress address = new EmailAddress();
      address.setAddress(email);
      JPA.save(address);
      lead.setEmailAddress(address);
    }
    lead.setUser(AuthUtils.getUser());
    lead.setIoetiSearchKey(LeadSearchKeyListener.key(lead));
    Lead saved = Beans.get(LeadRepository.class).save(lead);
    if (campaign != null) attribute(saved, campaign);
    return saved;
  }

  @Transactional(rollbackOn = {Exception.class})
  public Campaign attribute(Lead lead, Campaign campaign) {
    // Attributions of different leads must not conflict: take the row lock first (a plain FOR UPDATE;
    // Hibernate's own lock re-checks the version read before waiting), then reload the campaign so each
    // attribution adds to the current lead set.
    JPA.em().createNativeQuery("SELECT id FROM marketing_campaign WHERE id = ?1 FOR UPDATE")
        .setParameter(1, campaign.getId()).getResultList();
    JPA.em().refresh(campaign);
    if (campaign.getLeadSet() != null && campaign.getLeadSet().contains(lead)) {
      throw new ApiException(409, "ALREADY_ATTRIBUTED", "This lead is already attributed to the campaign.", null);
    }
    campaign.addLeadSetItem(lead);
    return JPA.save(campaign);
  }

  @Transactional(rollbackOn = {Exception.class})
  public LeadConsentEvent consent(Lead lead, int channel, boolean allowed, int method, String evidence) {
    JPA.em().lock(lead, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    if (channel == LeadConsentEventRepository.CHANNEL_EMAIL) lead.setIsDoNotSendEmail(!allowed);
    else lead.setIsDoNotCall(!allowed);
    JPA.save(lead);
    LeadConsentEvent event = new LeadConsentEvent();
    event.setLead(lead);
    event.setChannelSelect(channel);
    event.setAllowed(allowed);
    event.setMethodSelect(method);
    event.setEvidenceReference(evidence);
    event.setActor(AuthUtils.getUser());
    event.setOccurredAt(LocalDateTime.now());
    return JPA.save(event);
  }

  @Transactional(rollbackOn = {Exception.class})
  public Event followUp(Lead lead, String subject, LocalDateTime start, int type) {
    JPA.em().lock(lead, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    Event event = new Event();
    event.setSubject(subject);
    event.setStartDateTime(start);
    event.setEndDateTime(start.plusMinutes(30));
    event.setTypeSelect(type);
    event.setStatusSelect(EventRepository.STATUS_PLANNED);
    event.setEventLead(lead);
    event.setUser(AuthUtils.getUser());
    return JPA.save(event);
  }

  @Transactional(rollbackOn = {Exception.class})
  public Event done(Event event) {
    if (!Integer.valueOf(EventRepository.STATUS_PLANNED).equals(event.getStatusSelect())) {
      throw new ApiException(422, "FOLLOW_UP_STATE", "Only a planned follow-up can be marked done.", null);
    }
    event.setStatusSelect(EventRepository.STATUS_REALIZED);
    return JPA.save(event);
  }
}
