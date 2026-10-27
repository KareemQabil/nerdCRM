package com.ioeti.marketing.rest;

import com.axelor.apps.crm.db.Lead;
import com.axelor.apps.crm.db.Opportunity;
import com.axelor.apps.marketing.db.Campaign;
import com.axelor.apps.marketing.db.CampaignType;
import com.axelor.auth.AuthUtils;
import com.axelor.db.JPA;
import com.axelor.db.JpaSecurity;
import com.axelor.db.Model;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.axelor.rpc.filter.Filter;
import com.axelor.rpc.filter.JPQLFilter;
import com.axelor.utils.api.ConflictChecker;
import com.axelor.utils.api.ResponseConstructor;
import com.axelor.utils.api.SecurityCheck;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.IoetiEndpoint;
import com.ioeti.core.api.RecordAccess;
import com.ioeti.core.text.ArabicNormalizer;
import com.ioeti.core.web.OptimisticLockConflicts;
import com.ioeti.marketing.service.CampaignService;
import com.ioeti.marketing.service.CampaignService.Fields;
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
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.List;

/**
 * Campaigns from the platform: the board by stage, adding and changing a campaign, moving it through its
 * stages, and its results. Native campaign permissions decide on every call. Results are counted only
 * over the leads and opportunities the caller may read, and only from real records (attributed leads,
 * conversions, opportunities); there is no cost, revenue or ROI figure, because none is recorded. Sending
 * from a campaign (e-mail, WhatsApp, ads) is external exposure, D-10, and not offered.
 */
@Path("/ioeti/campaigns")
@Produces(MediaType.APPLICATION_JSON)
public class CampaignRestController {

  @GET
  @Operation(summary = "Campaigns the caller may read, with their stage and results within the caller's read scope", tags = {"IOETI campaigns"})
  @IoetiEndpoint
  public Response board(@QueryParam("q") String q) {
    new SecurityCheck().readAccess(Campaign.class).check();
    String search = ArabicNormalizer.normalize(MarketingRestController.text("q", q, 100, false));
    List<MarketingCampaignView> rows = readable(Campaign.class, null).order("-id").fetch(300).stream()
        .filter(c -> search.isEmpty() || ArabicNormalizer.normalize(c.getName()).contains(search))
        .map(CampaignRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Campaigns", rows);
  }

  @GET
  @Path("/{id}")
  @Operation(summary = "One campaign with its results and the attributed leads the caller may read", tags = {"IOETI campaigns"})
  @IoetiEndpoint
  public Response get(@PathParam("id") Long id) {
    Campaign campaign = RecordAccess.readable(Campaign.class, id);
    List<LeadRef> leads = attributed(campaign).order("-id").fetch(200).stream()
        .map(l -> new LeadRef(l.getId(), l.getFullName() == null || l.getFullName().isBlank() ? l.getName() : l.getFullName(),
            Boolean.TRUE.equals(l.getIsConverted()), l.getLeadStatus() == null ? null : l.getLeadStatus().getName())).toList();
    return ResponseConstructor.build(Response.Status.OK, "Campaign", new CampaignDetail(view(campaign), leads));
  }

  @POST
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Add a campaign (native create permission); it starts as a draft owned by the caller", tags = {"IOETI campaigns"})
  @IoetiEndpoint
  public Response create(EditCampaign command) {
    new SecurityCheck().createAccess(Campaign.class).check();
    if (command == null) throw ApiException.badRequest("Campaign details are required.");
    Fields fields = fields(command, true);
    Campaign[] saved = new Campaign[1];
    OptimisticLockConflicts.translate(() -> saved[0] = Beans.get(CampaignService.class).create(fields));
    return ResponseConstructor.build(Response.Status.CREATED, "Campaign added", view(saved[0]));
  }

  @POST
  @Path("/{id}")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Change a campaign's name, type, period or summary, with its version", tags = {"IOETI campaigns"})
  @IoetiEndpoint
  public Response update(@PathParam("id") Long id, EditCampaign command) {
    Campaign campaign = versioned(id, command == null ? null : command.version());
    Fields fields = fields(command, false);
    Campaign[] saved = new Campaign[1];
    OptimisticLockConflicts.translate(() -> saved[0] = Beans.get(CampaignService.class).update(campaign, fields,
        blank(command.typeId()), blank(command.startDate()), blank(command.endDate()), blank(command.summary())));
    return ResponseConstructor.build(Response.Status.OK, "Campaign saved", view(saved[0]));
  }

  @POST
  @Path("/{id}/stage")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Move a campaign to another stage (draft, planned, started, suspended, ended)", tags = {"IOETI campaigns"})
  @IoetiEndpoint
  public Response stage(@PathParam("id") Long id, MoveCampaign command) {
    Campaign campaign = versioned(id, command == null ? null : command.version());
    int to = MarketingRestController.select("stage", command.stage(), CampaignService.STAGES) - 1;
    Campaign[] saved = new Campaign[1];
    OptimisticLockConflicts.translate(() -> saved[0] = Beans.get(CampaignService.class).move(campaign, to));
    return ResponseConstructor.build(Response.Status.OK, "Campaign moved", view(saved[0]));
  }

  @GET
  @Path("/types")
  @Operation(summary = "Campaign types (native CampaignType)", tags = {"IOETI campaigns"})
  @IoetiEndpoint
  public Response types() {
    new SecurityCheck().readAccess(Campaign.class).check();
    return ResponseConstructor.build(Response.Status.OK, "Campaign types",
        Query.of(CampaignType.class).order("name").fetch(200).stream().map(t -> new MarketingRestController.Option(t.getId(), t.getName())).toList());
  }

  // --- helpers -------------------------------------------------------------------------------------

  private static Campaign versioned(Long id, Integer version) {
    if (version == null) throw ApiException.badRequest("Record version is required.");
    Campaign campaign = RecordAccess.writable(Campaign.class, id);
    ConflictChecker.checkVersion(campaign, version);
    return campaign;
  }

  private static boolean blank(Object value) {
    return value instanceof String text && text.isBlank();
  }

  private static Fields fields(EditCampaign c, boolean creating) {
    String name = c.name() == null ? null : MarketingRestController.text("name", c.name(), 255, creating);
    if (!creating && c.name() != null && name == null) throw ApiException.invalidField("name", "REQUIRED", "This field is required.");
    CampaignType type = null;
    if (c.typeId() instanceof Number n) {
      type = JPA.find(CampaignType.class, n.longValue());
      if (type == null) throw ApiException.invalidField("typeId", "UNAVAILABLE", "Choose an existing campaign type.");
    }
    LocalDate start = date("startDate", c.startDate()), end = date("endDate", c.endDate());
    if (start != null && end != null && end.isBefore(start)) throw ApiException.invalidField("endDate", "BEFORE_START", "The end date is before the start date.");
    String summary = c.summary() == null || c.summary().isBlank() ? null : MarketingRestController.text("summary", c.summary(), 4000, false);
    return new Fields(name, type, start == null ? null : start.atStartOfDay(), end == null ? null : end.atStartOfDay(),
        creating ? AuthUtils.getUser() : null, summary);
  }

  private static LocalDate date(String field, String value) {
    if (value == null || value.isBlank()) return null;
    try { return LocalDate.parse(value.strip()); }
    catch (DateTimeParseException e) { throw ApiException.invalidField(field, "FORMAT", "Use a date like 2026-12-31."); }
  }

  private static <T extends Model> Query<T> readable(Class<T> type, Filter condition) {
    Filter security = Beans.get(JpaSecurity.class).getFilter(JpaSecurity.CAN_READ, type);
    Filter combined = security == null ? condition : condition == null ? security : Filter.and(security, condition);
    return combined == null ? Query.of(type) : combined.build(type);
  }

  /** The campaign's attributed leads that the caller may read. */
  private static Query<Lead> attributed(Campaign campaign) {
    if (!Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, Lead.class)) return Query.of(Lead.class).filter("1 = 0");
    return readable(Lead.class, new JPQLFilter("self.id IN (SELECT l.id FROM Campaign c JOIN c.leadSet l WHERE c.id = " + campaign.getId() + ")"));
  }

  static MarketingCampaignView view(Campaign c) {
    long leads = attributed(c).count();
    long converted = leads == 0 ? 0 : readable(Lead.class, new JPQLFilter(
        "self.isConverted = true AND self.id IN (SELECT l.id FROM Campaign c JOIN c.leadSet l WHERE c.id = " + c.getId() + ")")).count();
    long opportunities = leads == 0 || !Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, Opportunity.class) ? 0
        : readable(Opportunity.class, new JPQLFilter(
            "self.ioetiOriginLead.id IN (SELECT l.id FROM Campaign c JOIN c.leadSet l WHERE c.id = " + c.getId() + ")")).count();
    LocalDateTime start = c.getEventStartDateT(), end = c.getEventEndDateT();
    return new MarketingCampaignView(c.getId(), c.getVersion(), c.getName(), CampaignService.STAGES[CampaignService.stage(c)],
        c.getCampaignType() == null ? null : c.getCampaignType().getId(), c.getCampaignType() == null ? null : c.getCampaignType().getName(),
        start == null ? null : start.toLocalDate(), end == null ? null : end.toLocalDate(), c.getDescription(),
        c.getEventUser() == null ? null : c.getEventUser().getName(), leads, converted, opportunities);
  }

  /** typeId: a number chooses, an empty string clears, missing leaves as is (dates and summary alike). */
  public record EditCampaign(Integer version, String name, Object typeId, String startDate, String endDate, String summary) {}

  public record MoveCampaign(Integer version, String stage) {}

  public record MarketingCampaignView(Long id, Integer version, String name, String stage, Long typeId, String type, LocalDate startDate,
      LocalDate endDate, String summary, String ownerName, long leads, long converted, long opportunities) {}

  public record LeadRef(Long id, String name, boolean converted, String stage) {}

  public record CampaignDetail(MarketingCampaignView campaign, List<LeadRef> leads) {}
}
