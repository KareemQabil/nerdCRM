package com.ioeti.workspace.service;

import com.axelor.apps.account.db.Account;
import com.axelor.apps.account.db.AccountConfig;
import com.axelor.apps.account.db.Invoice;
import com.axelor.apps.account.db.Journal;
import com.axelor.apps.account.db.PaymentCondition;
import com.axelor.apps.account.db.PaymentConditionLine;
import com.axelor.apps.account.db.Tax;
import com.axelor.apps.account.db.TaxLine;
import com.axelor.apps.account.db.repo.AccountRepository;
import com.axelor.apps.account.db.repo.MoveLineRepository;
import com.axelor.apps.account.db.repo.PaymentConditionLineRepository;
import com.axelor.apps.account.service.AccountManagementAccountService;
import com.axelor.apps.account.service.app.AppAccountService;
import com.axelor.apps.account.service.config.AccountConfigService;
import com.axelor.apps.account.service.invoice.InvoiceService;
import com.axelor.apps.account.service.invoice.InvoiceTermService;
import com.axelor.apps.base.AxelorException;
import com.axelor.apps.base.db.Company;
import com.axelor.apps.base.db.repo.YearRepository;
import com.axelor.apps.base.service.PeriodService;
import com.axelor.apps.sale.db.SaleOrder;
import com.axelor.apps.sale.db.SaleOrderLine;
import com.axelor.apps.supplychain.db.Timetable;
import com.axelor.apps.supplychain.service.TimetableService;
import com.axelor.apps.supplychain.service.config.SupplyChainConfigService;
import com.axelor.auth.db.User;
import com.axelor.db.JPA;
import com.axelor.db.Query;
import com.google.inject.Inject;
import com.google.inject.persist.Transactional;
import com.ioeti.commercial.service.TaxPolicyBridge;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.db.PolicyVersion;
import com.ioeti.core.policy.PolicyService;
import com.ioeti.workspace.db.InvoiceRequest;
import com.ioeti.workspace.db.repo.InvoiceRequestRepository;
import jakarta.persistence.LockModeType;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * D-06 (signed 2026-10-25): finance issues the invoice for a requested milestone in Axelor accounting, with the
 * native services (invoice from the order's payment milestone, validation and ventilation into the ledger). The
 * chart of accounts, journals, sequences and fiscal periods are the company's accounting set-up, entered by finance
 * in Axelor; nothing is invented here. Until that set-up is complete, or while the order has no tax policy or the
 * owners have not set the payment terms, issuing is refused and says exactly what is missing.
 */
public class InvoicingService {

  public static final String PAYMENT_TERMS = "finance.payment-terms";

  /** One thing the accounting set-up still lacks for an invoice to be issued. */
  public record Missing(String code, String detail) {}

  private final PolicyService policies;
  private final AccountConfigService accountConfigService;
  private final PeriodService periodService;
  private final AccountManagementAccountService accountManagementAccountService;
  private final TimetableService timetableService;
  private final InvoiceService invoiceService;
  private final InvoiceTermService invoiceTermService;
  private final SupplyChainConfigService supplyChainConfigService;
  private final AppAccountService appAccountService;

  @Inject
  public InvoicingService(PolicyService policies, AccountConfigService accountConfigService, PeriodService periodService,
      AccountManagementAccountService accountManagementAccountService, TimetableService timetableService,
      InvoiceService invoiceService, InvoiceTermService invoiceTermService, SupplyChainConfigService supplyChainConfigService,
      AppAccountService appAccountService) {
    this.appAccountService = appAccountService;
    this.policies = policies;
    this.accountConfigService = accountConfigService;
    this.periodService = periodService;
    this.accountManagementAccountService = accountManagementAccountService;
    this.timetableService = timetableService;
    this.invoiceService = invoiceService;
    this.invoiceTermService = invoiceTermService;
    this.supplyChainConfigService = supplyChainConfigService;
  }

  /**
   * What the company's accounting set-up lacks to invoice this order on a date, checked with the same native
   * services the ventilation uses; empty when an invoice can be issued.
   */
  public List<Missing> readiness(SaleOrder order, LocalDate on) {
    List<Missing> missing = new ArrayList<>();
    Company company = order.getCompany();
    AccountConfig config;
    try {
      config = accountConfigService.getAccountConfig(company);
    } catch (AxelorException e) {
      missing.add(new Missing("ACCOUNT_CONFIG", company.getName()));
      return missing;
    }
    // the accounts the journal entry will post to: the customers account, each line's revenue account, the tax accounts
    Set<Account> posted = new LinkedHashSet<>();
    try {
      posted.add(accountConfigService.getCustomerAccount(config));
    } catch (AxelorException e) {
      missing.add(new Missing("CUSTOMER_ACCOUNT", null));
    }
    Journal journal = null;
    try {
      journal = accountConfigService.getCustomerSalesJournal(config);
      if (journal.getSequence() == null) missing.add(new Missing("JOURNAL_SEQUENCE", journal.getCode()));
    } catch (AxelorException e) {
      missing.add(new Missing("SALES_JOURNAL", null));
    }
    try {
      accountConfigService.getCustInvSequence(config);
    } catch (AxelorException e) {
      missing.add(new Missing("INVOICE_SEQUENCE", null));
    }
    // when the invoicing app prints the invoice on ventilation, the company needs its invoice print template
    if (Boolean.TRUE.equals(appAccountService.getAppInvoice().getAutoGenerateInvoicePrintingFileOnSaleInvoice())
        && config.getInvoicePrintTemplate() == null) {
      missing.add(new Missing("INVOICE_PRINT_TEMPLATE", company.getName()));
    }
    try {
      periodService.getActivePeriod(on, company, YearRepository.TYPE_FISCAL);
    } catch (AxelorException e) {
      missing.add(new Missing("OPEN_PERIOD", on.toString()));
    }
    try {
      supplyChainConfigService.getSupplyChainConfig(company);
    } catch (AxelorException e) {
      missing.add(new Missing("SUPPLYCHAIN_CONFIG", company.getName()));
    }
    if (order.getPaymentMode() == null) {
      // how the client pays (transfer, cheque…): finance's choice for the client or the company, required on the invoice
      missing.add(new Missing("PAYMENT_MODE", order.getClientPartner() == null ? null : order.getClientPartner().getName()));
    }
    if (order.getMainInvoicingAddress() == null) {
      // the native validation requires the client's invoicing address on the invoice, taken from the order
      missing.add(new Missing("CLIENT_ADDRESS", order.getClientPartner() == null ? null : order.getClientPartner().getName()));
    }
    Set<String> products = new LinkedHashSet<>();
    Set<String> noTaxAccounts = new LinkedHashSet<>();
    Set<String> noVatSystem = new LinkedHashSet<>();
    Set<Integer> vatSystems = new LinkedHashSet<>();
    Set<Tax> taxes = new LinkedHashSet<>();
    for (SaleOrderLine line : order.getSaleOrderLineList() == null ? List.<SaleOrderLine>of() : order.getSaleOrderLineList()) {
      if (line.getProduct() == null) continue;
      boolean taxed = line.getTaxLineSet() != null && !line.getTaxLineSet().isEmpty();
      try {
        Account account = accountManagementAccountService.getProductAccount(line.getProduct(), company, order.getFiscalPosition(), false, false);
        if (account != null) posted.add(account);
        if (account == null) products.add(line.getProduct().getCode());
        // the native ventilation refuses a taxed line on a revenue account that does not take tax
        else if (taxed && !Boolean.TRUE.equals(account.getIsTaxAuthorizedOnMoveLine())) noTaxAccounts.add(account.getCode());
        // the VAT system of the revenue account decides which collected-tax account the native posting uses
        else if (taxed && account.getVatSystemSelect() != null
            && (account.getVatSystemSelect() == MoveLineRepository.VAT_COMMON_SYSTEM || account.getVatSystemSelect() == MoveLineRepository.VAT_CASH_PAYMENTS)) {
          vatSystems.add(account.getVatSystemSelect());
        } else if (taxed) noVatSystem.add(account.getCode());
      } catch (AxelorException e) {
        products.add(line.getProduct().getCode());
      }
      if (taxed) for (TaxLine t : line.getTaxLineSet()) taxes.add(t.getTax());
    }
    products.forEach(code -> missing.add(new Missing("PRODUCT_SALE_ACCOUNT", code)));
    noTaxAccounts.forEach(code -> missing.add(new Missing("SALE_ACCOUNT_TAX", code)));
    noVatSystem.forEach(code -> missing.add(new Missing("SALE_ACCOUNT_VAT_SYSTEM", code)));
    for (Tax tax : taxes) {
      for (Integer system : vatSystems.isEmpty() ? Set.of(MoveLineRepository.VAT_COMMON_SYSTEM) : vatSystems) {
        Account taxAccount = tax.getAccountManagementList() == null ? null : tax.getAccountManagementList().stream()
            .filter(m -> company.equals(m.getCompany()))
            .map(m -> system == MoveLineRepository.VAT_CASH_PAYMENTS ? m.getSaleTaxVatSystem2Account() : m.getSaleTaxVatSystem1Account())
            .filter(java.util.Objects::nonNull).findFirst().orElse(null);
        if (taxAccount == null) missing.add(new Missing("TAX_ACCOUNT", tax.getCode()));
        else posted.add(taxAccount);
      }
    }
    // the native control: the sales journal must allow each account, or its account type, it posts to
    if (journal != null) {
      for (Account account : posted) {
        if (!journalAllows(journal, account)) missing.add(new Missing("JOURNAL_ACCOUNT", account.getCode()));
      }
    }
    // the native accounting refuses entries on inactive accounts
    for (Account account : posted) {
      if (!Integer.valueOf(AccountRepository.STATUS_ACTIVE).equals(account.getStatusSelect())) missing.add(new Missing("ACCOUNT_INACTIVE", account.getCode()));
    }
    return missing;
  }

  /** Same rule as the native move-line control: the account, or its type, is among the journal's valid ones. */
  static boolean journalAllows(Journal journal, Account account) {
    return (journal.getValidAccountSet() != null && journal.getValidAccountSet().contains(account))
        || (journal.getValidAccountTypeSet() != null && account.getAccountType() != null && journal.getValidAccountTypeSet().contains(account.getAccountType()));
  }

  /**
   * Issues the invoice of a requested milestone: the order must carry the owners' tax, the payment terms must be
   * set, and the accounting set-up complete. The invoice is created, validated and ventilated natively, with a
   * native payment condition built from the payment-terms policy; the request records it.
   */
  @Transactional(rollbackOn = {Exception.class})
  public InvoiceRequest issue(InvoiceRequest request, User me, LocalDate today) throws AxelorException {
    JPA.em().lock(request, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    if (request.getStatusSelect() != InvoiceRequestRepository.STATUS_REQUESTED) {
      throw new ApiException(422, "REQUEST_STATE", "Only an open invoice request can be issued.", null);
    }
    Timetable milestone = request.getMilestone();
    SaleOrder order = request.getQuote();
    if (Boolean.TRUE.equals(milestone.getInvoiced()) || milestone.getInvoice() != null) {
      throw new ApiException(422, "ALREADY_INVOICED", "This milestone is already invoiced.", null);
    }
    if (order.getIoetiTaxPolicy() == null) {
      throw new ApiException(422, "POLICY_NOT_SET", "This order was confirmed without the owners' tax (finance.tax); it cannot be invoiced.", null);
    }
    PolicyService.Applied terms = policies.require(PAYMENT_TERMS, TaxPolicyBridge.scopeOf(order), today);
    List<Missing> missing = readiness(order, today);
    if (!missing.isEmpty()) {
      throw new ApiException(422, "ACCOUNTING_NOT_READY", "The company's accounting set-up is not complete for this invoice.",
          missing.stream().map(m -> new ApiException.FieldError("accounting", m.code(), m.detail() == null ? m.code() : m.detail())).toList());
    }
    Invoice invoice = timetableService.generateInvoice(milestone);
    invoice.setPaymentCondition(paymentCondition(terms));
    invoiceTermService.computeInvoiceTerms(invoice);
    invoiceService.validateAndVentilate(invoice);
    request.setInvoice(invoice);
    request.setStatusSelect(InvoiceRequestRepository.STATUS_ISSUED);
    request.setIssuedBy(me);
    request.setIssuedAt(LocalDateTime.now());
    request.setPaymentTermsPolicy(JPA.find(PolicyVersion.class, terms.versionId()));
    return JPA.save(request);
  }

  /** The native payment condition for a payment-terms policy version (net N days, 100%), created on first use. */
  static PaymentCondition paymentCondition(PolicyService.Applied terms) {
    String code = "IOETI-PT-" + terms.versionId();
    PaymentCondition condition = Query.of(PaymentCondition.class).filter("self.code = ?1", code).fetchOne();
    if (condition != null) return condition;
    int days = terms.value().path("dueDays").asInt();
    condition = new PaymentCondition();
    condition.setCode(code);
    condition.setName(days + " days (policy " + terms.versionId() + ")");
    condition.setIsFree(false);
    PaymentConditionLine line = new PaymentConditionLine();
    line.setTypeSelect(PaymentConditionLineRepository.TYPE_NET);
    line.setPeriodTypeSelect(PaymentConditionLineRepository.PERIOD_TYPE_DAYS);
    line.setPaymentTime(days);
    line.setSequence(1);
    line.setPaymentPercentage(new BigDecimal("100"));
    condition.addPaymentConditionLineListItem(line);
    return JPA.save(condition);
  }
}
