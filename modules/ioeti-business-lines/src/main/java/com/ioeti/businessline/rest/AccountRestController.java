package com.ioeti.businessline.rest;

import com.axelor.apps.base.db.Partner;
import com.axelor.db.JpaSecurity;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.axelor.rpc.filter.Filter;
import com.axelor.utils.api.HttpExceptionHandler;
import com.axelor.utils.api.ResponseConstructor;
import com.axelor.utils.api.SecurityCheck;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.List;

/**
 * Customer/prospect account directory. Explicitly excludes internal, HR, vendor-only and
 * contact-only Partner records; no financial, banking, national ID or other sensitive fields.
 */
@Path("/ioeti/accounts")
@Produces(MediaType.APPLICATION_JSON)
public class AccountRestController {
  private boolean isClientAccount(Partner partner) {
    return !Boolean.TRUE.equals(partner.getIsInternal())
      && !Boolean.TRUE.equals(partner.getIsEmployee())
      && !Boolean.TRUE.equals(partner.getIsContact())
      && (Boolean.TRUE.equals(partner.getIsCustomer()) || Boolean.TRUE.equals(partner.getIsProspect()));
  }

  @GET
  @Operation(summary = "List accessible customer/prospect accounts, not all partners", tags = {"IOETI accounts"})
  @HttpExceptionHandler
  public Response list(@QueryParam("limit") Integer requestedLimit, @QueryParam("offset") Integer requestedOffset) {
    new SecurityCheck().readAccess(Partner.class).check();
    int limit = requestedLimit == null ? 25 : requestedLimit;
    int offset = requestedOffset == null ? 0 : requestedOffset;
    if (limit < 1 || limit > 50 || offset < 0 || offset > 10000) {
      throw new BadRequestException("Invalid pagination parameters");
    }
    Filter condition = Beans.get(JpaSecurity.class).getFilter(JpaSecurity.CAN_READ, Partner.class);
    Query<Partner> query = condition == null ? Query.of(Partner.class) : condition.build(Partner.class);
    // Restrict to a bounded, ACL-filtered candidate window before mapping. Some windows may
    // return < limit results because internal/vendor/contact-only partners are filtered out.
    List<AccountView> records = query.order("-id").fetch(limit, offset).stream()
        .filter(this::isClientAccount).map(this::project).toList();
    return ResponseConstructor.build(Response.Status.OK, "Customer accounts", records);
  }

  @GET
  @Path("/{id}")
  @Operation(summary = "Read one external client account with record checks", tags = {"IOETI accounts"})
  @HttpExceptionHandler
  public Response get(@PathParam("id") Long id) {
    new SecurityCheck().readAccess(Partner.class, id).check();
    // For detail, use ID-based read after explicit ACL check.
    Partner partner = Beans.get(com.axelor.apps.base.db.repo.PartnerRepository.class).find(id);
    if (partner == null || !isClientAccount(partner)) throw new NotFoundException();
    return ResponseConstructor.build(Response.Status.OK, "Customer account", project(partner));
  }

  private AccountView project(Partner partner) {
    return new AccountView(partner.getId(), partner.getName(), partner.getPartnerSeq(),
      Boolean.TRUE.equals(partner.getIsCustomer()),
      Boolean.TRUE.equals(partner.getIsProspect()));
  }

  public record AccountView(Long id, String name, String reference, boolean customer, boolean prospect) {}
}
