package com.ioeti.businessline.rest;

import com.axelor.apps.crm.db.Opportunity;
import com.axelor.apps.crm.db.repo.OpportunityRepository;
import com.axelor.apps.crm.service.OpportunityService;
import com.axelor.auth.AuthUtils;
import com.axelor.db.JpaSecurity;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.axelor.rpc.filter.Filter;
import com.axelor.utils.api.ConflictChecker;
import com.axelor.utils.api.HttpExceptionHandler;
import com.axelor.utils.api.ResponseConstructor;
import com.axelor.utils.api.SecurityCheck;
import com.ioeti.businessline.db.BusinessLine;
import com.ioeti.businessline.db.repo.BusinessLineRepository;
import com.ioeti.core.web.OptimisticLockConflicts;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.List;
import java.util.Locale;

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
  @HttpExceptionHandler
  public Response list(@QueryParam("limit") Integer requestedLimit, @QueryParam("offset") Integer requestedOffset) {
    new SecurityCheck().readAccess(Opportunity.class).check();
    int limit = requestedLimit == null ? 25 : requestedLimit;
    int offset = requestedOffset == null ? 0 : requestedOffset;
    if (limit < 1 || limit > MAX_PAGE_SIZE || offset < 0 || offset > 10000) {
      throw new BadRequestException("Invalid pagination parameters.");
    }
    Query<Opportunity> query = readableOpportunities().order("-id");
    List<OpportunityView> items = query.fetch(limit, offset).stream().map(this::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Opportunities", items);
  }

  @GET
  @Path("/{id}")
  @Operation(summary = "Read an opportunity only when authorized for this record", tags = {"IOETI opportunities"})
  @HttpExceptionHandler
  public Response get(@PathParam("id") Long id) {
    Opportunity opportunity = Beans.get(OpportunityRepository.class).find(id);
    if (opportunity == null) throw new NotFoundException();
    new SecurityCheck().readAccess(Opportunity.class, id).check();
    return ResponseConstructor.build(Response.Status.OK, "Opportunity", view(opportunity));
  }

  @POST
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Create a minimal new opportunity with native Axelor business rules", tags = {"IOETI opportunities"})
  @HttpExceptionHandler
  public Response create(CreateOpportunity command) {
    new SecurityCheck().createAccess(Opportunity.class).check();
    String name = checkName(command == null ? null : command.name());
    String code = command == null ? null : command.businessLineCode();
    BusinessLine line = checkedLine(code);
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
  @HttpExceptionHandler
  public Response rename(@PathParam("id") Long id, RenameOpportunity command) {
    if (command == null || command.version() == null) {
      throw new BadRequestException("Record version is required.");
    }
    new SecurityCheck().writeAccess(Opportunity.class, id).check();
    Opportunity opportunity = Beans.get(OpportunityRepository.class).find(id);
    if (opportunity == null) throw new NotFoundException();
    // Stale client version: native AOS check, ClientErrorException(409).
    ConflictChecker.checkVersion(opportunity, command.version());
    opportunity.setName(checkName(command.name()));
    // Another writer committed after the check: saveOpportunity is @Transactional and commits on
    // return, so the versioned UPDATE fails here and is answered with 409 instead of 500.
    OptimisticLockConflicts.translate(
      () -> Beans.get(OpportunityService.class).saveOpportunity(opportunity));
    return ResponseConstructor.build(Response.Status.OK, "Opportunity updated", view(opportunity));
  }

  private BusinessLine checkedLine(String rawCode) {
    if (rawCode == null || rawCode.isBlank()) {
      throw new BadRequestException("Business line is required.");
    }
    String code = rawCode.trim().toUpperCase(Locale.ROOT);
    BusinessLine line = Beans.get(BusinessLineRepository.class).all()
      .filter("self.code = :code").bind("code", code).fetchOne();
    if (line == null) throw new BadRequestException("Unknown business line.");
    new SecurityCheck().readAccess(BusinessLine.class, line.getId()).check();
    if (!Integer.valueOf(BusinessLineRepository.STATUS_ACTIVE).equals(line.getStatusSelect())) {
      throw new BadRequestException("Business line is not active.");
    }
    return line;
  }

  private static String checkName(String name) {
    String value = name == null ? "" : name.trim();
    if (value.length() < 3 || value.length() > 160) {
      throw new BadRequestException("Opportunity name must be between 3 and 160 characters.");
    }
    return value;
  }

  private Query<Opportunity> readableOpportunities() {
    Filter filter = Beans.get(JpaSecurity.class).getFilter(JpaSecurity.CAN_READ, Opportunity.class);
    return filter == null ? Query.of(Opportunity.class) : filter.build(Opportunity.class);
  }

  private OpportunityView view(Opportunity opportunity) {
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
