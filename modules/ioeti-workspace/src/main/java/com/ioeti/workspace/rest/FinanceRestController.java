package com.ioeti.workspace.rest;

import com.axelor.apps.account.db.Invoice;
import com.axelor.apps.account.db.repo.InvoiceRepository;
import com.axelor.apps.base.db.Currency;
import com.axelor.apps.base.db.Partner;
import com.axelor.apps.base.service.app.AppBaseService;
import com.axelor.apps.sale.db.SaleOrder;
import com.axelor.apps.sale.db.repo.SaleOrderRepository;
import com.axelor.apps.supplychain.db.Timetable;
import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.User;
import com.axelor.db.JpaSecurity;
import com.axelor.db.Model;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.axelor.rpc.filter.Filter;
import com.axelor.rpc.filter.JPQLFilter;
import com.axelor.utils.api.ResponseConstructor;
import com.axelor.utils.api.SecurityCheck;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.IoetiEndpoint;
import com.axelor.apps.base.db.CurrencyConversionLine;
import com.ioeti.workspace.db.InvoiceRequest;
import com.ioeti.workspace.service.FxService;
import com.ioeti.workspace.db.repo.InvoiceRequestRepository;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;

/**
 * Finance's view of invoicing and collection within what D-06 allows: the queue of invoice requests sales
 * raised from confirmed orders, the milestones coming due that nobody has asked to invoice yet, and the
 * booked / requested / invoiced / collected figures per currency from real records, and their value in the
 * company currency at the rates in use (D-06: a public source the owners chose, overridden by finance by
 * hand). Issuing an invoice stays blocked here; nothing here marks a payment as received. Every figure is
 * within the caller's read scope; a stage the caller may not read is null, never zero.
 */
@Path("/ioeti/finance")
@Produces(MediaType.APPLICATION_JSON)
public class FinanceRestController {

  @GET
  @Path("/queue")
  @Operation(summary = "Invoice requests the caller may read: open (default), cancelled or all, oldest first", tags = {"IOETI finance"})
  @IoetiEndpoint
  public Response queue(@QueryParam("state") String state) {
    new SecurityCheck().readAccess(InvoiceRequest.class).check();
    String s = state == null || state.isBlank() ? "open" : state.strip();
    JPQLFilter condition = switch (s) {
      case "open" -> new JPQLFilter("self.statusSelect = ?", InvoiceRequestRepository.STATUS_REQUESTED);
      case "cancelled" -> new JPQLFilter("self.statusSelect = ?", InvoiceRequestRepository.STATUS_CANCELLED);
      case "all" -> null;
      default -> throw ApiException.invalidField("state", "UNAVAILABLE", "Use open, cancelled or all.");
    };
    LocalDate today = today();
    List<FinanceRequestView> rows = readable(InvoiceRequest.class, condition).order("requestedAt").order("id").fetch(500).stream()
        .map(r -> request(r, today)).toList();
    return ResponseConstructor.build(Response.Status.OK, "Invoice requests", rows);
  }

  @GET
  @Path("/milestones")
  @Operation(summary = "Milestones of confirmed orders due within the next days (or overdue) that are neither invoiced nor requested", tags = {"IOETI finance"})
  @IoetiEndpoint
  public Response milestones(@QueryParam("within") Integer within) {
    new SecurityCheck().readAccess(SaleOrder.class).check();
    int days = within == null ? 30 : within;
    if (days < 0 || days > 366) throw ApiException.invalidField("within", "RANGE", "Use 0 to 366 days.");
    LocalDate today = today();
    JpaSecurity security = Beans.get(JpaSecurity.class);
    List<UpcomingMilestoneView> rows = Query.of(Timetable.class).filter(
            "self.saleOrder.statusSelect = ?1 AND (self.invoiced IS NULL OR self.invoiced = false) AND self.estimatedDate IS NOT NULL"
                + " AND self.estimatedDate <= ?2 AND NOT EXISTS (SELECT r FROM InvoiceRequest r WHERE r.milestone = self AND r.statusSelect = ?3)",
            SaleOrderRepository.STATUS_ORDER_CONFIRMED, today.plusDays(days), InvoiceRequestRepository.STATUS_REQUESTED)
        .order("estimatedDate").order("id").fetch(500).stream()
        .filter(m -> security.isPermitted(JpaSecurity.CAN_READ, SaleOrder.class, m.getSaleOrder().getId()))
        .map(m -> {
          SaleOrder order = m.getSaleOrder();
          Partner account = order.getClientPartner();
          boolean seeAccount = account != null && security.isPermitted(JpaSecurity.CAN_READ, Partner.class, account.getId());
          return new UpcomingMilestoneView(m.getId(), m.getTitle(), m.getEstimatedDate(), m.getAmount(), code(order.getCurrency()),
              order.getId(), order.getVersion(), order.getSaleOrderSeq(), seeAccount ? account.getId() : null, seeAccount ? account.getName() : null,
              m.getEstimatedDate().isBefore(today), ChronoUnit.DAYS.between(today, m.getEstimatedDate()));
        }).toList();
    return ResponseConstructor.build(Response.Status.OK, "Milestones", rows);
  }

  @GET
  @Path("/summary")
  @Operation(summary = "Booked, requested, invoiced and collected per currency from real records within the caller's read scope", tags = {"IOETI finance"})
  @IoetiEndpoint
  public Response summary() {
    if (AuthUtils.getUser() == null) throw ApiException.forbidden();
    JpaSecurity security = Beans.get(JpaSecurity.class);
    boolean orders = security.isPermitted(JpaSecurity.CAN_READ, SaleOrder.class);
    boolean requests = security.isPermitted(JpaSecurity.CAN_READ, InvoiceRequest.class);
    boolean invoices = security.isPermitted(JpaSecurity.CAN_READ, Invoice.class);
    Map<String, BigDecimal[]> rows = new TreeMap<>();
    if (orders) {
      for (SaleOrder o : readable(SaleOrder.class, new JPQLFilter("self.statusSelect = ?", SaleOrderRepository.STATUS_ORDER_CONFIRMED)).fetch(5000)) {
        add(rows, code(o.getCurrency()), 0, o.getExTaxTotal());
      }
    }
    if (requests) {
      for (InvoiceRequest r : readable(InvoiceRequest.class, new JPQLFilter("self.statusSelect = ?", InvoiceRequestRepository.STATUS_REQUESTED)).fetch(5000)) {
        add(rows, code(r.getQuote().getCurrency()), 1, r.getAmountBeforeTax());
      }
    }
    if (invoices) {
      // invoices finance has issued and validated in the accounting module, and what was paid on them, as recorded there
      for (Invoice i : readable(Invoice.class, new JPQLFilter("self.operationTypeSelect = ? AND self.statusSelect = ?",
          InvoiceRepository.OPERATION_TYPE_CLIENT_SALE, InvoiceRepository.STATUS_VENTILATED)).fetch(5000)) {
        add(rows, code(i.getCurrency()), 2, i.getInTaxTotal());
        add(rows, code(i.getCurrency()), 3, i.getAmountPaid());
      }
    }
    // each currency's figures in the company currency at the rate in use; none when the rate is missing or too old
    FxService fx = Beans.get(FxService.class);
    LocalDateTime now = now();
    Currency base = fx.baseCurrency();
    Optional<FxService.Settings> settings = fx.settings(now.toLocalDate());
    List<FinanceMoneyView> out = new ArrayList<>();
    BigDecimal[] total = {BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO};
    boolean[] complete = {true};
    rows.forEach((currency, t) -> {
      BigDecimal rate = null;
      String fxStatus;
      LocalDate rateDate = null;
      if (currency.equals(base.getCodeISO())) {
        rate = BigDecimal.ONE;
        fxStatus = "BASE";
      } else if (settings.isEmpty()) {
        fxStatus = "POLICY_NOT_SET";
      } else {
        Currency c = Query.of(Currency.class).filter("self.codeISO = ?1", currency).fetchOne();
        Optional<FxService.Quote> q = c == null ? Optional.empty() : fx.quote(c, settings.get(), now);
        fxStatus = q.isEmpty() ? "NO_RATE" : q.get().stale() ? "FX_STALE" : "OK";
        if (q.isPresent()) rateDate = q.get().rate().getRateDate();
        if ("OK".equals(fxStatus)) rate = q.get().rate().getRate();
      }
      if (rate == null) complete[0] = false;
      BigDecimal[] inBase = new BigDecimal[4];
      for (int i = 0; i < 4; i++) {
        inBase[i] = rate == null ? null : t[i].multiply(rate).setScale(2, RoundingMode.HALF_UP);
        if (inBase[i] != null) total[i] = total[i].add(inBase[i]);
      }
      out.add(new FinanceMoneyView(currency, orders ? t[0] : null, requests ? t[1] : null, invoices ? t[2] : null, invoices ? t[3] : null,
          fxStatus, rate, rateDate, orders ? inBase[0] : null, requests ? inBase[1] : null, invoices ? inBase[2] : null, invoices ? inBase[3] : null));
    });
    FinanceMoneyView totalInBase = !complete[0] ? null : new FinanceMoneyView(base.getCodeISO(), orders ? total[0] : null,
        requests ? total[1] : null, invoices ? total[2] : null, invoices ? total[3] : null, "BASE", BigDecimal.ONE, null, null, null, null, null);
    return ResponseConstructor.build(Response.Status.OK, "Finance summary",
        new FinanceSummaryView(orders, requests, invoices, out, base.getCodeISO(), totalInBase));
  }

  @GET
  @Path("/fx")
  @Operation(summary = "Exchange rates to the company currency: the finance.fx policy, the rate in use per currency and its age, recent history (D-06)", tags = {"IOETI finance"})
  @IoetiEndpoint
  public Response fx() {
    new SecurityCheck().readAccess(CurrencyConversionLine.class).check();
    return ResponseConstructor.build(Response.Status.OK, "Exchange rates", fxView());
  }

  @POST
  @Path("/fx/refresh")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Fetch today's rates from the public source the finance.fx policy names (D-06)", tags = {"IOETI finance"})
  @IoetiEndpoint
  public Response refreshFx() {
    new SecurityCheck().createAccess(CurrencyConversionLine.class).writeAccess(CurrencyConversionLine.class).check();
    Beans.get(FxService.class).refresh(AuthUtils.getUser(), now());
    return ResponseConstructor.build(Response.Status.OK, "Exchange rates fetched", fxView());
  }

  @POST
  @Path("/fx/rates")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Enter a rate by hand, with the reason; on its date it takes precedence over a fetched rate (D-06)", tags = {"IOETI finance"})
  @IoetiEndpoint
  public Response overrideFx(OverrideRate command) {
    new SecurityCheck().createAccess(CurrencyConversionLine.class).writeAccess(CurrencyConversionLine.class).check();
    if (command == null) throw ApiException.badRequest("A rate is required.");
    LocalDate date;
    try {
      date = command.rateDate() == null || command.rateDate().isBlank() ? null : LocalDate.parse(command.rateDate().strip());
    } catch (DateTimeParseException e) {
      throw ApiException.invalidField("rateDate", "FORMAT", "Use a date like 2026-11-01.");
    }
    Beans.get(FxService.class).override(command.currency(), command.rate(), date, command.reason(), AuthUtils.getUser(), now());
    return ResponseConstructor.build(Response.Status.CREATED, "Exchange rate entered", fxView());
  }

  // --- helpers -------------------------------------------------------------------------------------

  private static FxView fxView() {
    FxService fx = Beans.get(FxService.class);
    LocalDateTime now = now();
    Currency base = fx.baseCurrency();
    Optional<FxService.Settings> settings = fx.settings(now.toLocalDate());
    List<FxCurrencyView> currencies = new ArrayList<>();
    settings.ifPresent(st -> {
      for (String code : st.currencies()) {
        Currency c = Query.of(Currency.class).filter("self.codeISO = ?1", code).fetchOne();
        Optional<FxService.Quote> q = c == null ? Optional.empty() : fx.quote(c, st, now);
        currencies.add(q.map(x -> new FxCurrencyView(code, x.rate().getRate(), x.rate().getRateDate(), x.rate().getAsOf(), x.rate().getSource(),
                ChronoUnit.HOURS.between(x.rate().getAsOf(), now), x.stale()))
            .orElse(new FxCurrencyView(code, null, null, null, null, null, false)));
      }
    });
    boolean canChange = Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_CREATE, CurrencyConversionLine.class);
    List<FxRateView> history = fx.history(30).stream().map(r -> new FxRateView(r.getId(), r.getCurrency().getCodeISO(), r.getRate(),
        r.getRateDate(), r.getAsOf(), r.getSource(), r.getProvider(), r.getReason(), r.getEnteredBy() == null ? null : r.getEnteredBy().getName(),
        r.getRecordedAt())).toList();
    return new FxView(settings.isPresent(), settings.map(FxService.Settings::source).orElse(null),
        settings.map(FxService.Settings::maxAgeHours).orElse(null), base.getCodeISO(), canChange, currencies, history);
  }

  private static LocalDateTime now() {
    User me = AuthUtils.getUser();
    return Beans.get(AppBaseService.class).getTodayDateTime(me == null ? null : me.getActiveCompany()).toLocalDateTime();
  }

  private static FinanceRequestView request(InvoiceRequest r, LocalDate today) {
    JpaSecurity security = Beans.get(JpaSecurity.class);
    SaleOrder order = r.getQuote();
    Partner account = order.getClientPartner();
    boolean seeAccount = account != null && security.isPermitted(JpaSecurity.CAN_READ, Partner.class, account.getId());
    Timetable m = r.getMilestone();
    boolean open = r.getStatusSelect() == InvoiceRequestRepository.STATUS_REQUESTED;
    LocalDateTime at = r.getRequestedAt();
    return new FinanceRequestView(r.getId(), r.getVersion(), open ? "REQUESTED" : "CANCELLED", order.getId(), order.getSaleOrderSeq(),
        seeAccount ? account.getId() : null, seeAccount ? account.getName() : null, m.getId(), m.getTitle(), m.getEstimatedDate(),
        r.getAmountBeforeTax(), code(order.getCurrency()), r.getRequestedBy() == null ? null : r.getRequestedBy().getName(), at,
        at == null ? null : ChronoUnit.DAYS.between(at.toLocalDate(), today), open && m.getEstimatedDate() != null && m.getEstimatedDate().isBefore(today),
        r.getRequestedBy() != null && r.getRequestedBy().equals(AuthUtils.getUser()), "BLOCKED_BY_POLICY");
  }

  private static void add(Map<String, BigDecimal[]> rows, String currency, int stage, BigDecimal value) {
    BigDecimal[] t = rows.computeIfAbsent(currency, k -> new BigDecimal[] {BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO});
    if (value != null) t[stage] = t[stage].add(value);
  }

  private static String code(Currency currency) {
    return currency == null ? "—" : currency.getCodeISO();
  }

  private static LocalDate today() {
    User me = AuthUtils.getUser();
    return Beans.get(AppBaseService.class).getTodayDate(me == null ? null : me.getActiveCompany());
  }

  private static <T extends Model> Query<T> readable(Class<T> type, Filter condition) {
    Filter security = Beans.get(JpaSecurity.class).getFilter(JpaSecurity.CAN_READ, type);
    Filter combined = security == null ? condition : condition == null ? security : Filter.and(security, condition);
    return combined == null ? Query.of(type) : combined.build(type);
  }

  /** An invoice request in finance's queue; invoiceStatus stays BLOCKED_BY_POLICY until D-06. */
  public record FinanceRequestView(Long id, Integer version, String status, Long orderId, String orderReference, Long accountId,
      String accountName, Long milestoneId, String milestoneTitle, LocalDate dueDate, BigDecimal amountBeforeTax, String currency,
      String requestedBy, LocalDateTime requestedAt, Long ageDays, boolean overdue, boolean mine, String invoiceStatus) {}

  public record UpcomingMilestoneView(Long id, String title, LocalDate dueDate, BigDecimal amountBeforeTax, String currency, Long orderId,
      Integer orderVersion, String orderReference, Long accountId, String accountName, boolean overdue, long daysLeft) {}

  /**
   * Per currency; booked and requested are before tax, invoiced and collected as recorded in accounting; null = not permitted.
   * The same figures in the company currency at the rate in use; fxStatus says why they are missing (POLICY_NOT_SET, NO_RATE, FX_STALE).
   */
  public record FinanceMoneyView(String currency, BigDecimal booked, BigDecimal requested, BigDecimal invoiced, BigDecimal collected,
      String fxStatus, BigDecimal rate, LocalDate rateDate, BigDecimal bookedInBase, BigDecimal requestedInBase, BigDecimal invoicedInBase,
      BigDecimal collectedInBase) {}

  /** totalInBase is null unless every currency could be converted. */
  public record FinanceSummaryView(boolean ordersPermitted, boolean requestsPermitted, boolean invoicesPermitted, List<FinanceMoneyView> rows,
      String baseCurrency, FinanceMoneyView totalInBase) {}

  public record OverrideRate(String currency, BigDecimal rate, String rateDate, String reason) {}

  /** The finance.fx policy (null when not set), the rate in use per listed currency, and recent rates. */
  public record FxView(boolean policySet, String source, Integer maxAgeHours, String baseCurrency, boolean canChange,
      List<FxCurrencyView> currencies, List<FxRateView> history) {}

  /** rate is null when there is none yet; stale when older than the policy allows (then it is not used). */
  public record FxCurrencyView(String currency, BigDecimal rate, LocalDate rateDate, LocalDateTime asOf, String source, Long ageHours, boolean stale) {}

  public record FxRateView(Long id, String currency, BigDecimal rate, LocalDate rateDate, LocalDateTime asOf, String source, String provider,
      String reason, String enteredBy, LocalDateTime recordedAt) {}
}
