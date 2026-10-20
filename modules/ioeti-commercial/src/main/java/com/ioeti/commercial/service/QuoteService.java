package com.ioeti.commercial.service;

import com.axelor.apps.base.AxelorException;
import com.axelor.apps.base.db.Company;
import com.axelor.apps.base.db.Product;
import com.axelor.apps.base.db.repo.CompanyRepository;
import com.axelor.apps.crm.db.Opportunity;
import com.axelor.apps.sale.db.SaleOrder;
import com.axelor.apps.sale.service.saleorder.opportunity.OpportunitySaleOrderService;
import com.axelor.apps.sale.service.saleorderline.creation.SaleOrderLineGeneratorService;
import com.axelor.apps.supplychain.service.saleorder.SaleOrderSupplychainService;
import com.axelor.auth.db.User;
import com.google.inject.Inject;
import com.google.inject.persist.Transactional;
import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;

/**
 * Quotations from opportunities on the native AOS sale services (9.1.10).
 *
 * <ul>
 *   <li>Creation: {@code OpportunitySaleOrderService.createSaleOrderFromOpportunity}. The
 *       salesperson, contact, team, currency, default price list and fiscal position come from the
 *       opportunity and its account, exactly as in the native "Create quotation" button.
 *   <li>Lines: {@code SaleOrderLineGeneratorService.createSaleOrderLine}, the same path the AOS mobile
 *       API uses. It refuses non-draft quotations and recomputes the order totals. Payment
 *       milestones are then recomputed with the native {@code updateTimetableAmounts}.
 * </ul>
 */
public class QuoteService {

  private final OpportunitySaleOrderService opportunitySaleOrderService;
  private final SaleOrderLineGeneratorService saleOrderLineGeneratorService;
  private final CompanyRepository companyRepository;
  private final SaleOrderSupplychainService saleOrderSupplychainService;

  @Inject
  public QuoteService(
      OpportunitySaleOrderService opportunitySaleOrderService,
      SaleOrderLineGeneratorService saleOrderLineGeneratorService,
      CompanyRepository companyRepository,
      SaleOrderSupplychainService saleOrderSupplychainService) {
    this.opportunitySaleOrderService = opportunitySaleOrderService;
    this.saleOrderLineGeneratorService = saleOrderLineGeneratorService;
    this.companyRepository = companyRepository;
    this.saleOrderSupplychainService = saleOrderSupplychainService;
  }

  /**
   * The company a new quotation is issued by. This is the native opportunity-form default: the
   * opportunity's company, else the user's active company, else the only company if exactly one
   * exists (AOS {@code Opportunity.xml}, action that sets {@code company}). Empty when none applies.
   */
  public Optional<Company> quotingCompany(Opportunity opportunity, User user) {
    if (opportunity.getCompany() != null) return Optional.of(opportunity.getCompany());
    if (user != null && user.getActiveCompany() != null) return Optional.of(user.getActiveCompany());
    List<Company> companies = companyRepository.all().fetch(2);
    return companies.size() == 1 ? Optional.of(companies.get(0)) : Optional.empty();
  }

  @Transactional(rollbackOn = {Exception.class})
  public SaleOrder createFromOpportunity(Opportunity opportunity, Company company)
      throws AxelorException {
    if (opportunity.getCompany() == null) {
      opportunity.setCompany(company);
    }
    return opportunitySaleOrderService.createSaleOrderFromOpportunity(opportunity);
  }

  @Transactional(rollbackOn = {Exception.class})
  public SaleOrder addLine(SaleOrder quote, Product product, BigDecimal quantity)
      throws AxelorException {
    saleOrderLineGeneratorService.createSaleOrderLine(quote, product, quantity);
    // the native form does this on line change; the line generator does not: keep payment
    // milestones (Timetable) at their percentage of the new total
    saleOrderSupplychainService.updateTimetableAmounts(quote);
    saleOrderSupplychainService.updateAmountToBeSpreadOverTheTimetable(quote);
    return quote;
  }
}
