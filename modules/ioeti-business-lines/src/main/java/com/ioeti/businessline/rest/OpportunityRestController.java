package com.ioeti.businessline.rest;

import com.axelor.apps.crm.db.Opportunity;
import com.axelor.apps.crm.service.OpportunityService;
import com.axelor.auth.AuthUtils;
import com.axelor.db.JpaSecurity;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.axelor.rpc.filter.Filter;
import com.axelor.utils.api.ConflictChecker;
import com.axelor.utils.api.ResponseConstructor;
import com.axelor.utils.api.SecurityCheck;
import com.ioeti.businessline.db.BusinessLine;
import com.ioeti.businessline.db.repo.BusinessLineRepository;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.IoetiEndpoint;
import com.ioeti.core.api.RecordAccess;
import com.ioeti.core.web.OptimisticLockConflicts;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.List;

/**
 * Small, allowlisted CRM contract used by the custom IOETI UI.
 *
 * Never serializes an Axelor entity or makes the unrestricted /ws/rest surface a
 * frontend dependency. Domain rules run in OpportunityService and the native
 * Opportunity JPA listener.
 */
@Path("/ioeti/opportunities")
@Produces(MediaType.APPLICATION_JSON)
public class OpportunityRestController {

  private static final int MAX_PAGE_SIZE = 50;

  @GET
  @Operation(summary = "List visible opportunities (bounded result)", tags = {"IOETI opportunities"})
  @IoetiEndpoint
  public Response list(@QueryParam("limit") Integer requestedLimit, @QueryParam("offset") Integer requestedOffset) {
    new SecurityCheck().readAccess(Opportunity.class).check();
    int limit = requestedLimit == null ? 25 : requestedLimit;
    int offset = requestedOffset == null ? 0 : requestedOffset;
    if (limit < 1 || limit > MAX_PAGE_SIZE || offset < 0 || offset > 10000) {
      throw ApiException.badRequest("Invalid pagination parameters.");
    }
    Query<Opportunity> query = readableOpportunities().order("-id");
    List<OpportunityView> items = query.fetch(limit, offset).stream().map(OpportunityRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Opportunities", items);
  }

  @GET
  @Path("/{id}")
  @Operation(summary = "Read an opportunity only when authorized for this record", tags = {"IOETI opportunities"})
  @IoetiEndpoint
  public Response get(@PathParam("id") Long id) {
    // unknown and unreadable ids answer the same 404 (no existence oracle)
    Opportunity opportunity = RecordAccess.readable(Opportunity.class, id);
    return ResponseConstructor.build(Response.Status.OK, "Opportunity", view(opportunity));
  }

  @POST
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Create a minimal new opportunity with native Axelor business rules", tags = {"IOETI opportunities"})
  @IoetiEndpoint
  public Response create(CreateOpportunity command) {
    if (command == null) throw ApiException.badRequest("Request body is required.");
    new SecurityCheck().createAccess(Opportunity.class).check();
    String name = checkName(command == null ? null : command.name());
    String code = command == null ? null : command.businessLineCode();
    BusinessLine line = LineSelection.eligible(code);
    Opportunity opportunity = new Opportunity();
    opportunity.setName(name);
    opportunity.setIoetiBusinessLine(line);
    opportunity.setUser(AuthUtils.getUser());
    // Calls the existing Axelor service, not a direct generic REST create.
    // Existing IOETI JPA listener rejects suspended lines at persistence time.
    Beans.get(OpportunityService.class).saveOpportunity(opportunity);
    return ResponseConstructor.build(Response.Status.CREATED, "Opportunity created", view(opportunity));
  }

  @PUT
  @Path("/{id}")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Update an opportunity title with permission and version checks", tags = {"IOETI opportunities"})
  @IoetiEndpoint
  public Response rename(@PathParam("id") Long id, RenameOpportunity command) {
    if (command == null || command.version() == null) {
      throw ApiException.badRequest("Record version is required.");
    }
    Opportunity opportunity = RecordAccess.writable(Opportunity.class, id);
    // Stale client version: native AOS check, ClientErrorException(409).
    ConflictChecker.checkVersion(opportunity, command.version());
    opportunity.setName(checkName(command.name()));
    // Another writer committed after the check: saveOpportunity is @Transactional and commits on
    // return, so the versioned UPDATE fails here and is answered with 409 instead of 500.
    OptimisticLockConflicts.translate(
      () -> Beans.get(OpportunityService.class).saveOpportunity(opportunity));
    return ResponseConstructor.build(Response.Status.OK, "Opportunity updated", view(opportunity));
  }

  static String checkName(String name) {
    String value = name == null ? "" : name.trim();
    if (value.length() < 3 || value.length() > 160) {
      throw ApiException.invalidField("name", "LENGTH", "Opportunity name must be between 3 and 160 characters.");
    }
    return value;
  }

  private Query<Opportunity> readableOpportunities() {
    Filter filter = Beans.get(JpaSecurity.class).getFilter(JpaSecurity.CAN_READ, Opportunity.class);
    return filter == null ? Query.of(Opportunity.class) : filter.build(Opportunity.class);
  }

  static OpportunityView view(Opportunity opportunity) {
    BusinessLine line = opportunity.getIoetiBusinessLine();
    boolean canReadLine = line != null &&
      Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, BusinessLine.class, line.getId());
    return new OpportunityView(
      opportunity.getId(),
      opportunity.getVersion(),
      opportunity.getName(),
      opportunity.getOpportunitySeq(),
      canReadLine ? line.getCode() : null,
      canReadLine ? line.getNameAr() : null,
      canReadLine ? line.getNameEn() : null,
      opportunity.getOpportunityStatus() == null ? null : opportunity.getOpportunityStatus().getName());
  }

  public record CreateOpportunity(String name, String businessLineCode) {}
  public record RenameOpportunity(String name, Integer version) {}
  public record OpportunityView(
    Long id, Integer version, String name, String reference,
    String businessLineCode, String businessLineNameAr, String businessLineNameEn,
    String stage) {}
}
