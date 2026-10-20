package com.ioeti.businessline.rest;

import com.axelor.apps.base.db.Partner;
import com.axelor.apps.crm.db.Opportunity;
import com.axelor.db.JpaSecurity;
import com.axelor.inject.Beans;
import com.axelor.rpc.filter.Filter;
import com.axelor.rpc.filter.JPQLFilter;
import com.axelor.utils.api.ResponseConstructor;
import com.axelor.utils.api.SecurityCheck;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.IoetiEndpoint;
import com.ioeti.core.api.RecordAccess;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
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

  private static final int MAX_RELATED = 50;

  /** Client accounts only; applied in the query so pages are full and counts are honest. */
  static final String CLIENT_ACCOUNT_JPQL =
      "(self.isCustomer = true OR self.isProspect = true)"
          + " AND (self.isInternal IS NULL OR self.isInternal = false)"
          + " AND (self.isEmployee IS NULL OR self.isEmployee = false)"
          + " AND (self.isContact IS NULL OR self.isContact = false)";

  static boolean isClientAccount(Partner partner) {
    return !Boolean.TRUE.equals(partner.getIsInternal())
      && !Boolean.TRUE.equals(partner.getIsEmployee())
      && !Boolean.TRUE.equals(partner.getIsContact())
      && (Boolean.TRUE.equals(partner.getIsCustomer()) || Boolean.TRUE.equals(partner.getIsProspect()));
  }

  @GET
  @Operation(summary = "List accessible customer/prospect accounts, not all partners", tags = {"IOETI accounts"})
  @IoetiEndpoint
  public Response list(@QueryParam("limit") Integer requestedLimit, @QueryParam("offset") Integer requestedOffset) {
    new SecurityCheck().readAccess(Partner.class).check();
    int limit = requestedLimit == null ? 25 : requestedLimit;
    int offset = requestedOffset == null ? 0 : requestedOffset;
    if (limit < 1 || limit > 50 || offset < 0 || offset > 10000) {
      throw ApiException.badRequest("Invalid pagination parameters.");
    }
    Filter clients = new JPQLFilter(CLIENT_ACCOUNT_JPQL);
    Filter security = Beans.get(JpaSecurity.class).getFilter(JpaSecurity.CAN_READ, Partner.class);
    Filter condition = security == null ? clients : Filter.and(security, clients);
    List<AccountView> records = condition.build(Partner.class).order("-id").fetch(limit, offset).stream()
        .map(this::project).toList();
    return ResponseConstructor.build(Response.Status.OK, "Customer accounts", records);
  }

  @GET
  @Path("/{id}")
  @Operation(summary = "Read one external client account with record checks", tags = {"IOETI accounts"})
  @IoetiEndpoint
  public Response get(@PathParam("id") Long id) {
    // non-client partners are not part of this API: same answer as an unknown id
    Partner partner = clientAccount(id);
    return ResponseConstructor.build(Response.Status.OK, "Customer account", project(partner));
  }

  @GET
  @Path("/{id}/contacts")
  @Operation(summary = "Account 360: the account's contacts the caller may read", tags = {"IOETI accounts"})
  @IoetiEndpoint
  public Response contacts(@PathParam("id") Long id) {
    Partner account = clientAccount(id);
    Filter ofAccount = new JPQLFilter(
        "self.isContact = true AND self.mainPartner.id = " + account.getId());
    Filter security = Beans.get(JpaSecurity.class).getFilter(JpaSecurity.CAN_READ, Partner.class);
    Filter condition = security == null ? ofAccount : Filter.and(security, ofAccount);
    List<ContactView> records = condition.build(Partner.class).order("id").fetch(MAX_RELATED).stream()
        .map(c -> new ContactView(c.getId(), c.getFullName() == null ? c.getName() : c.getFullName(),
            c.getJobTitleFunction() == null ? null : c.getJobTitleFunction().getName()))
        .toList();
    return ResponseConstructor.build(Response.Status.OK, "Account contacts", records);
  }

  @GET
  @Path("/{id}/opportunities")
  @Operation(summary = "Account 360: the account's opportunities in the caller's scope", tags = {"IOETI accounts"})
  @IoetiEndpoint
  public Response opportunities(@PathParam("id") Long id) {
    Partner account = clientAccount(id);
    if (!Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, Opportunity.class)) {
      // no opportunity rights at all: an empty tab, not an error on the account page
      return ResponseConstructor.build(Response.Status.OK, "Account opportunities", List.of());
    }
    Filter ofAccount = new JPQLFilter("self.partner.id = " + account.getId());
    Filter security = Beans.get(JpaSecurity.class).getFilter(JpaSecurity.CAN_READ, Opportunity.class);
    Filter condition = security == null ? ofAccount : Filter.and(security, ofAccount);
    List<OpportunityRestController.OpportunityView> records = condition.build(Opportunity.class)
        .order("-id").fetch(MAX_RELATED).stream().map(OpportunityRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Account opportunities", records);
  }

  private Partner clientAccount(Long id) {
    Partner partner = RecordAccess.readable(Partner.class, id);
    if (!isClientAccount(partner)) throw ApiException.notFound();
    return partner;
  }

  private AccountView project(Partner partner) {
    return new AccountView(partner.getId(), partner.getName(), partner.getPartnerSeq(),
      Boolean.TRUE.equals(partner.getIsCustomer()),
      Boolean.TRUE.equals(partner.getIsProspect()));
  }

  public record ContactView(Long id, String name, String jobTitle) {}
  public record AccountView(Long id, String name, String reference, boolean customer, boolean prospect) {}
}
