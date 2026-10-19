package com.ioeti.commercial.service;

import com.axelor.apps.sale.db.SaleOrder;
import com.axelor.apps.supplychain.db.Timetable;
import com.axelor.apps.supplychain.db.repo.TimetableRepository;
import com.axelor.apps.supplychain.service.TimetableService;
import com.axelor.db.JPA;
import com.google.inject.Inject;
import com.google.inject.persist.Transactional;
import com.ioeti.core.api.ApiException;
import jakarta.persistence.LockModeType;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/**
 * Payment milestones of a quotation, on the native AOS supplychain {@code Timetable}.
 *
 * <p>The quotation row is locked with {@code PESSIMISTIC_FORCE_INCREMENT} before the milestones are
 * read. Concurrent changes therefore run one after the other, the second fails its version check
 * (409), and the quotation version moves on every change, so clients holding the old one see a
 * conflict. That keeps the invariant "milestone percentages never exceed 100 %" true under
 * concurrency. Amounts come from the native {@code TimetableService.computeAmount} (percentage of the
 * total before tax; the last milestone takes the rounding remainder when the plan reaches 100 %).
 */
public class MilestoneService {

  public static final BigDecimal HUNDRED_PERCENT = BigDecimal.valueOf(100);

  private final TimetableService timetableService;
  private final TimetableRepository timetableRepository;

  @Inject
  public MilestoneService(TimetableService timetableService, TimetableRepository timetableRepository) {
    this.timetableService = timetableService;
    this.timetableRepository = timetableRepository;
  }

  @Transactional(rollbackOn = {Exception.class})
  public Timetable add(SaleOrder quote, String title, BigDecimal percentage, LocalDate dueDate) {
    JPA.em().lock(quote, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    List<Timetable> existing = new ArrayList<>(milestones(quote));
    BigDecimal planned = existing.stream().map(Timetable::getPercentage).reduce(BigDecimal.ZERO, BigDecimal::add);
    if (planned.add(percentage).compareTo(HUNDRED_PERCENT) > 0) {
      throw ApiException.invalidField(
          "percentage", "TOTAL_EXCEEDED", "Milestones of a quotation cannot exceed 100 % in total.");
    }
    Timetable milestone = new Timetable();
    milestone.setTitle(title);
    milestone.setPercentage(percentage);
    milestone.setEstimatedDate(dueDate);
    milestone.setInvoiced(false);
    milestone.setAmount(
        timetableService.computeAmount(milestone, existing, quote.getExTaxTotal(), quote.getCurrency()));
    quote.addTimetableListItem(milestone);
    return timetableRepository.save(milestone);
  }

  @Transactional(rollbackOn = {Exception.class})
  public void remove(SaleOrder quote, Timetable milestone) {
    JPA.em().lock(quote, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    if (Boolean.TRUE.equals(milestone.getInvoiced()) || milestone.getInvoice() != null) {
      throw new ApiException(
          422, "MILESTONE_INVOICED", "An invoiced milestone cannot be removed.", null);
    }
    quote.removeTimetableListItem(milestone);
    timetableRepository.remove(milestone);
  }

  public static List<Timetable> milestones(SaleOrder quote) {
    return quote.getTimetableList() == null ? List.of() : quote.getTimetableList();
  }
}
