package com.ioeti.commercial.rest;

import com.axelor.apps.base.db.Company;
import com.axelor.apps.base.db.Partner;
import com.axelor.apps.base.db.Product;
import com.axelor.apps.crm.db.Opportunity;
import com.axelor.apps.sale.db.SaleOrder;
import com.axelor.apps.sale.db.SaleOrderLine;
import com.axelor.apps.sale.db.repo.SaleOrderRepository;
import com.axelor.apps.sale.service.saleorder.SaleOrderVersionService;
import com.axelor.auth.AuthUtils;
import com.axelor.db.JPA;
import com.axelor.db.JpaSecurity;
import com.axelor.inject.Beans;
import com.axelor.rpc.filter.Filter;
import com.axelor.rpc.filter.JPQLFilter;
import com.axelor.utils.api.ConflictChecker;
import com.axelor.utils.api.ResponseConstructor;
import com.axelor.utils.api.SecurityCheck;
import com.axelor.apps.base.service.app.AppBaseService;
import com.fasterxml.jackson.databind.JsonNode;
import com.ioeti.commercial.service.QuoteService;
import com.ioeti.commercial.service.TaxPolicyBridge;
import com.ioeti.core.db.PolicyVersion;
import com.ioeti.core.policy.PolicyService;
import com.ioeti.core.policy.PolicyValidator;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.IoetiEndpoint;
import com.ioeti.core.api.NativeCommands;
import com.ioeti.core.api.RecordAccess;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * Draft quotations for opportunities (Wave 3), on native AOS {@code SaleOrder} records.
 *
 * <p>Tax (D-06, signed 2026-10-25) is the {@code finance.tax} policy the owners set for the quotation's
 * business line (or the default), applied with the native tax services after every change. Without a
 * policy in force {@code taxStatus = "POLICY_NOT_SET"} and no tax amounts are given. When the owners change
 * the policy, a draft shows {@code taxOutdated} until its tax is applied again. Finalizing or sending a
 * quotation also needs the commercial approval matrix (D-11), so that command fails closed.
 */
@Path("/ioeti/quotes")
@Produces(MediaType.APPLICATION_JSON)
public class QuoteRestController {


  static final BigDecimal MAX_QUANTITY = new BigDecimal("100000");

  @GET
  @Operation(summary = "List the quotations of an opportunity the caller may read", tags = {"IOETI quotes"})
  @IoetiEndpoint
  public Response list(@QueryParam("opportunityId") Long opportunityId) {
    new SecurityCheck().readAccess(SaleOrder.class).check();
    Opportunity opportunity = RecordAccess.readable(Opportunity.class, opportunityId);
    Filter ofOpportunity = new JPQLFilter("self.opportunity.id = " + opportunity.getId());
    Filter security = Beans.get(JpaSecurity.class).getFilter(JpaSecurity.CAN_READ, SaleOrder.class);
    Filter condition = security == null ? ofOpportunity : Filter.and(security, ofOpportunity);
    List<QuoteView> records = condition.build(SaleOrder.class).order("-id").fetch(50).stream()
        .map(QuoteRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Quotations", records);
  }

  @GET
  @Path("/{id}")
  @Operation(summary = "Read one quotation with record-level permission checks", tags = {"IOETI quotes"})
  @IoetiEndpoint
  public Response get(@PathParam("id") Long id) {
    return ResponseConstructor.build(
        Response.Status.OK, "Quotation", view(RecordAccess.readable(SaleOrder.class, id)));
  }

  @POST
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Create a draft quotation from an opportunity (native AOS service)", tags = {"IOETI quotes"})
  @IoetiEndpoint
  public Response create(CreateQuote command) {
    if (command == null || command.opportunityVersion() == null) {
      throw ApiException.badRequest("Opportunity version is required.");
    }
    new SecurityCheck().createAccess(SaleOrder.class).check();
    Opportunity opportunity = RecordAccess.writable(Opportunity.class, command.opportunityId());
    ConflictChecker.checkVersion(opportunity, command.opportunityVersion());
    if (opportunity.getPartner() == null) {
      throw ApiException.invalidField(
          "opportunityId", "ACCOUNT_REQUIRED", "Link the opportunity to an account before quoting.");
    }
    QuoteService service = Beans.get(QuoteService.class);
    Company company = service.quotingCompany(opportunity, AuthUtils.getUser()).orElseThrow(() ->
        new ApiException(422, "SETUP_REQUIRED", "No company is configured for quotations.", null));
    SaleOrder[] created = new SaleOrder[1];
    // createFromOpportunity is @Transactional and commits on return; a concurrent change to the
    // opportunity makes its versioned UPDATE fail here and the new quotation rolls back with it
    runNative(() -> created[0] = service.createFromOpportunity(opportunity, company));
    return ResponseConstructor.build(Response.Status.CREATED, "Quotation created", view(created[0]));
  }

  @POST
  @Path("/{id}/lines")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Add a catalog product to a draft quotation", tags = {"IOETI quotes"})
  @IoetiEndpoint
  public Response addLine(@PathParam("id") Long id, AddLine command) {
    if (command == null || command.version() == null) {
      throw ApiException.badRequest("Record version is required.");
    }
    new SecurityCheck().createAccess(SaleOrderLine.class).check();
    SaleOrder quote = RecordAccess.writable(SaleOrder.class, id);
    ConflictChecker.checkVersion(quote, command.version());
    if (!Integer.valueOf(SaleOrderRepository.STATUS_DRAFT_QUOTATION).equals(quote.getStatusSelect())) {
      throw new ApiException(422, "QUOTE_NOT_DRAFT", "Only a draft quotation can be changed.", null);
    }
    Product product = sellableProduct(command.productId());
    BigDecimal quantity = checkedQuantity(command.quantity());
    runNative(() -> Beans.get(QuoteService.class).addLine(quote, product, quantity));
    return ResponseConstructor.build(Response.Status.CREATED, "Quotation line added", view(quote));
  }

  @GET
  @Path("/{id}/versions")
  @Operation(summary = "Saved versions of a quotation (native AOS versions), newest first", tags = {"IOETI quotes"})
  @IoetiEndpoint
  public Response versions(@PathParam("id") Long id) {
    SaleOrder quote = RecordAccess.readable(SaleOrder.class, id);
    Map<Integer, VersionView> versions = new TreeMap<>((a, b) -> b - a);
    // saved lines are archived copies that point to the quotation through oldVersionSaleOrder
    for (SaleOrderLine line : JPA.em()
        .createQuery("SELECT l FROM SaleOrderLine l WHERE l.oldVersionSaleOrder = :q", SaleOrderLine.class)
        .setParameter("q", quote).getResultList()) {
      VersionView current = versions.get(line.getVersionNumber());
      BigDecimal total = (current == null ? BigDecimal.ZERO : current.totalBeforeTax())
          .add(line.getExTaxTotal() == null ? BigDecimal.ZERO : line.getExTaxTotal());
      versions.put(line.getVersionNumber(), new VersionView(line.getVersionNumber(), line.getVersionDateT(),
          (current == null ? 0 : current.lines()) + 1, total));
    }
    return ResponseConstructor.build(Response.Status.OK, "Quotation versions", List.copyOf(versions.values()));
  }

  @POST
  @Path("/{id}/versions")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Save the current lines as a version and continue on the next one (native AOS)", tags = {"IOETI quotes"})
  @IoetiEndpoint
  public Response saveVersion(@PathParam("id") Long id, VersionOnly command) {
    SaleOrder quote = draftForChange(id, command == null ? null : command.version());
    if (quote.getSaleOrderLineList() == null || quote.getSaleOrderLineList().isEmpty()) {
      throw new ApiException(422, "NO_LINES", "Add at least one line before saving a version.", null);
    }
    runNative(() -> Beans.get(SaleOrderVersionService.class).createNewVersion(quote));
    return ResponseConstructor.build(Response.Status.CREATED, "Version saved", view(quote));
  }

  @POST
  @Path("/{id}/versions/{number}/restore")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Bring back the lines of a saved version; the current lines are saved first (native AOS)", tags = {"IOETI quotes"})
  @IoetiEndpoint
  public Response restoreVersion(@PathParam("id") Long id, @PathParam("number") Integer number, VersionOnly command) {
    SaleOrder quote = draftForChange(id, command == null ? null : command.version());
    long saved = JPA.em().createQuery(
            "SELECT COUNT(l) FROM SaleOrderLine l WHERE l.oldVersionSaleOrder = :q AND l.versionNumber = :n", Long.class)
        .setParameter("q", quote).setParameter("n", number).getSingleResult();
    if (number == null || saved == 0) {
      throw new ApiException(422, "VERSION_UNKNOWN", "This quotation has no saved version with that number.", null);
    }
    runNative(() -> Beans.get(QuoteService.class).restoreVersion(quote, number));
    return ResponseConstructor.build(Response.Status.OK, "Version restored", view(quote));
  }

  @POST
  @Path("/{id}/tax")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Apply the tax policy in force today to a draft quotation again (D-06)", tags = {"IOETI quotes"})
  @IoetiEndpoint
  public Response refreshTax(@PathParam("id") Long id, VersionOnly command) {
    SaleOrder quote = draftForChange(id, command == null ? null : command.version());
    runNative(() -> Beans.get(QuoteService.class).refreshTax(quote));
    return ResponseConstructor.build(Response.Status.OK, "Tax applied", view(quote));
  }

  private static SaleOrder draftForChange(Long id, Integer version) {
    if (version == null) throw ApiException.badRequest("Record version is required.");
    new SecurityCheck().createAccess(SaleOrderLine.class).check();
    SaleOrder quote = RecordAccess.writable(SaleOrder.class, id);
    ConflictChecker.checkVersion(quote, version);
    if (!Integer.valueOf(SaleOrderRepository.STATUS_DRAFT_QUOTATION).equals(quote.getStatusSelect())) {
      throw new ApiException(422, "QUOTE_NOT_DRAFT", "Only a draft quotation can be changed.", null);
    }
    return quote;
  }

  @POST
  @Path("/{id}/finalize")
  @Operation(summary = "Finalize a quotation: blocked until finance (D-06) and approval (D-11) policies", tags = {"IOETI quotes"})
  @IoetiEndpoint
  public Response finalizeQuote(@PathParam("id") Long id) {
    RecordAccess.writable(SaleOrder.class, id);
    throw ApiException.policyBlocked("D-06 and D-11");
  }

  /** Unknown, unreadable and non-sellable products are rejected identically (no oracle). */
  private static Product sellableProduct(Long productId) {
    JpaSecurity security = Beans.get(JpaSecurity.class);
    Product product = productId == null || productId <= 0 ? null : JPA.find(Product.class, productId);
    if (product == null
        || !security.isPermitted(JpaSecurity.CAN_READ, Product.class, productId)
        || !Boolean.TRUE.equals(product.getSellable())
        || Boolean.TRUE.equals(product.getIsModel())) {
      throw ApiException.invalidField("productId", "UNAVAILABLE", "Choose a sellable product from the catalog.");
    }
    return product;
  }

  static BigDecimal checkedQuantity(BigDecimal quantity) {
    if (quantity == null || quantity.signum() <= 0 || quantity.compareTo(MAX_QUANTITY) > 0
        || quantity.stripTrailingZeros().scale() > 4) {
      throw ApiException.invalidField(
          "quantity", "RANGE", "Quantity must be greater than 0 and at most 100000, with up to 4 decimals.");
    }
    return quantity;
  }

  /** Native quotation writes: see {@link NativeCommands} for the error mapping. */
  static void runNative(NativeCommands.NativeCommand command) {
    NativeCommands.run(command, "QUOTE_REJECTED", "The quotation cannot be changed this way.");
  }

  static QuoteView view(SaleOrder quote) {
    JpaSecurity security = Beans.get(JpaSecurity.class);
    Opportunity opportunity = quote.getOpportunity();
    Partner account = quote.getClientPartner();
    boolean canReadAccount = account != null
        && security.isPermitted(JpaSecurity.CAN_READ, Partner.class, account.getId());
    List<QuoteLineView> lines = !security.isPermitted(JpaSecurity.CAN_READ, SaleOrderLine.class)
        || quote.getSaleOrderLineList() == null ? List.of()
        : quote.getSaleOrderLineList().stream().map(line -> new QuoteLineView(
            line.getId(),
            line.getProduct() == null ? null : line.getProduct().getCode(),
            line.getProductName(),
            line.getQty(),
            line.getUnit() == null ? null : line.getUnit().getName(),
            line.getPrice(),
            line.getExTaxTotal())).toList();
    // the tax the quotation was computed with, and whether the owners have set a different one since
    PolicyVersion used = quote.getIoetiTaxPolicy();
    boolean draft = Integer.valueOf(SaleOrderRepository.STATUS_DRAFT_QUOTATION).equals(quote.getStatusSelect());
    Long inForce = !draft ? null : Beans.get(TaxPolicyBridge.class)
        .inForce(quote, Beans.get(AppBaseService.class).getTodayDate(quote.getCompany()))
        .map(PolicyService.Applied::versionId).orElse(null);
    JsonNode value = used == null ? null : PolicyValidator.read(used.getValueJson());
    TaxView tax = value == null ? null : new TaxView(value.path("name").asText(), new BigDecimal(value.path("ratePercent").asText("0")),
        used.getId(), used.getEffectiveFrom());
    return new QuoteView(
        quote.getId(),
        quote.getVersion(),
        quote.getSaleOrderSeq(),
        status(quote.getStatusSelect()),
        opportunity != null && security.isPermitted(JpaSecurity.CAN_READ, Opportunity.class, opportunity.getId())
            ? opportunity.getId() : null,
        canReadAccount ? account.getId() : null,
        canReadAccount ? account.getName() : null,
        quote.getCurrency() == null ? null : quote.getCurrency().getCode(),
        quote.getExTaxTotal(),
        used == null ? "POLICY_NOT_SET" : "APPLIED",
        used == null ? null : quote.getTaxTotal(),
        used == null ? null : quote.getInTaxTotal(),
        tax,
        draft && !java.util.Objects.equals(inForce, used == null ? null : used.getId()),
        quote.getVersionNumber(),
        lines);
  }

  static String status(Integer statusSelect) {
    if (statusSelect == null) return null;
    return switch (statusSelect) {
      case SaleOrderRepository.STATUS_DRAFT_QUOTATION -> "DRAFT";
      case SaleOrderRepository.STATUS_FINALIZED_QUOTATION -> "FINALIZED";
      case SaleOrderRepository.STATUS_ORDER_CONFIRMED -> "CONFIRMED";
      case SaleOrderRepository.STATUS_ORDER_COMPLETED -> "COMPLETED";
      case SaleOrderRepository.STATUS_CANCELED -> "CANCELED";
      default -> "OTHER";
    };
  }

  public record CreateQuote(Long opportunityId, Integer opportunityVersion) {}
  public record AddLine(Integer version, Long productId, BigDecimal quantity) {}
  public record QuoteLineView(
      Long id, String productCode, String name, BigDecimal quantity, String unit,
      BigDecimal unitPriceBeforeTax, BigDecimal totalBeforeTax) {}
  public record QuoteView(
      Long id, Integer version, String reference, String status, Long opportunityId,
      Long accountId, String accountName, String currency, BigDecimal totalBeforeTax,
      String taxStatus, BigDecimal taxTotal, BigDecimal totalWithTax, TaxView tax, boolean taxOutdated,
      Integer versionNumber, List<QuoteLineView> lines) {}
  /** The finance.tax policy version a quotation's tax was computed with (D-06). */
  public record TaxView(String name, BigDecimal ratePercent, Long policyVersionId, java.time.LocalDate since) {}
  public record VersionOnly(Integer version) {}
  public record VersionView(Integer number, LocalDateTime savedAt, int lines, BigDecimal totalBeforeTax) {}
}
