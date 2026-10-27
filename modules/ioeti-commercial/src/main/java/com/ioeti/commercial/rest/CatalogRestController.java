package com.ioeti.commercial.rest;

import com.axelor.apps.account.db.AccountManagement;
import com.axelor.apps.base.db.Company;
import com.axelor.apps.base.db.Currency;
import com.axelor.apps.base.db.Product;
import com.axelor.apps.base.db.ProductCategory;
import com.axelor.apps.base.db.Unit;
import com.axelor.apps.base.db.repo.ProductRepository;
import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.User;
import com.axelor.db.JPA;
import com.axelor.db.JpaSecurity;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.axelor.rpc.filter.Filter;
import com.axelor.rpc.filter.JPQLFilter;
import com.axelor.utils.api.ConflictChecker;
import com.axelor.utils.api.ResponseConstructor;
import com.axelor.utils.api.SecurityCheck;
import com.ioeti.core.api.ApiException;
import com.ioeti.commercial.service.CatalogService;
import com.ioeti.commercial.service.CatalogService.ServiceFields;
import com.ioeti.core.api.IoetiEndpoint;
import com.ioeti.core.api.RecordAccess;
import com.ioeti.core.web.OptimisticLockConflicts;
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
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * The service catalogue: native AOS {@code Product} records with the caller's permissions. Sellers read
 * the services on sale for their quotations; people allowed to create or change products (native
 * permissions) manage the catalogue. Only commercial fields are exposed: no cost price, supplier or stock
 * data, and the accounting set-up that makes a service invoiceable stays with finance (shown, not guessed).
 */
@Path("/ioeti/catalog/products")
@Produces(MediaType.APPLICATION_JSON)
public class CatalogRestController {

  static final String SELLABLE_JPQL =
      "self.sellable = true AND (self.isModel IS NULL OR self.isModel = false)";

  @GET
  @Operation(summary = "List sellable catalog products the caller may read", tags = {"IOETI catalog"})
  @IoetiEndpoint
  public Response list(
      @QueryParam("q") String search,
      @QueryParam("limit") Integer requestedLimit,
      @QueryParam("offset") Integer requestedOffset,
      @QueryParam("all") Boolean all) {
    new SecurityCheck().readAccess(Product.class).check();
    // the whole catalogue (services off sale too) is for people who can change products
    boolean manage = Boolean.TRUE.equals(all);
    if (manage) new SecurityCheck().writeAccess(Product.class).check();
    int limit = requestedLimit == null ? 25 : requestedLimit;
    int offset = requestedOffset == null ? 0 : requestedOffset;
    if (limit < 1 || limit > 50 || offset < 0 || offset > 10000) {
      throw ApiException.badRequest("Invalid pagination parameters.");
    }
    String text = search == null ? "" : search.trim();
    if (text.length() > 80) {
      throw ApiException.invalidField("q", "LENGTH", "Search text must be at most 80 characters.");
    }
    Filter condition = new JPQLFilter(manage ? "(self.isModel IS NULL OR self.isModel = false) AND (self.archived IS NULL OR self.archived = false)" : SELLABLE_JPQL);
    if (!text.isEmpty()) {
      String pattern = "%" + text.toLowerCase(Locale.ROOT).replace("%", "").replace("_", "") + "%";
      condition = Filter.and(condition,
          new JPQLFilter("LOWER(self.name) LIKE ? OR LOWER(self.code) LIKE ?", pattern, pattern));
    }
    // the security filter goes first: its positional parameters come before ours
    Filter security = Beans.get(JpaSecurity.class).getFilter(JpaSecurity.CAN_READ, Product.class);
    if (security != null) condition = Filter.and(security, condition);
    if (manage) {
      List<ServiceView> records = condition.build(Product.class).order("name").fetch(limit, offset)
          .stream().map(CatalogRestController::service).toList();
      return ResponseConstructor.build(Response.Status.OK, "Catalog services", records);
    }
    List<ProductView> records = condition.build(Product.class).order("name").fetch(limit, offset)
        .stream().map(CatalogRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Catalog products", records);
  }

  @GET
  @Path("/{id}")
  @Operation(summary = "One service of the catalogue with its commercial fields", tags = {"IOETI catalog"})
  @IoetiEndpoint
  public Response get(@PathParam("id") Long id) {
    new SecurityCheck().readAccess(Product.class).check();
    return ResponseConstructor.build(Response.Status.OK, "Catalog service", service(RecordAccess.readable(Product.class, id)));
  }

  @POST
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Add a service to the catalogue (native create permission on products)", tags = {"IOETI catalog"})
  @IoetiEndpoint
  public Response create(EditService command) {
    new SecurityCheck().createAccess(Product.class).check();
    if (command == null) throw ApiException.badRequest("Service details are required.");
    ServiceFields fields = fields(command, null, true);
    Product[] saved = new Product[1];
    OptimisticLockConflicts.translate(() -> saved[0] = Beans.get(CatalogService.class).create(fields));
    return ResponseConstructor.build(Response.Status.CREATED, "Service added", service(saved[0]));
  }

  @POST
  @Path("/{id}")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Change a service of the catalogue, with its version (native write permission)", tags = {"IOETI catalog"})
  @IoetiEndpoint
  public Response update(@PathParam("id") Long id, EditService command) {
    new SecurityCheck().writeAccess(Product.class).check();
    if (command == null || command.version() == null) throw ApiException.badRequest("Record version is required.");
    Product product = RecordAccess.writable(Product.class, id);
    ConflictChecker.checkVersion(product, command.version());
    ServiceFields fields = fields(command, id, false);
    Product[] saved = new Product[1];
    OptimisticLockConflicts.translate(() -> saved[0] = Beans.get(CatalogService.class).update(product, fields,
        blank(command.summary()), blank(command.unitId()), blank(command.categoryId()), blank(command.startDate()), blank(command.endDate())));
    return ResponseConstructor.build(Response.Status.OK, "Service saved", service(saved[0]));
  }

  @GET
  @Path("/units")
  @Operation(summary = "Units a service can be sold in (native Unit)", tags = {"IOETI catalog"})
  @IoetiEndpoint
  public Response units() {
    new SecurityCheck().readAccess(Product.class).check();
    return ResponseConstructor.build(Response.Status.OK, "Units",
        Query.of(Unit.class).order("name").fetch(200).stream().map(u -> new CatalogOption(u.getId(), u.getName())).toList());
  }

  @GET
  @Path("/categories")
  @Operation(summary = "Product categories (native ProductCategory)", tags = {"IOETI catalog"})
  @IoetiEndpoint
  public Response categories() {
    new SecurityCheck().readAccess(Product.class).check();
    return ResponseConstructor.build(Response.Status.OK, "Categories",
        Query.of(ProductCategory.class).order("name").fetch(200).stream().map(c -> new CatalogOption(c.getId(), c.getName())).toList());
  }

  // --- validation ----------------------------------------------------------------------------------

  static final Pattern CODE = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{1,29}");
  static final Pattern ISO = Pattern.compile("[A-Za-z]{3}");

  /** A field sent as an empty string clears it (where it may be cleared); a missing field is left alone. */
  private static boolean blank(Object value) {
    return value instanceof String text && text.isBlank();
  }

  private static ServiceFields fields(EditService c, Long id, boolean creating) {
    String code = c.code() == null ? null : c.code().strip().toUpperCase(Locale.ROOT);
    if (creating || code != null) {
      if (code == null || code.isEmpty()) throw ApiException.invalidField("code", "REQUIRED", "A code is required.");
      if (!CODE.matcher(code).matches()) throw ApiException.invalidField("code", "FORMAT", "Use 2 to 30 letters, digits, dots, dashes or underscores.");
      boolean taken = Query.of(Product.class).filter("UPPER(self.code) = ?1", code).fetch(5).stream().anyMatch(p -> !p.getId().equals(id));
      if (taken) throw ApiException.invalidField("code", "DUPLICATE", "Another product already has this code.");
    }
    String name = c.name() == null ? null : c.name().strip();
    if (creating || name != null) {
      if (name == null || name.isEmpty()) throw ApiException.invalidField("name", "REQUIRED", "A name is required.");
      if (name.length() > 255) throw ApiException.invalidField("name", "TOO_LONG", "The name can have at most 255 characters.");
    }
    String summary = c.summary() == null || c.summary().isBlank() ? null : c.summary().strip();
    if (summary != null && summary.length() > 2000) throw ApiException.invalidField("summary", "TOO_LONG", "The summary can have at most 2000 characters.");
    String type = c.type() == null ? null : c.type().strip().toLowerCase(Locale.ROOT);
    if (type != null && !type.equals(ProductRepository.PRODUCT_TYPE_SERVICE) && !type.equals(ProductRepository.PRODUCT_TYPE_STORABLE)) {
      throw ApiException.invalidField("type", "UNAVAILABLE", "Choose a service or a product.");
    }
    Unit unit = null;
    if (c.unitId() instanceof Number n) {
      unit = JPA.find(Unit.class, n.longValue());
      if (unit == null) throw ApiException.invalidField("unitId", "UNAVAILABLE", "Choose an existing unit.");
    }
    ProductCategory category = null;
    if (c.categoryId() instanceof Number n) {
      category = JPA.find(ProductCategory.class, n.longValue());
      if (category == null) throw ApiException.invalidField("categoryId", "UNAVAILABLE", "Choose an existing category.");
    }
    BigDecimal price = c.salePrice();
    if (price != null && (price.signum() < 0 || price.scale() > 2 || price.compareTo(new BigDecimal("1000000000000")) >= 0)) {
      throw ApiException.invalidField("salePrice", "RANGE", "Enter a price of zero or more with at most two decimals.");
    }
    if (creating && price == null) throw ApiException.invalidField("salePrice", "REQUIRED", "A price before tax is required.");
    Currency currency = null;
    if (c.currencyCode() != null && !c.currencyCode().isBlank()) {
      String iso = c.currencyCode().strip().toUpperCase(Locale.ROOT);
      if (ISO.matcher(iso).matches()) currency = Query.of(Currency.class).filter("self.codeISO = ?1", iso).fetchOne();
      if (currency == null) throw ApiException.invalidField("currencyCode", "UNKNOWN", "Choose an existing currency.");
    } else if (creating) {
      throw ApiException.invalidField("currencyCode", "REQUIRED", "A currency is required.");
    }
    LocalDate start = date("startDate", c.startDate()), end = date("endDate", c.endDate());
    if (start != null && end != null && end.isBefore(start)) throw ApiException.invalidField("endDate", "BEFORE_START", "The end date is before the start date.");
    return new ServiceFields(code, name, summary, type, unit, price, currency, category, c.onSale(), start, end);
  }

  private static LocalDate date(String field, String value) {
    if (value == null || value.isBlank()) return null;
    try { return LocalDate.parse(value.strip()); }
    catch (DateTimeParseException e) { throw ApiException.invalidField(field, "FORMAT", "Use a date like 2026-12-31."); }
  }

  /**
   * Whether finance set a revenue account for this service (needed to invoice it): in the caller's active
   * company, or in any company when the caller has none.
   */
  static boolean accountingReady(Product product) {
    User me = AuthUtils.getUser();
    Company company = me == null ? null : me.getActiveCompany();
    if (company == null) {
      return Query.of(AccountManagement.class).filter("self.product = ?1 AND self.saleAccount IS NOT NULL", product).count() > 0;
    }
    return Query.of(AccountManagement.class)
        .filter("self.product = ?1 AND self.company = ?2 AND self.saleAccount IS NOT NULL", product, company).count() > 0;
  }

  static ServiceView service(Product p) {
    return new ServiceView(p.getId(), p.getVersion(), p.getCode(), p.getName(), p.getDescription(), p.getProductTypeSelect(),
        p.getUnit() == null ? null : p.getUnit().getId(), p.getUnit() == null ? null : p.getUnit().getName(), p.getSalePrice(),
        p.getSaleCurrency() == null ? null : p.getSaleCurrency().getCodeISO(), Boolean.TRUE.equals(p.getSellable()),
        p.getProductCategory() == null ? null : p.getProductCategory().getId(),
        p.getProductCategory() == null ? null : p.getProductCategory().getName(), p.getStartDate(), p.getEndDate(), accountingReady(p));
  }

  static ProductView view(Product product) {
    return new ProductView(
        product.getId(),
        product.getCode(),
        product.getName(),
        product.getUnit() == null ? null : product.getUnit().getName(),
        product.getSalePrice(),
        product.getSaleCurrency() == null ? null : product.getSaleCurrency().getCode());
  }

  /** unitId and categoryId: a number chooses, an empty string clears, missing leaves as is. */
  public record EditService(Integer version, String code, String name, String summary, String type, Object unitId, BigDecimal salePrice,
      String currencyCode, Object categoryId, Boolean onSale, String startDate, String endDate) {}

  public record ServiceView(Long id, Integer version, String code, String name, String summary, String type, Long unitId, String unit,
      BigDecimal salePrice, String currencyCode, boolean onSale, Long categoryId, String category, LocalDate startDate, LocalDate endDate,
      boolean accountingReady) {}

  public record CatalogOption(Long id, String name) {}

  public record ProductView(
      Long id, String code, String name, String unit, BigDecimal salePrice, String currency) {}
}
