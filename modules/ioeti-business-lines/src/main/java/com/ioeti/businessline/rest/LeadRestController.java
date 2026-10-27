package com.ioeti.businessline.rest;

import com.axelor.apps.base.AxelorException;
import com.axelor.apps.base.db.Partner;
import com.axelor.apps.crm.db.Lead;
import com.axelor.apps.crm.db.Opportunity;
import com.axelor.apps.crm.service.app.AppCrmService;
import com.axelor.auth.AuthUtils;
import com.axelor.db.JPA;
import com.axelor.db.JpaSecurity;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.axelor.rpc.filter.Filter;
import com.axelor.rpc.filter.JPQLFilter;
import com.axelor.utils.api.ConflictChecker;
import com.axelor.utils.api.ResponseConstructor;
import com.axelor.utils.api.SecurityCheck;
import com.ioeti.businessline.db.BusinessLine;
import com.ioeti.businessline.service.LeadConversionService;
import com.ioeti.core.api.ApiException;
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
import java.util.List;

/**
 * Lead explorer and the Lead → Account + Opportunity conversion command for the IOETI custom UI.
 * Fields deliberately exclude contact details and sensitive notes.
 */
@Path("/ioeti/leads")
@Produces(MediaType.APPLICATION_JSON)
public class LeadRestController {
  @GET
  @Operation(summary = "Read authorized leads using the existing Axelor CRM model", tags = {"IOETI leads"})
  @IoetiEndpoint
  public Response list(@QueryParam("limit") Integer requestedLimit, @QueryParam("offset") Integer requestedOffset) {
    new SecurityCheck().readAccess(Lead.class).check();
    int limit = requestedLimit == null ? 25 : requestedLimit;
    int offset = requestedOffset == null ? 0 : requestedOffset;
    if (limit < 1 || limit > 50 || offset < 0 || offset > 10000) {
      throw ApiException.badRequest("Invalid pagination parameters.");
    }
    Filter condition = Beans.get(JpaSecurity.class).getFilter(JpaSecurity.CAN_READ, Lead.class);
    Query<Lead> query = condition == null ? Query.of(Lead.class) : condition.build(Lead.class);
    List<LeadView> records = query.order("-id").fetch(limit, offset).stream().map(this::project).toList();
    return ResponseConstructor.build(Response.Status.OK, "Leads", records);
  }

  @GET
  @Path("/{id}")
  @Operation(summary = "Read one lead with record-level permission checks", tags = {"IOETI leads"})
  @IoetiEndpoint
  public Response get(@PathParam("id") Long id) {
    // unknown and unreadable ids answer the same 404 (no existence oracle)
    Lead lead = RecordAccess.readable(Lead.class, id);
    return ResponseConstructor.build(Response.Status.OK, "Lead", project(lead));
  }

  @POST
  @Path("/{id}/convert")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(
      summary = "Convert a lead into an account (+ contact) and an opportunity, atomically",
      tags = {"IOETI leads"})
  @IoetiEndpoint
  public Response convert(@PathParam("id") Long id, ConvertLead command) {
    if (command == null || command.version() == null) {
      throw ApiException.badRequest("Record version is required.");
    }
    Lead lead = RecordAccess.writable(Lead.class, id);
    ConflictChecker.checkVersion(lead, command.version());
    if (Boolean.TRUE.equals(lead.getIsConverted())) {
      throw new ApiException(409, "ALREADY_CONVERTED", "This lead has already been converted.", null);
    }
    SecurityCheck access = new SecurityCheck().createAccess(Opportunity.class);
    if (command.accountId() == null) access = access.createAccess(Partner.class);
    access.check();
    if (Boolean.TRUE.equals(Beans.get(AppCrmService.class).getAppCrm().getCrmProcessOnPartner())) {
      // that mode needs a partner status chosen by the user; this command does not ask for one
      throw new ApiException(
          422, "CONVERSION_UNSUPPORTED", "Lead conversion is configured to run from the account form.", null);
    }
    Partner account = command.accountId() == null ? null : existingAccount(command.accountId());
    String code = command.businessLineCode();
    if ((code == null || code.isBlank()) && lead.getIoetiBusinessLine() != null) {
      code = lead.getIoetiBusinessLine().getCode();
    }
    BusinessLine line = LineSelection.eligible(code);
    String name = OpportunityRestController.checkName(
        command.opportunityName() == null || command.opportunityName().isBlank()
            ? defaultOpportunityName(lead) : command.opportunityName());

    LeadConversionService.Result[] result = new LeadConversionService.Result[1];
    // convert() is @Transactional and commits on return: a concurrent conversion that committed
    // first makes the lead's versioned UPDATE fail here, and everything this one created rolls back.
    OptimisticLockConflicts.translate(() -> {
      try {
        result[0] = Beans.get(LeadConversionService.class)
            .convert(lead, account, name, line, AuthUtils.getUser());
      } catch (AxelorException e) {
        // native business rule (e.g. a lost lead, an incomplete address): safe message only
        throw new ApiException(
            422, "CONVERSION_REJECTED", "This lead cannot be converted in its current state.", null);
      }
    });
    LeadConversionService.Result converted = result[0];
    return ResponseConstructor.build(Response.Status.CREATED, "Lead converted",
        new ConversionView(
            lead.getId(),
            converted.account().getId(),
            converted.contact() == null ? null : converted.contact().getId(),
            converted.opportunity().getId()));
  }

  /** Unknown, unreadable, read-only and non-client partners are rejected identically (no oracle). */
  private Partner existingAccount(Long accountId) {
    JpaSecurity security = Beans.get(JpaSecurity.class);
    Partner partner = accountId <= 0 ? null : JPA.find(Partner.class, accountId);
    if (partner == null
        || !security.isPermitted(JpaSecurity.CAN_READ, Partner.class, accountId)
        || !security.isPermitted(JpaSecurity.CAN_WRITE, Partner.class, accountId)
        || !AccountRestController.isClientAccount(partner)) {
      throw ApiException.invalidField(
          "accountId", "UNAVAILABLE", "Choose a customer or prospect account you can edit.");
    }
    return partner;
  }

  private static String defaultOpportunityName(Lead lead) {
    String organization = lead.getEnterpriseName();
    if (organization != null && !organization.isBlank()) return organization;
    return lead.getFullName() == null || lead.getFullName().isBlank() ? lead.getName() : lead.getFullName();
  }

  private LeadView project(Lead lead) {
    JpaSecurity security = Beans.get(JpaSecurity.class);
    BusinessLine line = lead.getIoetiBusinessLine();
    Partner account = lead.getPartner();
    Opportunity opportunity = Boolean.TRUE.equals(lead.getIsConverted()) ? originOpportunity(lead) : null;
    return new LeadView(
      lead.getId(),
      lead.getVersion(),
      lead.getFullName() == null || lead.getFullName().isBlank() ? lead.getName() : lead.getFullName(),
      lead.getEnterpriseName(),
      lead.getLeadStatus() == null ? null : lead.getLeadStatus().getName(),
      Boolean.TRUE.equals(lead.getIsConverted()),
      line != null && security.isPermitted(JpaSecurity.CAN_READ, BusinessLine.class, line.getId())
          ? line.getCode() : null,
      account != null && security.isPermitted(JpaSecurity.CAN_READ, Partner.class, account.getId())
          ? account.getId() : null,
      opportunity == null ? null : opportunity.getId()
    );
  }

  /** The opportunity this lead was converted into, if the caller may read it. */
  private static Opportunity originOpportunity(Lead lead) {
    Filter origin = new JPQLFilter("self.ioetiOriginLead.id = " + lead.getId());
    Filter security = Beans.get(JpaSecurity.class).getFilter(JpaSecurity.CAN_READ, Opportunity.class);
    Filter condition = security == null ? origin : Filter.and(security, origin);
    return condition.build(Opportunity.class).order("id").fetchOne();
  }

  public record ConvertLead(Integer version, String opportunityName, String businessLineCode, Long accountId) {}
  public record ConversionView(Long leadId, Long accountId, Long contactId, Long opportunityId) {}
  public record LeadView(
    Long id, Integer version, String name, String organization, String stage,
    boolean converted, String businessLineCode, Long accountId, Long opportunityId) {}
}
