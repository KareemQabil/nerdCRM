package com.ioeti.businessline.rest;

import com.axelor.apps.base.db.Partner;
import com.axelor.utils.api.ConflictChecker;
import com.ioeti.businessline.service.AccountCommands;
import com.ioeti.businessline.service.AccountCommands.AccountInput;
import com.ioeti.businessline.service.AccountCommands.ContactInput;
import com.ioeti.core.text.ArabicNormalizer;
import com.ioeti.core.web.OptimisticLockConflicts;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
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
 *
 * <p>Accounts and contacts can also be created and changed here directly (journeys plan, phase 2).
 * Contact details are written but never returned; a new account whose normalised name matches a readable
 * account must be confirmed first (409), like a lead.
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

  @POST
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Add a client account (prospect); a similar readable account must be confirmed first (409)", tags = {"IOETI accounts"})
  @IoetiEndpoint
  public Response create(EditAccount command) {
    if (command == null) throw ApiException.badRequest("Account details are required.");
    new SecurityCheck().createAccess(Partner.class).check();
    AccountInput input = new AccountInput(AccountCommands.text("name", command.name(), 255, true),
        AccountCommands.text("website", command.website(), 255, false), AccountCommands.phone(command.phone()), AccountCommands.email(command.email()));
    if (!Boolean.TRUE.equals(command.confirmNotDuplicate()) && !similar(input.name(), null).isEmpty()) {
      throw new ApiException(409, "POSSIBLE_DUPLICATE", "A similar account exists; open it or confirm this is a different one.", null);
    }
    Partner[] saved = new Partner[1];
    OptimisticLockConflicts.translate(() -> saved[0] = Beans.get(AccountCommands.class).createAccount(input));
    return ResponseConstructor.build(Response.Status.CREATED, "Account added", project(saved[0]));
  }

  @POST
  @Path("/similar")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Readable client accounts whose normalised name looks like this one", tags = {"IOETI accounts"})
  @IoetiEndpoint
  public Response similarAccounts(EditAccount command) {
    if (command == null) throw ApiException.badRequest("Account details are required.");
    new SecurityCheck().readAccess(Partner.class).check();
    return ResponseConstructor.build(Response.Status.OK, "Similar accounts",
        similar(AccountCommands.text("name", command.name(), 255, true), null).stream().map(this::project).toList());
  }

  @POST
  @Path("/{id}")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Change an account's name, website, phone or e-mail (record write access and version)", tags = {"IOETI accounts"})
  @IoetiEndpoint
  public Response update(@PathParam("id") Long id, EditAccount command) {
    if (command == null || command.version() == null) throw ApiException.badRequest("Record version is required.");
    Partner account = writableAccount(id);
    ConflictChecker.checkVersion(account, command.version());
    AccountInput input = new AccountInput(AccountCommands.text("name", command.name(), 255, false),
        AccountCommands.text("website", command.website(), 255, false), AccountCommands.phone(command.phone()), AccountCommands.email(command.email()));
    OptimisticLockConflicts.translate(() -> Beans.get(AccountCommands.class)
        .updateAccount(account, input, command.website() != null, command.phone() != null, command.email() != null));
    return ResponseConstructor.build(Response.Status.OK, "Account saved", project(RecordAccess.readable(Partner.class, id)));
  }

  @POST
  @Path("/{id}/contacts")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Add a contact person to an account (write access on the account, create on partners)", tags = {"IOETI accounts"})
  @IoetiEndpoint
  public Response addContact(@PathParam("id") Long id, AddContact command) {
    if (command == null || command.version() == null) throw ApiException.badRequest("Record version is required.");
    Partner account = writableAccount(id);
    new SecurityCheck().createAccess(Partner.class).check();
    ConflictChecker.checkVersion(account, command.version());
    ContactInput input = new ContactInput(AccountCommands.text("firstName", command.firstName(), 255, false),
        AccountCommands.text("name", command.name(), 255, true), AccountCommands.phone(command.phone()), AccountCommands.email(command.email()));
    Partner[] saved = new Partner[1];
    OptimisticLockConflicts.translate(() -> saved[0] = Beans.get(AccountCommands.class).addContact(account, input));
    Partner c = saved[0];
    return ResponseConstructor.build(Response.Status.CREATED, "Contact added",
        new ContactView(c.getId(), c.getFullName() == null ? c.getName() : c.getFullName(), null));
  }

  private Partner writableAccount(Long id) {
    Partner account = RecordAccess.writable(Partner.class, id);
    if (!isClientAccount(account)) throw ApiException.notFound();
    return account;
  }

  /** Readable client accounts with the same normalised name (at most 5), optionally excluding one. */
  private List<Partner> similar(String name, Long except) {
    String key = ArabicNormalizer.normalize(name);
    if (key.isEmpty()) return List.of();
    Filter clients = new JPQLFilter(CLIENT_ACCOUNT_JPQL);
    Filter security = Beans.get(JpaSecurity.class).getFilter(JpaSecurity.CAN_READ, Partner.class);
    Filter condition = security == null ? clients : Filter.and(security, clients);
    return condition.build(Partner.class).order("-id").fetch(2000).stream()
        .filter(p -> !p.getId().equals(except) && ArabicNormalizer.normalize(p.getName()).equals(key))
        .limit(5).toList();
  }

  private Partner clientAccount(Long id) {
    Partner partner = RecordAccess.readable(Partner.class, id);
    if (!isClientAccount(partner)) throw ApiException.notFound();
    return partner;
  }

  private AccountView project(Partner partner) {
    return new AccountView(partner.getId(), partner.getVersion(), partner.getName(), partner.getPartnerSeq(),
      Boolean.TRUE.equals(partner.getIsCustomer()),
      Boolean.TRUE.equals(partner.getIsProspect()));
  }

  public record ContactView(Long id, String name, String jobTitle) {}
  public record AccountView(Long id, Integer version, String name, String reference, boolean customer, boolean prospect) {}
  public record EditAccount(Integer version, String name, String website, String phone, String email, Boolean confirmNotDuplicate) {}
  public record AddContact(Integer version, String firstName, String name, String phone, String email) {}
}
