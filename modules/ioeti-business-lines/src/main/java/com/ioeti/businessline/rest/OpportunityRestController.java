package com.ioeti.businessline.rest;

import com.axelor.apps.base.AxelorException;
import com.axelor.apps.base.db.Currency;
import com.axelor.apps.crm.db.LostReason;
import com.axelor.apps.crm.db.Opportunity;
import com.axelor.apps.crm.db.OpportunityStatus;
import com.ioeti.businessline.service.OpportunityStages;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import com.axelor.apps.crm.service.OpportunityService;
import com.axelor.apps.base.db.Partner;
import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.User;
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
  private static final int BOARD_LIMIT = 500;

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
  @Path("/board")
  @Operation(summary = "The pipeline board: every readable open opportunity, plus those won or lost in the last 30 days (at most 500)", tags = {"IOETI opportunities"})
  @IoetiEndpoint
  public Response board(@QueryParam("line") String lineCode, @QueryParam("mine") Boolean mine) {
    new SecurityCheck().readAccess(Opportunity.class).check();
    OpportunityStages stages = Beans.get(OpportunityStages.class);
    JpaSecurity security = Beans.get(JpaSecurity.class);
    User me = AuthUtils.getUser();
    java.time.LocalDateTime since = java.time.LocalDateTime.now().minusDays(30);
    List<BoardCard> cards = new java.util.ArrayList<>();
    for (Opportunity o : readableOpportunities().order("expectedCloseDate").order("-id").fetch(BOARD_LIMIT)) {
      String kind = stages.kind(o.getOpportunityStatus());
      boolean recent = o.getUpdatedOn() != null ? o.getUpdatedOn().isAfter(since) : o.getCreatedOn() != null && o.getCreatedOn().isAfter(since);
      if (!"OPEN".equals(kind) && !recent) continue;
      if (lineCode != null && !lineCode.isBlank() && (o.getIoetiBusinessLine() == null || !lineCode.equals(o.getIoetiBusinessLine().getCode()))) continue;
      boolean own = o.getUser() != null && o.getUser().equals(me);
      if (Boolean.TRUE.equals(mine) && !own) continue;
      Partner account = o.getPartner();
      boolean seeAccount = account != null && security.isPermitted(JpaSecurity.CAN_READ, Partner.class, account.getId());
      cards.add(new BoardCard(view(o), seeAccount ? account.getName() : null, seeAccount ? account.getId() : null,
          o.getUser() == null ? null : o.getUser().getName(), own));
    }
    return ResponseConstructor.build(Response.Status.OK, "Pipeline board", cards);
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
    // the client account, when given: one the caller may read, and a client account (not a contact person)
    Partner account = null;
    if (command.accountId() != null) {
      account = RecordAccess.readable(Partner.class, command.accountId());
      if (!AccountRestController.isClientAccount(account)) throw ApiException.invalidField("accountId", "UNAVAILABLE", "Choose a client account.");
    }
    CheckedEstimate plan = plan(command.amount(), command.currencyCode(), command.expectedCloseDate(), command.probability());
    Opportunity opportunity = new Opportunity();
    opportunity.setName(name);
    opportunity.setIoetiBusinessLine(line);
    opportunity.setUser(AuthUtils.getUser());
    opportunity.setPartner(account);
    // Calls the existing Axelor service, not a direct generic REST create.
    // Existing IOETI JPA listener rejects suspended lines at persistence time.
    Beans.get(OpportunityService.class).saveOpportunity(opportunity);
    if (command.amount() != null || command.currencyCode() != null || command.expectedCloseDate() != null || command.probability() != null) {
      Beans.get(OpportunityStages.class).plan(opportunity, plan.amount(), plan.currency(), plan.close(), plan.probability(),
          command.amount() != null, command.currencyCode() != null, command.expectedCloseDate() != null, command.probability() != null);
    }
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

  // --- stages and planning (journeys plan, phase 2) ---------------------------------------------------

  @GET
  @Path("/stages")
  @Operation(summary = "Opportunity stages (native OpportunityStatus) in pipeline order, with their kind", tags = {"IOETI opportunities"})
  @IoetiEndpoint
  public Response stages() {
    new SecurityCheck().readAccess(Opportunity.class).check();
    OpportunityStages stages = Beans.get(OpportunityStages.class);
    List<StageView> rows = Query.of(OpportunityStatus.class).order("sequence").order("id").fetch(50).stream()
        .map(st -> new StageView(st.getId(), st.getName(), stages.kind(st))).toList();
    return ResponseConstructor.build(Response.Status.OK, "Opportunity stages", rows);
  }

  @GET
  @Path("/lost-reasons")
  @Operation(summary = "Reasons an opportunity can be marked lost (native LostReason)", tags = {"IOETI opportunities"})
  @IoetiEndpoint
  public Response lostReasons() {
    new SecurityCheck().readAccess(Opportunity.class).check();
    List<LostReasonView> reasons = Query.of(LostReason.class).order("name").fetch(100).stream()
        .map(r -> new LostReasonView(r.getId(), r.getName())).toList();
    return ResponseConstructor.build(Response.Status.OK, "Lost reasons", reasons);
  }

  @POST
  @Path("/{id}/stage")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Move an open opportunity to another stage; won needs the business line's evidence (D-11), lost has its own command", tags = {"IOETI opportunities"})
  @IoetiEndpoint
  public Response move(@PathParam("id") Long id, MoveStage command) {
    Opportunity opportunity = versioned(id, command == null ? null : command.version());
    OpportunityStatus target = command.stageId() == null ? null : com.axelor.db.JPA.find(OpportunityStatus.class, command.stageId());
    if (target == null) throw ApiException.invalidField("stageId", "UNKNOWN", "Choose an existing stage.");
    OptimisticLockConflicts.translate(() -> Beans.get(OpportunityStages.class).move(opportunity, target));
    return ResponseConstructor.build(Response.Status.OK, "Stage changed", view(RecordAccess.readable(Opportunity.class, id)));
  }

  @POST
  @Path("/{id}/lose")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Mark an open opportunity lost with a reason and an optional note", tags = {"IOETI opportunities"})
  @IoetiEndpoint
  public Response lose(@PathParam("id") Long id, LoseOpportunity command) {
    Opportunity opportunity = versioned(id, command == null ? null : command.version());
    LostReason reason = command.lostReasonId() == null ? null : com.axelor.db.JPA.find(LostReason.class, command.lostReasonId());
    if (reason == null) throw ApiException.invalidField("lostReasonId", "REQUIRED", "Choose why the opportunity was lost.");
    String note = command.note() == null || command.note().isBlank() ? null : command.note().strip();
    if (note != null && note.length() > 1000) throw ApiException.invalidField("note", "TOO_LONG", "This field can have at most 1000 characters.");
    OptimisticLockConflicts.translate(() -> {
      try {
        Beans.get(OpportunityStages.class).lose(opportunity, reason, note);
      } catch (AxelorException e) {
        throw new ApiException(422, "CRM_CONFIGURATION", "The CRM has no lost stage configured.", null);
      }
    });
    return ResponseConstructor.build(Response.Status.OK, "Opportunity lost", view(RecordAccess.readable(Opportunity.class, id)));
  }

  @POST
  @Path("/{id}/reopen")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Reopen a lost opportunity at the default stage", tags = {"IOETI opportunities"})
  @IoetiEndpoint
  public Response reopen(@PathParam("id") Long id, MoveStage command) {
    Opportunity opportunity = versioned(id, command == null ? null : command.version());
    OptimisticLockConflicts.translate(() -> {
      try {
        Beans.get(OpportunityStages.class).reopen(opportunity);
      } catch (AxelorException e) {
        throw new ApiException(422, "CRM_CONFIGURATION", "The CRM has no default stage configured.", null);
      }
    });
    return ResponseConstructor.build(Response.Status.OK, "Opportunity reopened", view(RecordAccess.readable(Opportunity.class, id)));
  }

  @POST
  @Path("/{id}/plan")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Set the salesperson's estimate: amount, currency, expected close date, probability", tags = {"IOETI opportunities"})
  @IoetiEndpoint
  public Response plan(@PathParam("id") Long id, PlanOpportunity command) {
    Opportunity opportunity = versioned(id, command == null ? null : command.version());
    CheckedEstimate plan = plan(command.amount(), command.currencyCode(), command.expectedCloseDate(), command.probability());
    OptimisticLockConflicts.translate(() -> Beans.get(OpportunityStages.class).plan(opportunity, plan.amount(), plan.currency(), plan.close(), plan.probability(),
        command.amount() != null, command.currencyCode() != null, command.expectedCloseDate() != null, command.probability() != null));
    return ResponseConstructor.build(Response.Status.OK, "Plan saved", view(RecordAccess.readable(Opportunity.class, id)));
  }

  /** The salesperson's estimate, checked: amount, currency, expected close date, probability (each optional). */
  record CheckedEstimate(BigDecimal amount, Currency currency, LocalDate close, BigDecimal probability) {}

  static CheckedEstimate plan(BigDecimal amount, String currencyCode, String expectedCloseDate, BigDecimal probability) {
    if (amount != null && (amount.signum() < 0 || amount.compareTo(new BigDecimal("1000000000000")) >= 0 || amount.scale() > 2)) {
      throw ApiException.invalidField("amount", "RANGE", "Enter an amount of zero or more with at most two decimals.");
    }
    Currency currency = null;
    if (currencyCode != null && !currencyCode.isBlank()) {
      currency = Query.of(Currency.class).filter("self.codeISO = ?1", currencyCode.strip().toUpperCase()).fetchOne();
      if (currency == null) throw ApiException.invalidField("currencyCode", "UNKNOWN", "Choose an existing currency.");
    }
    LocalDate close = null;
    if (expectedCloseDate != null && !expectedCloseDate.isBlank()) {
      try { close = LocalDate.parse(expectedCloseDate); }
      catch (DateTimeParseException e) { throw ApiException.invalidField("expectedCloseDate", "FORMAT", "Use a date like 2026-12-31."); }
    }
    if (probability != null && (probability.signum() < 0 || probability.compareTo(new BigDecimal(100)) > 0)) {
      throw ApiException.invalidField("probability", "RANGE", "Use a probability from 0 to 100.");
    }
    return new CheckedEstimate(amount, currency, close, probability);
  }

  private static Opportunity versioned(Long id, Integer version) {
    if (version == null) throw ApiException.badRequest("Record version is required.");
    Opportunity opportunity = RecordAccess.writable(Opportunity.class, id);
    ConflictChecker.checkVersion(opportunity, version);
    return opportunity;
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
      opportunity.getOpportunityStatus() == null ? null : opportunity.getOpportunityStatus().getName(),
      opportunity.getOpportunityStatus() == null ? null : opportunity.getOpportunityStatus().getId(),
      Beans.get(OpportunityStages.class).kind(opportunity.getOpportunityStatus()),
      opportunity.getAmount(),
      opportunity.getCurrency() == null ? null : opportunity.getCurrency().getCodeISO(),
      opportunity.getExpectedCloseDate(),
      opportunity.getProbability(),
      opportunity.getLostReason() == null ? null : opportunity.getLostReason().getName());
  }

  /** Only the name and line are required; the account and the estimate can be given at once or later. */
  public record CreateOpportunity(String name, String businessLineCode, Long accountId, BigDecimal amount, String currencyCode,
      String expectedCloseDate, BigDecimal probability) {}
  public record BoardCard(OpportunityView opportunity, String accountName, Long accountId, String ownerName, boolean mine) {}
  public record RenameOpportunity(String name, Integer version) {}
  public record OpportunityView(
    Long id, Integer version, String name, String reference,
    String businessLineCode, String businessLineNameAr, String businessLineNameEn,
    String stage, Long stageId, String stageKind, BigDecimal amount, String currencyCode, LocalDate expectedCloseDate,
    BigDecimal probability, String lostReason) {}
  public record StageView(Long id, String name, String kind) {}
  public record LostReasonView(Long id, String name) {}
  public record MoveStage(Integer version, Long stageId) {}
  public record LoseOpportunity(Integer version, Long lostReasonId, String note) {}
  public record PlanOpportunity(Integer version, BigDecimal amount, String currencyCode, String expectedCloseDate, BigDecimal probability) {}
}
