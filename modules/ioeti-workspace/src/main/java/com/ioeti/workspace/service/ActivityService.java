package com.ioeti.workspace.service;

import com.axelor.apps.base.db.Partner;
import com.axelor.apps.crm.db.Event;
import com.axelor.apps.crm.db.Lead;
import com.axelor.apps.crm.db.Opportunity;
import com.axelor.apps.crm.db.repo.EventRepository;
import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.AuditableModel;
import com.axelor.db.JPA;
import com.google.inject.persist.Transactional;
import jakarta.persistence.LockModeType;
import java.time.LocalDateTime;

/**
 * Activities as native CRM events linked to a lead, an account or an opportunity (journeys plan, phase 2).
 * The record's version moves with each activity, so two people logging on the same record never overwrite
 * each other's view of it. Nothing is sent to anyone.
 */
public class ActivityService {

  @Transactional(rollbackOn = {Exception.class})
  public Event log(AuditableModel subject, String title, String outcome, LocalDateTime at, int type, boolean planned) {
    JPA.em().lock(subject, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    Event event = new Event();
    event.setSubject(title);
    event.setDescription(outcome);
    event.setStartDateTime(at);
    event.setEndDateTime(at.plusMinutes(30));
    event.setTypeSelect(type);
    event.setStatusSelect(planned ? EventRepository.STATUS_PLANNED : EventRepository.STATUS_REALIZED);
    event.setUser(AuthUtils.getUser());
    if (subject instanceof Lead lead) {
      event.setEventLead(lead);
    } else if (subject instanceof Opportunity opportunity) {
      event.setOpportunity(opportunity);
      event.setPartner(opportunity.getPartner());
    } else if (subject instanceof Partner partner) {
      event.setPartner(partner);
    }
    return JPA.save(event);
  }
}
