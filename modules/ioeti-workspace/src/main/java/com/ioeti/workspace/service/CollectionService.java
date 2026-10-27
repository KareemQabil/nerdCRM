package com.ioeti.workspace.service;

import com.axelor.apps.account.db.Account;
import com.axelor.apps.account.db.AccountConfig;
import com.axelor.apps.account.db.Invoice;
import com.axelor.apps.account.db.InvoiceLine;
import com.axelor.apps.account.db.InvoicePayment;
import com.axelor.apps.account.db.Journal;
import com.axelor.apps.account.db.PaymentMode;
import com.axelor.apps.account.db.repo.AccountRepository;
import com.axelor.apps.account.db.repo.InvoicePaymentRepository;
import com.axelor.apps.account.db.repo.InvoiceRepository;
import com.axelor.apps.account.service.config.AccountConfigService;
import com.axelor.apps.account.service.invoice.InvoiceLineService;
import com.axelor.apps.account.service.invoice.InvoiceService;
import com.axelor.apps.account.service.invoice.InvoiceTermService;
import com.axelor.apps.account.service.invoice.InvoiceToolService;
import com.axelor.apps.account.service.payment.PaymentModeService;
import com.axelor.apps.account.service.payment.invoice.payment.InvoicePaymentCreateService;
import com.axelor.apps.account.service.payment.invoice.payment.InvoicePaymentToolService;
import com.axelor.apps.base.AxelorException;
import com.axelor.apps.base.db.Company;
import com.axelor.apps.base.db.repo.SequenceRepository;
import com.axelor.apps.base.db.repo.YearRepository;
import com.axelor.apps.base.service.administration.SequenceService;
import com.axelor.apps.base.service.PeriodService;
import com.axelor.db.JPA;
import com.google.inject.Inject;
import com.google.inject.persist.Transactional;
import com.ioeti.core.api.ApiException;
import jakarta.persistence.LockModeType;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * D-06 (signed 2026-10-25), collection side of full Axelor accounting. Finance records a payment the company has
 * actually received against an issued invoice, with its date and the bank or receipt reference, and issues credit
 * notes (a share of an invoice, with the reason). Both go through the native services, which post and reconcile
 * them in the ledger. Nothing is ever marked as received without finance recording it; until the payment or credit
 * note set-up is complete the action is refused and says exactly what is missing.
 */
public class CollectionService {

  private final AccountConfigService accountConfigService;
  private final PaymentModeService paymentModeService;
  private final PeriodService periodService;
  private final InvoicePaymentCreateService invoicePaymentCreateService;
  private final InvoicePaymentToolService invoicePaymentToolService;
  private final InvoicePaymentRepository invoicePaymentRepository;
  private final InvoiceService invoiceService;
  private final InvoiceLineService invoiceLineService;
  private final InvoiceTermService invoiceTermService;
  private final SequenceService sequenceService;

  @Inject
  public CollectionService(AccountConfigService accountConfigService, PaymentModeService paymentModeService, PeriodService periodService,
      InvoicePaymentCreateService invoicePaymentCreateService, InvoicePaymentToolService invoicePaymentToolService,
      InvoicePaymentRepository invoicePaymentRepository, InvoiceService invoiceService, InvoiceLineService invoiceLineService,
      InvoiceTermService invoiceTermService, SequenceService sequenceService) {
    this.invoiceTermService = invoiceTermService;
    this.sequenceService = sequenceService;
    this.accountConfigService = accountConfigService;
    this.paymentModeService = paymentModeService;
    this.periodService = periodService;
    this.invoicePaymentCreateService = invoicePaymentCreateService;
    this.invoicePaymentToolService = invoicePaymentToolService;
    this.invoicePaymentRepository = invoicePaymentRepository;
    this.invoiceService = invoiceService;
    this.invoiceLineService = invoiceLineService;
  }

  /** An issued customer invoice: ventilated, of a client sale. */
  public static boolean issued(Invoice invoice) {
    return invoice.getOperationTypeSelect() == InvoiceRepository.OPERATION_TYPE_CLIENT_SALE
        && invoice.getStatusSelect() == InvoiceRepository.STATUS_VENTILATED;
  }

  /** What the set-up lacks to record a payment on this invoice on a date (its payment mode's journal and account). */
  public List<InvoicingService.Missing> paymentReadiness(Invoice invoice, LocalDate on) {
    List<InvoicingService.Missing> missing = new ArrayList<>();
    Company company = invoice.getCompany();
    PaymentMode mode = invoice.getPaymentMode();
    if (mode == null) {
      missing.add(new InvoicingService.Missing("PAYMENT_MODE", null));
      return missing;
    }
    Set<Account> posted = new LinkedHashSet<>();
    if (invoice.getPartnerAccount() != null) posted.add(invoice.getPartnerAccount());
    Journal journal = null;
    try {
      journal = paymentModeService.getPaymentModeJournal(mode, company, invoice.getCompanyBankDetails());
      if (journal == null) missing.add(new InvoicingService.Missing("PAYMENT_JOURNAL", mode.getCode()));
      else if (journal.getSequence() == null) missing.add(new InvoicingService.Missing("JOURNAL_SEQUENCE", journal.getCode()));
    } catch (AxelorException e) {
      missing.add(new InvoicingService.Missing("PAYMENT_JOURNAL", mode.getCode()));
    }
    try {
      Account account = paymentModeService.getPaymentModeAccount(mode, company, invoice.getCompanyBankDetails());
      if (account == null) missing.add(new InvoicingService.Missing("PAYMENT_ACCOUNT", mode.getCode()));
      else posted.add(account);
    } catch (AxelorException e) {
      missing.add(new InvoicingService.Missing("PAYMENT_ACCOUNT", mode.getCode()));
    }
    try {
      periodService.getActivePeriod(on, company, YearRepository.TYPE_FISCAL);
    } catch (AxelorException e) {
      missing.add(new InvoicingService.Missing("OPEN_PERIOD", on.toString()));
    }
    reconcileSequence(company, missing);
    accounts(journal, posted, missing);
    return missing;
  }

  /**
   * Records a payment finance has received: the amount (up to what is still due), the date it was received (not in
   * the future, not before the invoice) and the bank or receipt reference. The native service posts the payment
   * and reconciles it with the invoice, whose amount paid and remaining are updated.
   */
  @Transactional(rollbackOn = {Exception.class})
  public InvoicePayment recordPayment(Invoice invoice, BigDecimal amount, LocalDate date, String reference, LocalDate today)
      throws AxelorException {
    JPA.em().lock(invoice, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    if (!issued(invoice)) throw new ApiException(422, "INVOICE_STATE", "Only an issued customer invoice can be paid.", null);
    BigDecimal remaining = invoice.getAmountRemaining() == null ? BigDecimal.ZERO : invoice.getAmountRemaining();
    if (remaining.signum() <= 0) throw new ApiException(422, "ALREADY_PAID", "This invoice is fully paid.", null);
    if (amount == null || amount.signum() <= 0 || amount.compareTo(remaining) > 0 || amount.stripTrailingZeros().scale() > 2) {
      throw ApiException.invalidField("amount", "RANGE", "The amount must be above 0 and at most what is still due, with up to 2 decimals.");
    }
    LocalDate received = date == null ? today : date;
    if (received.isAfter(today) || (invoice.getInvoiceDate() != null && received.isBefore(invoice.getInvoiceDate()))) {
      throw ApiException.invalidField("paymentDate", "RANGE", "The payment date must be between the invoice date and today.");
    }
    String ref = reference == null ? "" : reference.strip();
    if (ref.isEmpty()) throw ApiException.invalidField("reference", "REQUIRED", "Give the bank or receipt reference of the payment.");
    if (ref.length() > 120) throw ApiException.invalidField("reference", "TOO_LONG", "Keep the reference under 120 characters.");
    List<InvoicingService.Missing> missing = paymentReadiness(invoice, received);
    if (!missing.isEmpty()) throw notReady(missing);
    InvoicePayment payment = invoicePaymentCreateService.createInvoicePayment(invoice, amount, received, invoice.getCurrency(),
        invoice.getPaymentMode(), InvoicePaymentRepository.TYPE_PAYMENT);
    payment.setCompanyBankDetails(invoice.getCompanyBankDetails());
    payment.setInvoicePaymentRef(ref);
    payment.setApplyFinancialDiscount(false);
    // the amount finance typed (as in the native form): the native allocation then spreads it over the unpaid invoice terms
    payment.setManualChange(true);
    invoice.addInvoicePaymentListItem(payment);
    invoicePaymentToolService.changeAmount(payment, invoice.getId());
    // the native repository validates a draft payment on save: payment move, reconciliation, amounts paid and remaining
    return invoicePaymentRepository.save(payment);
  }

  /** What the set-up lacks to issue a credit note for this invoice (credit-note journal, numbering, refund payment mode). */
  public List<InvoicingService.Missing> creditNoteReadiness(Invoice invoice, LocalDate on) {
    List<InvoicingService.Missing> missing = new ArrayList<>();
    Company company = invoice.getCompany();
    AccountConfig config;
    try {
      config = accountConfigService.getAccountConfig(company);
    } catch (AxelorException e) {
      missing.add(new InvoicingService.Missing("ACCOUNT_CONFIG", company.getName()));
      return missing;
    }
    Journal journal = null;
    try {
      journal = accountConfigService.getCustomerCreditNoteJournal(config);
      if (journal.getSequence() == null) missing.add(new InvoicingService.Missing("JOURNAL_SEQUENCE", journal.getCode()));
    } catch (AxelorException e) {
      missing.add(new InvoicingService.Missing("CREDIT_NOTE_JOURNAL", null));
    }
    try {
      accountConfigService.getCustRefSequence(config);
    } catch (AxelorException e) {
      missing.add(new InvoicingService.Missing("CREDIT_NOTE_SEQUENCE", null));
    }
    // a credit note is not paid by the invoice's payment mode: the client's or the company's refund mode is used
    Invoice probe = new Invoice();
    probe.setOperationTypeSelect(InvoiceRepository.OPERATION_TYPE_CLIENT_REFUND);
    probe.setPartner(invoice.getPartner());
    probe.setCompany(company);
    try {
      if (InvoiceToolService.getPaymentMode(probe) == null) missing.add(new InvoicingService.Missing("REFUND_PAYMENT_MODE", null));
    } catch (AxelorException e) {
      missing.add(new InvoicingService.Missing("REFUND_PAYMENT_MODE", null));
    }
    try {
      periodService.getActivePeriod(on, company, YearRepository.TYPE_FISCAL);
    } catch (AxelorException e) {
      missing.add(new InvoicingService.Missing("OPEN_PERIOD", on.toString()));
    }
    reconcileSequence(company, missing);
    // the credit note posts to the same accounts as the invoice
    Set<Account> posted = new LinkedHashSet<>();
    if (invoice.getPartnerAccount() != null) posted.add(invoice.getPartnerAccount());
    if (invoice.getMove() != null && invoice.getMove().getMoveLineList() != null) {
      invoice.getMove().getMoveLineList().forEach(l -> { if (l.getAccount() != null) posted.add(l.getAccount()); });
    }
    accounts(journal, posted, missing);
    return missing;
  }

  /**
   * Issues a credit note for a share of an invoice (1–100% of each line), with the reason: the native refund is
   * generated from the invoice, scaled, validated and ventilated; the ledger offsets it against the invoice.
   */
  @Transactional(rollbackOn = {Exception.class})
  public Invoice creditNote(Invoice invoice, BigDecimal percent, String reason, LocalDate today) throws AxelorException {
    JPA.em().lock(invoice, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    if (!issued(invoice)) throw new ApiException(422, "INVOICE_STATE", "Only an issued customer invoice can be credited.", null);
    if (percent == null || percent.signum() <= 0 || percent.compareTo(new BigDecimal("100")) > 0 || percent.stripTrailingZeros().scale() > 2) {
      throw ApiException.invalidField("percent", "RANGE", "The share must be above 0 and at most 100%, with up to 2 decimals.");
    }
    BigDecimal credited = credited(invoice);
    if (credited.add(invoice.getExTaxTotal().multiply(percent).divide(new BigDecimal("100"), 2, RoundingMode.HALF_UP))
        .compareTo(invoice.getExTaxTotal()) > 0) {
      throw ApiException.invalidField("percent", "RANGE", "Credit notes cannot exceed the invoice.");
    }
    String why = reason == null ? "" : reason.strip();
    if (why.isEmpty()) throw ApiException.invalidField("reason", "REQUIRED", "Say why the credit note is issued.");
    if (why.length() > 500) throw ApiException.invalidField("reason", "TOO_LONG", "Keep the reason under 500 characters.");
    List<InvoicingService.Missing> missing = creditNoteReadiness(invoice, today);
    if (!missing.isEmpty()) throw notReady(missing);
    Invoice refund = invoiceService.createRefund(invoice);
    if (percent.compareTo(new BigDecimal("100")) < 0 && refund.getInvoiceLineList() != null) {
      BigDecimal share = percent.divide(new BigDecimal("100"), 6, RoundingMode.HALF_UP);
      for (InvoiceLine line : refund.getInvoiceLineList()) {
        line.setQty(line.getQty().multiply(share).setScale(4, RoundingMode.HALF_UP));
        invoiceLineService.compute(refund, line);
      }
      invoiceService.compute(refund);
      // the copied payment terms were the full invoice's: compute them again for the credited share
      invoiceTermService.computeInvoiceTerms(refund);
    }
    refund.setNote(why);
    // ventilating the credit note offsets it against the invoice; the native reconciliation reads both payment lists,
    // which are only initialised when the invoice has been opened in the native form
    if (invoice.getInvoicePaymentList() == null) invoice.setInvoicePaymentList(new ArrayList<>());
    if (refund.getInvoicePaymentList() == null) refund.setInvoicePaymentList(new ArrayList<>());
    invoiceService.validateAndVentilate(refund);
    return refund;
  }

  /** Before-tax total of the credit notes already ventilated for an invoice. */
  public static BigDecimal credited(Invoice invoice) {
    return invoice.getRefundInvoiceList() == null ? BigDecimal.ZERO : invoice.getRefundInvoiceList().stream()
        .filter(r -> r.getStatusSelect() == InvoiceRepository.STATUS_VENTILATED)
        .map(Invoice::getExTaxTotal).reduce(BigDecimal.ZERO, BigDecimal::add);
  }

  /** Paying an invoice or crediting it reconciles journal lines, which the native ledger numbers per company. */
  private void reconcileSequence(Company company, List<InvoicingService.Missing> missing) {
    for (String code : List.of(SequenceRepository.RECONCILE, SequenceRepository.RECONCILE_GROUP_DRAFT, SequenceRepository.RECONCILE_GROUP_FINAL)) {
      if (!sequenceService.hasSequence(code, company)) missing.add(new InvoicingService.Missing("RECONCILE_SEQUENCE", code));
    }
  }

  /** The native controls on posting: the journal allows each account (or its type), and each account is active. */
  private static void accounts(Journal journal, Set<Account> posted, List<InvoicingService.Missing> missing) {
    for (Account account : posted) {
      if (journal != null && !InvoicingService.journalAllows(journal, account)) {
        missing.add(new InvoicingService.Missing("JOURNAL_ACCOUNT", account.getCode()));
      }
      if (!Integer.valueOf(AccountRepository.STATUS_ACTIVE).equals(account.getStatusSelect())) {
        missing.add(new InvoicingService.Missing("ACCOUNT_INACTIVE", account.getCode()));
      }
    }
  }

  static ApiException notReady(List<InvoicingService.Missing> missing) {
    return new ApiException(422, "ACCOUNTING_NOT_READY", "The accounting set-up is not complete for this.",
        missing.stream().map(m -> new ApiException.FieldError("accounting", m.code(), m.detail() == null ? m.code() : m.detail())).toList());
  }
}
