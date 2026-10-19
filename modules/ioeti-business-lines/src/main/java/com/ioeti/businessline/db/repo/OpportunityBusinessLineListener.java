package com.ioeti.businessline.db.repo;

import com.axelor.apps.crm.db.Opportunity;
import com.axelor.db.JPA;
import com.ioeti.businessline.db.BusinessLine;
import com.ioeti.businessline.service.BusinessLineValidator;
import jakarta.persistence.FlushModeType;
import jakarta.persistence.PersistenceException;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;

/**
 * JPA listener registered on the native Opportunity entity through the IOETI domain extension.
 * Runs on every insert/update regardless of the entry point (UI, REST, service, import), so the
 * rule cannot be bypassed the way a view-only validation could.
 *
 * <p>Rule: a new opportunity can only be attached to an <b>active</b> business line. Existing
 * opportunities keep their line when it is later suspended.
 */
public class OpportunityBusinessLineListener {

  @PrePersist
  protected void checkOnCreate(Opportunity opportunity) {
    BusinessLine line = stored(opportunity.getIoetiBusinessLine());
    if (line != null && !BusinessLineValidator.acceptsNewRecords(line)) {
      throw notActive(line, "new opportunities are not allowed.");
    }
  }

  @PreUpdate
  protected void checkOnUpdate(Opportunity opportunity) {
    // Re-assigning to a non-active line is refused too; keeping the stored line is allowed.
    BusinessLine line = stored(opportunity.getIoetiBusinessLine());
    if (line == null || BusinessLineValidator.acceptsNewRecords(line)) {
      return;
    }
    Long storedLineId =
        JPA.em()
            .createQuery(
                "SELECT o.ioetiBusinessLine.id FROM Opportunity o WHERE o.id = :id", Long.class)
            .setParameter("id", opportunity.getId())
            .setFlushMode(FlushModeType.COMMIT)
            .getResultStream()
            .findFirst()
            .orElse(null);
    if (!line.getId().equals(storedLineId)) {
      throw notActive(line, "it cannot be assigned.");
    }
  }

  /**
   * API clients may send a reference holding only an id: always evaluate the persisted line.
   * Unknown ids are rejected.
   */
  private BusinessLine stored(BusinessLine reference) {
    if (reference == null) {
      return null;
    }
    if (reference.getId() == null) {
      throw new PersistenceException("Business line reference without id.");
    }
    BusinessLine line = JPA.em().find(BusinessLine.class, reference.getId());
    if (line == null) {
      throw new PersistenceException("Unknown business line id " + reference.getId() + ".");
    }
    return line;
  }

  private static PersistenceException notActive(BusinessLine line, String consequence) {
    return new PersistenceException(
        "Business line " + line.getCode() + " is not active: " + consequence);
  }
}
