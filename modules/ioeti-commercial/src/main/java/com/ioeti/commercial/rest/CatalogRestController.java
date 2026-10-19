package com.ioeti.commercial.rest;

import com.axelor.apps.base.db.Product;
import com.axelor.db.JpaSecurity;
import com.axelor.inject.Beans;
import com.axelor.rpc.filter.Filter;
import com.axelor.rpc.filter.JPQLFilter;
import com.axelor.utils.api.ResponseConstructor;
import com.axelor.utils.api.SecurityCheck;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.IoetiEndpoint;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.math.BigDecimal;
import java.util.List;
import java.util.Locale;

/**
 * Sellable catalog for quotations: native AOS {@code Product} records, read with the caller's
 * permissions. No cost price, supplier or stock data.
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
      @QueryParam("offset") Integer requestedOffset) {
    new SecurityCheck().readAccess(Product.class).check();
    int limit = requestedLimit == null ? 25 : requestedLimit;
    int offset = requestedOffset == null ? 0 : requestedOffset;
    if (limit < 1 || limit > 50 || offset < 0 || offset > 10000) {
      throw ApiException.badRequest("Invalid pagination parameters.");
    }
    String text = search == null ? "" : search.trim();
    if (text.length() > 80) {
      throw ApiException.invalidField("q", "LENGTH", "Search text must be at most 80 characters.");
    }
    Filter condition = new JPQLFilter(SELLABLE_JPQL);
    if (!text.isEmpty()) {
      String pattern = "%" + text.toLowerCase(Locale.ROOT).replace("%", "").replace("_", "") + "%";
      condition = Filter.and(condition,
          new JPQLFilter("LOWER(self.name) LIKE ? OR LOWER(self.code) LIKE ?", pattern, pattern));
    }
    // the security filter goes first: its positional parameters come before ours
    Filter security = Beans.get(JpaSecurity.class).getFilter(JpaSecurity.CAN_READ, Product.class);
    if (security != null) condition = Filter.and(security, condition);
    List<ProductView> records = condition.build(Product.class).order("name").fetch(limit, offset)
        .stream().map(CatalogRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Catalog products", records);
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

  public record ProductView(
      Long id, String code, String name, String unit, BigDecimal salePrice, String currency) {}
}
