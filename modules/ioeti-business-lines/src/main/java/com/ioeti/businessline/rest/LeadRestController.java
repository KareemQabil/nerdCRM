package com.ioeti.businessline.rest;

import com.axelor.apps.base.AxelorException;
import com.axelor.apps.base.db.Partner;
import com.axelor.apps.crm.db.Lead;
import com.axelor.apps.crm.db.LeadStatus;
import com.axelor.apps.crm.db.LostReason;
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
import com.ioeti.businessline.service.LeadLifecycleService;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.IoetiEndpoint;
import com.ioeti.core.api.NativeCommands;
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
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * Lead explorer, qualification commands (stage, lose, reopen, assign to me) and the Lead → Account +
 * Opportunity conversion command for the IOETI custom UI. Fields deliberately exclude contact
 * details and sensitive notes.
 *
 * <p>Stage and lost-reason lists are the lead's own vocabulary (the stage name is already part of
 * every lead view), so they follow lead read access. Response-time targets, escalation and routing
 * of leads to other people are open decisions D-12 and D-07: the API exposes when a lead was
 * received, and reassignment to another user fails closed.
 */
@Path("/ioeti/leads")
@Produces(MediaType.APPLICATION_JSON)
public class LeadRestController {
  static final int MAX_NOTE = 500;

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
    List<LeadView> records = query.order("-id").fetch(limit, offset).stream().map(LeadRestController::project).toList();
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

  @GET
  @Path("/stages")
  @Operation(summary = "Lead stages (native LeadStatus), in pipeline order", tags = {"IOETI leads"})
  @IoetiEndpoint
  public Response stages() {
    new SecurityCheck().readAccess(Lead.class).check();
    LeadLifecycleService lifecycle = Beans.get(LeadLifecycleService.class);
    List<StageView> stages = new ArrayList<>();
    for (LeadStatus status : Query.of(LeadStatus.class).order("sequence").order("id").fetch(100)) {
      String[] kind = new String[1];
      runNative(() -> kind[0] = lifecycle.kind(status));
      stages.add(new StageView(status.getId(), status.getName(), kind[0]));
    }
    return ResponseConstructor.build(Response.Status.OK, "Lead stages", stages);
  }

  @GET
  @Path("/lost-reasons")
  @Operation(summary = "Reasons a lead can be marked lost (native LostReason)", tags = {"IOETI leads"})
  @IoetiEndpoint
  public Response lostReasons() {
    new SecurityCheck().readAccess(Lead.class).check();
    List<ReasonView> reasons = Query.of(LostReason.class).order("name").fetch(100).stream()
        .map(r -> new ReasonView(r.getId(), r.getName())).toList();
    return ResponseConstructor.build(Response.Status.OK, "Lost reasons", reasons);
  }

  @POST
  @Path("/{id}/stage")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Move a lead to another open stage (native kanban rules)", tags = {"IOETI leads"})
  @IoetiEndpoint
  public Response moveStage(@PathParam("id") Long id, MoveStage command) {
    Lead lead = writableLead(id, command == null ? null : command.version());
    LeadLifecycleService lifecycle = Beans.get(LeadLifecycleService.class);
    LeadStatus target = command.stageId() == null || command.stageId() <= 0
        ? null : JPA.find(LeadStatus.class, command.stageId());
    boolean[] open = new boolean[1];
    if (target != null) runNative(() -> open[0] = lifecycle.isOpenStage(target));
    if (!open[0]) {
      // converting and losing have their own commands; unknown ids are refused the same way
      throw ApiException.invalidField("stageId", "UNAVAILABLE", "Choose an open lead stage.");
    }
    boolean[] lost = new boolean[1];
    runNative(() -> lost[0] = lifecycle.isLost(lead));
    if (lost[0]) {
      // natively a lost lead can be dragged to another column and keep its lost reason; IOETI
      // requires the explicit reopen command so the reason is cleared
      throw new ApiException(422, "LEAD_LOST", "Reopen this lost lead before changing its stage.", null);
    }
    runNative(() -> lifecycle.moveTo(lead, target));
    return ResponseConstructor.build(Response.Status.OK, "Lead stage changed", project(lead));
  }

  @POST
  @Path("/{id}/lose")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Mark a lead lost, with an optional reason and note", tags = {"IOETI leads"})
  @IoetiEndpoint
  public Response lose(@PathParam("id") Long id, LoseLead command) {
    Lead lead = writableLead(id, command == null ? null : command.version());
    LostReason reason = null;
    if (command.lostReasonId() != null) {
      reason = command.lostReasonId() <= 0 ? null : JPA.find(LostReason.class, command.lostReasonId());
      if (reason == null) {
        throw ApiException.invalidField("lostReasonId", "UNAVAILABLE", "Choose a reason from the list.");
      }
    }
    String note = command.note() == null || command.note().isBlank() ? null : command.note().strip();
    if (note != null && note.length() > MAX_NOTE) {
      throw ApiException.invalidField("note", "TOO_LONG", "The note can have at most 500 characters.");
    }
    LostReason chosen = reason;
    runNative(() -> Beans.get(LeadLifecycleService.class).lose(lead, chosen, note));
    return ResponseConstructor.build(Response.Status.OK, "Lead marked lost", project(lead));
  }

  @POST
  @Path("/{id}/reopen")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Reopen a lost lead at the default stage", tags = {"IOETI leads"})
  @IoetiEndpoint
  public Response reopen(@PathParam("id") Long id, VersionOnly command) {
    Lead lead = writableLead(id, command == null ? null : command.version());
    runNative(() -> Beans.get(LeadLifecycleService.class).reopen(lead));
    return ResponseConstructor.build(Response.Status.OK, "Lead reopened", project(lead));
  }

  @POST
  @Path("/{id}/assign")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(
      summary = "Assign a lead to the caller; routing to someone else waits for policies D-07 and D-12",
      tags = {"IOETI leads"})
  @IoetiEndpoint
  public Response assign(@PathParam("id") Long id, AssignLead command) {
    Lead lead = writableLead(id, command == null ? null : command.version());
    Long me = AuthUtils.getUser().getId();
    if (command.userId() != null && !command.userId().equals(me)) {
      throw ApiException.policyBlocked("D-07 and D-12");
    }
    runNative(() -> Beans.get(LeadLifecycleService.class).assignToMe(lead));
    return ResponseConstructor.build(Response.Status.OK, "Lead assigned", project(lead));
  }

  /** Writable, unconverted lead at the caller's version; conversion is final. */
  private static Lead writableLead(Long id, Integer version) {
    if (version == null) {
      throw ApiException.badRequest("Record version is required.");
    }
    Lead lead = RecordAccess.writable(Lead.class, id);
    ConflictChecker.checkVersion(lead, version);
    if (Boolean.TRUE.equals(lead.getIsConverted())) {
      throw new ApiException(409, "ALREADY_CONVERTED", "This lead has already been converted.", null);
    }
    return lead;
  }

  /** Native lead writes: see {@link NativeCommands} for the error mapping. */
  private static void runNative(NativeCommands.NativeCommand command) {
    NativeCommands.run(command, "LEAD_REJECTED", "This lead cannot be changed this way in its current state.");
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

  private static LeadView project(Lead lead) {
    JpaSecurity security = Beans.get(JpaSecurity.class);
    BusinessLine line = lead.getIoetiBusinessLine();
    Partner account = lead.getPartner();
    Opportunity opportunity = Boolean.TRUE.equals(lead.getIsConverted()) ? originOpportunity(lead) : null;
    LostReason lostReason = lead.getLostReason();
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
      opportunity == null ? null : opportunity.getId(),
      lead.getLeadStatus() == null ? null : lead.getLeadStatus().getId(),
      stageKind(lead.getLeadStatus()),
      lostReason == null ? null : lostReason.getName(),
      lead.getUser() == null ? null : lead.getUser().getId().equals(AuthUtils.getUser().getId()),
      lead.getCreatedOn()
    );
  }

  /** OPEN, CONVERTED or LOST; null when the CRM app does not name its converted and lost stages. */
  private static String stageKind(LeadStatus status) {
    try {
      return Beans.get(LeadLifecycleService.class).kind(status);
    } catch (AxelorException e) {
      return null;
    }
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
    boolean converted, String businessLineCode, Long accountId, Long opportunityId,
    Long stageId, String stageKind, String lostReason, Boolean assignedToMe, LocalDateTime receivedAt) {}
  public record StageView(Long id, String name, String kind) {}
  public record ReasonView(Long id, String name) {}
  public record MoveStage(Integer version, Long stageId) {}
  public record LoseLead(Integer version, Long lostReasonId, String note) {}
  public record VersionOnly(Integer version) {}
  public record AssignLead(Integer version, Long userId) {}
}
