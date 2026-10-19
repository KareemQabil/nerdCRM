package com.ioeti.commercial.rest;

import com.axelor.apps.account.db.Invoice;
import com.axelor.apps.account.db.repo.InvoiceRepository;
import com.axelor.apps.sale.db.SaleOrder;
import com.axelor.apps.sale.db.repo.SaleOrderRepository;
import com.axelor.apps.supplychain.db.Timetable;
import com.axelor.db.JpaSecurity;
import com.axelor.inject.Beans;
import com.axelor.utils.api.ConflictChecker;
import com.axelor.utils.api.ResponseConstructor;
import com.axelor.utils.api.SecurityCheck;
import com.ioeti.commercial.service.MilestoneService;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.IoetiEndpoint;
import com.ioeti.core.api.RecordAccess;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/**
 * Payment milestones of a quotation (Wave 3), on native AOS supplychain {@code Timetable}.
 *
 * <p>Three amounts are reported separately and never mixed:
 * <ul>
 *   <li><b>booked</b>: the order total once the quotation is a confirmed order, otherwise zero;
 *   <li><b>invoiced</b>: amounts of validated (ventilated) invoices issued for milestones;
 *   <li><b>collected</b>: what has been paid on those invoices.
 * </ul>
 * Issuing an invoice from a milestone is blocked until IOETI's finance policy (D-06) is signed.
 */
@Path("/ioeti/quotes/{quoteId}/milestones")
@Produces(MediaType.APPLICATION_JSON)
public class MilestoneRestController {

  static final int MAX_TITLE = 120;

  @GET
  @Operation(summary = "Payment milestones of a quotation, with booked / invoiced / collected kept apart", tags = {"IOETI quotes"})
  @IoetiEndpoint
  public Response list(@PathParam("quoteId") Long quoteId) {
    new SecurityCheck().readAccess(Timetable.class).check();
    SaleOrder quote = RecordAccess.readable(SaleOrder.class, quoteId);
    return ResponseConstructor.build(Response.Status.OK, "Payment milestones", plan(quote));
  }

  @POST
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Add a payment milestone to a draft quotation", tags = {"IOETI quotes"})
  @IoetiEndpoint
  public Response add(@PathParam("quoteId") Long quoteId, AddMilestone command) {
    if (command == null || command.version() == null) {
      throw ApiException.badRequest("Record version is required.");
    }
    new SecurityCheck().createAccess(Timetable.class).check();
    SaleOrder quote = RecordAccess.writable(SaleOrder.class, quoteId);
    ConflictChecker.checkVersion(quote, command.version());
    requireDraft(quote);
    String title = checkedTitle(command.title());
    BigDecimal percentage = checkedPercentage(command.percentage());
    LocalDate dueDate = checkedDueDate(command.dueDate());
    QuoteRestController.runNative(
        () -> Beans.get(MilestoneService.class).add(quote, title, percentage, dueDate));
    return ResponseConstructor.build(Response.Status.CREATED, "Payment milestone added", plan(quote));
  }

  @DELETE
  @Path("/{milestoneId}")
  @Operation(summary = "Remove a payment milestone that has not been invoiced", tags = {"IOETI quotes"})
  @IoetiEndpoint
  public Response remove(
      @PathParam("quoteId") Long quoteId,
      @PathParam("milestoneId") Long milestoneId,
      @QueryParam("version") Integer version) {
    if (version == null) throw ApiException.badRequest("Record version is required.");
    new SecurityCheck().removeAccess(Timetable.class).check();
    SaleOrder quote = RecordAccess.writable(SaleOrder.class, quoteId);
    ConflictChecker.checkVersion(quote, version);
    requireDraft(quote);
    Timetable milestone = ownMilestone(quote, milestoneId);
    QuoteRestController.runNative(() -> Beans.get(MilestoneService.class).remove(quote, milestone));
    return ResponseConstructor.build(Response.Status.OK, "Payment milestone removed", plan(quote));
  }

  @POST
  @Path("/{milestoneId}/invoice")
  @Operation(summary = "Invoice a milestone: blocked until the finance policy (D-06) is signed", tags = {"IOETI quotes"})
  @IoetiEndpoint
  public Response invoice(@PathParam("quoteId") Long quoteId, @PathParam("milestoneId") Long milestoneId) {
    SaleOrder quote = RecordAccess.writable(SaleOrder.class, quoteId);
    ownMilestone(quote, milestoneId);
    throw ApiException.policyBlocked("D-06");
  }

  /** A milestone of another quotation answers exactly like a missing one. */
  private static Timetable ownMilestone(SaleOrder quote, Long milestoneId) {
    return MilestoneService.milestones(quote).stream()
        .filter(m -> m.getId().equals(milestoneId))
        .findFirst()
        .orElseThrow(ApiException::notFound);
  }

  private static void requireDraft(SaleOrder quote) {
    if (!Integer.valueOf(SaleOrderRepository.STATUS_DRAFT_QUOTATION).equals(quote.getStatusSelect())) {
      throw new ApiException(422, "QUOTE_NOT_DRAFT", "Only a draft quotation can be changed.", null);
    }
  }

  static String checkedTitle(String title) {
    String value = title == null ? "" : title.trim();
    if (value.length() < 3 || value.length() > MAX_TITLE) {
      throw ApiException.invalidField("title", "LENGTH", "Milestone title must be between 3 and 120 characters.");
    }
    return value;
  }

  static BigDecimal checkedPercentage(BigDecimal percentage) {
    if (percentage == null || percentage.signum() <= 0 || percentage.compareTo(MilestoneService.HUNDRED_PERCENT) > 0
        || percentage.stripTrailingZeros().scale() > 2) {
      throw ApiException.invalidField(
          "percentage", "RANGE", "Percentage must be above 0 and at most 100, with up to 2 decimals.");
    }
    return percentage;
  }

  static LocalDate checkedDueDate(String dueDate) {
    try {
      LocalDate date = LocalDate.parse(dueDate == null ? "" : dueDate);
      if (date.getYear() < 2000 || date.getYear() > 2100) throw new IllegalArgumentException();
      return date;
    } catch (RuntimeException e) {
      throw ApiException.invalidField("dueDate", "DATE", "Due date must be a valid date (YYYY-MM-DD).");
    }
  }

  static MilestonePlan plan(SaleOrder quote) {
    boolean canReadInvoices = Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, Invoice.class);
    BigDecimal planned = BigDecimal.ZERO, plannedAmount = BigDecimal.ZERO;
    BigDecimal invoiced = BigDecimal.ZERO, collected = BigDecimal.ZERO;
    List<MilestoneView> views = new java.util.ArrayList<>();
    for (Timetable m : MilestoneService.milestones(quote)) {
      planned = planned.add(zero(m.getPercentage()));
      plannedAmount = plannedAmount.add(zero(m.getAmount()));
      Invoice invoice = m.getInvoice();
      boolean issued = invoice != null
          && Integer.valueOf(InvoiceRepository.STATUS_VENTILATED).equals(invoice.getStatusSelect());
      BigDecimal paid = issued ? zero(invoice.getInTaxTotal()).subtract(zero(invoice.getAmountRemaining())) : BigDecimal.ZERO;
      if (issued) {
        invoiced = invoiced.add(zero(invoice.getInTaxTotal()));
        collected = collected.add(paid);
      }
      String state = !issued ? "PLANNED"
          : zero(invoice.getAmountRemaining()).signum() == 0 ? "COLLECTED"
          : paid.signum() > 0 ? "PARTIALLY_COLLECTED" : "INVOICED";
      views.add(new MilestoneView(m.getId(), m.getTitle(), m.getPercentage(), m.getAmount(),
          m.getEstimatedDate() == null ? null : m.getEstimatedDate().toString(), state,
          issued && canReadInvoices ? invoice.getInvoiceId() : null));
    }
    int status = quote.getStatusSelect() == null ? 0 : quote.getStatusSelect();
    boolean booked = status == SaleOrderRepository.STATUS_ORDER_CONFIRMED
        || status == SaleOrderRepository.STATUS_ORDER_COMPLETED;
    return new MilestonePlan(
        quote.getId(), quote.getVersion(),
        quote.getCurrency() == null ? null : quote.getCurrency().getCode(),
        quote.getExTaxTotal(), planned, plannedAmount,
        booked ? "BOOKED" : "NOT_BOOKED", booked ? quote.getExTaxTotal() : BigDecimal.ZERO,
        invoiced, collected, "BLOCKED_BY_POLICY", views);
  }

  private static BigDecimal zero(BigDecimal value) {
    return value == null ? BigDecimal.ZERO : value;
  }

  public record AddMilestone(Integer version, String title, BigDecimal percentage, String dueDate) {}
  public record MilestoneView(
      Long id, String title, BigDecimal percentage, BigDecimal amountBeforeTax, String dueDate,
      String state, String invoiceReference) {}
  /**
   * {@code bookedBeforeTax} is the confirmed order total; {@code invoiced} and {@code collected}
   * come from validated invoices and their payments (invoice amounts, D-06 governs their taxes);
   * {@code invoicingStatus} is BLOCKED_BY_POLICY while D-06 is open.
   */
  public record MilestonePlan(
      Long quoteId, Integer quoteVersion, String currency, BigDecimal totalBeforeTax,
      BigDecimal plannedPercentage, BigDecimal plannedAmountBeforeTax, String bookingStatus,
      BigDecimal bookedBeforeTax, BigDecimal invoiced, BigDecimal collected, String invoicingStatus,
      List<MilestoneView> milestones) {}
}
