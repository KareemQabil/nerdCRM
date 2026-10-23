package com.ioeti.marketing.rest;

import com.axelor.apps.base.db.Source;
import com.axelor.apps.crm.db.Event;
import com.axelor.apps.crm.db.Lead;
import com.axelor.apps.crm.db.LeadStatus;
import com.axelor.apps.crm.db.repo.EventRepository;
import com.axelor.apps.marketing.db.Campaign;
import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.AuditableModel;
import com.axelor.auth.db.User;
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
import com.ioeti.businessline.db.BusinessLine;
import com.ioeti.businessline.rest.LeadRestController;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.IoetiEndpoint;
import com.ioeti.core.api.RecordAccess;
import com.ioeti.core.text.ArabicNormalizer;
import com.ioeti.core.web.OptimisticLockConflicts;
import com.ioeti.marketing.db.LeadConsentEvent;
import com.ioeti.marketing.db.SavedLeadView;
import com.ioeti.marketing.service.MarketingService;
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
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Lead intake, consent, attribution, server-side filters, saved views and follow-ups (Wave 6), on the
 * native CRM lead, campaign and event. Lead routing, response targets and escalations are D-12; no
 * endpoint here sends a message.
 */
@Path("/ioeti/marketing")
@Produces(MediaType.APPLICATION_JSON)
public class MarketingRestController {

  static final Pattern EMAIL = Pattern.compile("[^@\\s]{1,64}@[^@\\s]{1,190}\\.[A-Za-z]{2,}");
  static final Pattern PHONE = Pattern.compile("\\+?[0-9\\u0660-\\u0669 ()-]{7,20}");
  static final String[] CHANNELS = {"EMAIL", "CALL"};
  static final String[] METHODS = {"WRITTEN", "EMAIL", "WEB_FORM", "PHONE", "IN_PERSON"};
  static final String[] FOLLOW_UP_TYPES = {"CALL", "MEETING", "TASK"};
  static final int[] FOLLOW_UP_NATIVE = {EventRepository.TYPE_CALL, EventRepository.TYPE_MEETING, EventRepository.TYPE_TASK};

  // --- intake --------------------------------------------------------------------------------------

  @POST
  @Path("/leads/duplicates")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Leads the caller may read that look like this one (e-mail, phone, Arabic-normalized name)", tags = {"IOETI marketing"})
  @IoetiEndpoint
  public Response duplicates(Intake command) {
    if (command == null) throw ApiException.badRequest("Lead details are required.");
    new SecurityCheck().readAccess(Lead.class).check();
    List<LeadRestController.LeadView> rows = MarketingService.duplicates(command.firstName(), command.name(), command.organization(),
        command.email(), command.phone()).stream().map(LeadRestController::project).toList();
    return ResponseConstructor.build(Response.Status.OK, "Possible duplicates", rows);
  }

  @POST
  @Path("/leads")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Record a new lead; possible duplicates must be confirmed first (409)", tags = {"IOETI marketing"})
  @IoetiEndpoint
  public Response intake(Intake command) {
    if (command == null) throw ApiException.badRequest("Lead details are required.");
    new SecurityCheck().createAccess(Lead.class).check();
    Lead lead = new Lead();
    lead.setFirstName(text("firstName", command.firstName(), 255, false));
    lead.setName(text("name", command.name(), 255, true));
    lead.setEnterpriseName(text("organization", command.organization(), 255, false));
    String email = text("email", command.email(), 255, false);
    if (email != null && !EMAIL.matcher(email).matches()) throw ApiException.invalidField("email", "FORMAT", "Enter a valid e-mail address.");
    String phone = text("phone", command.phone(), 20, false);
    if (phone != null && !PHONE.matcher(phone).matches()) throw ApiException.invalidField("phone", "FORMAT", "Enter a valid phone number.");
    lead.setMobilePhone(phone);
    if (command.businessLineCode() != null && !command.businessLineCode().isBlank()) {
      lead.setIoetiBusinessLine(businessLine(command.businessLineCode()));
    }
    if (command.sourceId() != null) {
      Source source = command.sourceId() <= 0 ? null : JPA.find(Source.class, command.sourceId());
      if (source == null) throw ApiException.invalidField("sourceId", "UNAVAILABLE", "Choose a configured source.");
      lead.setSource(source);
    }
    Campaign campaign = campaign(command.campaignId());
    if (!Boolean.TRUE.equals(command.confirmNotDuplicate())
        && !MarketingService.duplicates(lead.getFirstName(), lead.getName(), lead.getEnterpriseName(), email, phone).isEmpty()) {
      throw new ApiException(409, "POSSIBLE_DUPLICATE", "Similar leads exist; review them before recording a new one.", null);
    }
    Lead[] saved = new Lead[1];
    write(() -> saved[0] = Beans.get(MarketingService.class).intake(lead, email, campaign));
    return ResponseConstructor.build(Response.Status.CREATED, "Lead recorded", LeadRestController.project(saved[0]));
  }

  @POST
  @Path("/leads/{id}")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Change a lead's details (record write access and version); a new e-mail, phone or name that looks like another lead must be confirmed (409)", tags = {"IOETI marketing"})
  @IoetiEndpoint
  public Response editLead(@PathParam("id") Long id, EditLead command) {
    Lead lead = writable(Lead.class, id, command == null ? null : command.version());
    if (Boolean.TRUE.equals(lead.getIsConverted())) {
      throw new ApiException(422, "LEAD_CONVERTED", "A converted lead is kept as it was; change the account instead.", null);
    }
    if (command.firstName() != null) lead.setFirstName(text("firstName", command.firstName(), 255, false));
    if (command.name() != null) lead.setName(text("name", command.name(), 255, true));
    if (command.organization() != null) lead.setEnterpriseName(text("organization", command.organization(), 255, false));
    String email = command.email() == null ? null : text("email", command.email(), 255, false);
    if (email != null && !EMAIL.matcher(email).matches()) throw ApiException.invalidField("email", "FORMAT", "Enter a valid e-mail address.");
    if (command.phone() != null) {
      String phone = text("phone", command.phone(), 20, false);
      if (phone != null && !PHONE.matcher(phone).matches()) throw ApiException.invalidField("phone", "FORMAT", "Enter a valid phone number.");
      lead.setMobilePhone(phone);
    }
    if (command.businessLineCode() != null) {
      lead.setIoetiBusinessLine(command.businessLineCode().isBlank() ? null : businessLine(command.businessLineCode()));
    }
    if (command.sourceId() != null) {
      Source source = command.sourceId() <= 0 ? null : JPA.find(Source.class, command.sourceId());
      if (command.sourceId() > 0 && source == null) throw ApiException.invalidField("sourceId", "UNAVAILABLE", "Choose a configured source.");
      lead.setSource(source);
    }
    if (!Boolean.TRUE.equals(command.confirmNotDuplicate())) {
      String currentEmail = email != null ? email : lead.getEmailAddress() == null ? null : lead.getEmailAddress().getAddress();
      boolean others = MarketingService.duplicates(lead.getFirstName(), lead.getName(), lead.getEnterpriseName(), currentEmail, lead.getMobilePhone())
          .stream().anyMatch(other -> !other.getId().equals(lead.getId()));
      if (others) throw new ApiException(409, "POSSIBLE_DUPLICATE", "Another lead looks like this one; review it before saving.", null);
    }
    boolean emailGiven = command.email() != null;
    write(() -> Beans.get(MarketingService.class).edit(lead, emailGiven ? email : null, emailGiven));
    return ResponseConstructor.build(Response.Status.OK, "Lead saved", LeadRestController.project(JPA.find(Lead.class, id)));
  }

  // --- server-side filters and saved views ---------------------------------------------------------

  @GET
  @Path("/leads")
  @Operation(summary = "Leads the caller may read, filtered on the server (Arabic-normalized search)", tags = {"IOETI marketing"})
  @IoetiEndpoint
  public Response leads(@QueryParam("q") String q, @QueryParam("stageId") Long stageId, @QueryParam("sourceId") Long sourceId,
      @QueryParam("businessLine") String line, @QueryParam("mine") Boolean mine, @QueryParam("limit") Integer limit,
      @QueryParam("offset") Integer offset) {
    new SecurityCheck().readAccess(Lead.class).check();
    int size = limit == null ? 25 : limit;
    int from = offset == null ? 0 : offset;
    if (size < 1 || size > 100 || from < 0 || from > 10000) throw ApiException.badRequest("Invalid pagination parameters.");
    List<String> conditions = new ArrayList<>();
    List<Object> params = new ArrayList<>();
    String search = ArabicNormalizer.normalize(text("q", q, 100, false));
    if (!search.isEmpty()) {
      for (String word : search.split(" ")) {
        conditions.add("self.ioetiSearchKey LIKE ?");
        params.add("%" + word.replace("%", "").replace("_", "") + "%");
      }
    }
    if (stageId != null) { conditions.add("self.leadStatus.id = ?"); params.add(stageId); }
    if (sourceId != null) { conditions.add("self.source.id = ?"); params.add(sourceId); }
    if (line != null && !line.isBlank()) { conditions.add("self.ioetiBusinessLine.code = ?"); params.add(line); }
    if (Boolean.TRUE.equals(mine)) { conditions.add("self.user = ?"); params.add(AuthUtils.getUser()); }
    Filter where = conditions.isEmpty() ? null : new JPQLFilter(String.join(" AND ", conditions), params.toArray());
    List<LeadRestController.LeadView> rows = readable(Lead.class, where).order("-id").fetch(size, from).stream()
        .map(LeadRestController::project).toList();
    return ResponseConstructor.build(Response.Status.OK, "Leads", rows);
  }

  @GET
  @Path("/sources")
  @Operation(summary = "Configured lead sources", tags = {"IOETI marketing"})
  @IoetiEndpoint
  public Response sources() {
    new SecurityCheck().readAccess(Lead.class).check();
    List<Option> rows = Query.of(Source.class).order("name").fetch(200).stream().map(s -> new Option(s.getId(), s.getName())).toList();
    return ResponseConstructor.build(Response.Status.OK, "Sources", rows);
  }

  @POST
  @Path("/sources")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Add a lead source (needs create on the native Source)", tags = {"IOETI marketing"})
  @IoetiEndpoint
  public Response addSource(AddSource command) {
    if (command == null) throw ApiException.badRequest("Source details are required.");
    new SecurityCheck().createAccess(Source.class).check();
    String name = text("name", command.name(), 255, true);
    if (Query.of(Source.class).filter("LOWER(self.name) = ?1", name.toLowerCase()).count() > 0) {
      throw ApiException.invalidField("name", "DUPLICATE", "This source already exists.");
    }
    Source source = new Source();
    source.setName(name);
    Source[] saved = new Source[1];
    write(() -> saved[0] = Beans.get(MarketingService.class).create(source));
    return ResponseConstructor.build(Response.Status.CREATED, "Source added", new Option(saved[0].getId(), saved[0].getName()));
  }

  @GET
  @Path("/campaigns")
  @Operation(summary = "Marketing campaigns the caller may read (for intake and attribution)", tags = {"IOETI marketing"})
  @IoetiEndpoint
  public Response campaigns() {
    new SecurityCheck().readAccess(Campaign.class).check();
    List<Option> rows = readable(Campaign.class, null).order("name").fetch(200).stream().map(c -> new Option(c.getId(), c.getName())).toList();
    return ResponseConstructor.build(Response.Status.OK, "Campaigns", rows);
  }

  @GET
  @Path("/saved-views")
  @Operation(summary = "The caller's own saved lead filters", tags = {"IOETI marketing"})
  @IoetiEndpoint
  public Response savedViews() {
    new SecurityCheck().readAccess(Lead.class).check();
    List<SavedView> rows = Query.of(SavedLeadView.class).filter("self.owner = ?1", AuthUtils.getUser()).order("name").fetch(100)
        .stream().map(MarketingRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Saved views", rows);
  }

  @POST
  @Path("/saved-views")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Save a lead filter for the caller only", tags = {"IOETI marketing"})
  @IoetiEndpoint
  public Response saveView(SaveView command) {
    if (command == null) throw ApiException.badRequest("View details are required.");
    new SecurityCheck().readAccess(Lead.class).check();
    String name = text("name", command.name(), 80, true);
    if (Query.of(SavedLeadView.class).filter("self.owner = ?1 AND self.name = ?2", AuthUtils.getUser(), name).count() > 0) {
      throw ApiException.invalidField("name", "DUPLICATE", "You already have a view with this name.");
    }
    SavedLeadView view = new SavedLeadView();
    view.setOwner(AuthUtils.getUser());
    view.setName(name);
    view.setSearchText(text("searchText", command.searchText(), 100, false));
    view.setStage(command.stageId() == null ? null : found("stageId", JPA.find(LeadStatus.class, command.stageId())));
    view.setSource(command.sourceId() == null ? null : found("sourceId", JPA.find(Source.class, command.sourceId())));
    view.setBusinessLine(command.businessLineCode() == null || command.businessLineCode().isBlank() ? null
        : businessLine(command.businessLineCode()));
    view.setOnlyMine(Boolean.TRUE.equals(command.onlyMine()));
    SavedLeadView[] saved = new SavedLeadView[1];
    write(() -> saved[0] = Beans.get(MarketingService.class).create(view));
    return ResponseConstructor.build(Response.Status.CREATED, "View saved", view(saved[0]));
  }

  @POST
  @Path("/saved-views/{id}/delete")
  @Operation(summary = "Delete one of the caller's saved views", tags = {"IOETI marketing"})
  @IoetiEndpoint
  public Response deleteView(@PathParam("id") Long id) {
    SavedLeadView view = id == null ? null : JPA.find(SavedLeadView.class, id);
    if (view == null || !AuthUtils.getUser().equals(view.getOwner())) throw new ApiException(404, "NOT_FOUND", "Record not found.", null);
    SavedView deleted = view(view);
    write(() -> Beans.get(MarketingService.class).remove(view));
    return ResponseConstructor.build(Response.Status.OK, "View deleted", deleted);
  }

  // --- consent and attribution ---------------------------------------------------------------------

  @GET
  @Path("/leads/{id}/consents")
  @Operation(summary = "Consent and opt-out history of a lead, newest first, with the current state", tags = {"IOETI marketing"})
  @IoetiEndpoint
  public Response consents(@PathParam("id") Long id) {
    Lead lead = RecordAccess.readable(Lead.class, id);
    List<LeadConsentView> history = Query.of(LeadConsentEvent.class).filter("self.lead = ?1", lead).order("-occurredAt").order("-id")
        .fetch(200).stream().map(MarketingRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Consents",
        new ConsentState(List.of(new ChannelConsent(CHANNELS[0], !Boolean.TRUE.equals(lead.getIsDoNotSendEmail())),
            new ChannelConsent(CHANNELS[1], !Boolean.TRUE.equals(lead.getIsDoNotCall()))), history));
  }

  @POST
  @Path("/leads/{id}/consents")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Record consent or an opt-out for one channel (sets the native flag, keeps the history)", tags = {"IOETI marketing"})
  @IoetiEndpoint
  public Response recordConsent(@PathParam("id") Long id, RecordLeadConsent command) {
    Lead lead = writable(Lead.class, id, command == null ? null : command.version());
    int channel = select("channel", command.channel(), CHANNELS);
    int method = select("method", command.method(), METHODS);
    if (command.allowed() == null) throw ApiException.invalidField("allowed", "REQUIRED", "Say whether the channel is allowed.");
    String evidence = text("evidenceReference", command.evidenceReference(), 255, false);
    if (Boolean.TRUE.equals(command.allowed()) && evidence == null) {
      throw ApiException.invalidField("evidenceReference", "REQUIRED", "Consent needs an evidence reference; an opt-out does not.");
    }
    LeadConsentEvent[] saved = new LeadConsentEvent[1];
    write(() -> saved[0] = Beans.get(MarketingService.class).consent(lead, channel, command.allowed(), method, evidence));
    return ResponseConstructor.build(Response.Status.CREATED, "Consent recorded", view(saved[0]));
  }

  @GET
  @Path("/leads/{id}/attribution")
  @Operation(summary = "The lead's source and the campaigns it is attributed to (those the caller may read)", tags = {"IOETI marketing"})
  @IoetiEndpoint
  public Response attribution(@PathParam("id") Long id) {
    Lead lead = RecordAccess.readable(Lead.class, id);
    List<Option> campaigns = Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, Campaign.class)
        ? readable(Campaign.class, new JPQLFilter("? MEMBER OF self.leadSet", lead)).order("name").fetch(50).stream()
            .map(c -> new Option(c.getId(), c.getName())).toList()
        : List.of();
    Source source = lead.getSource();
    return ResponseConstructor.build(Response.Status.OK, "Attribution",
        new Attribution(source == null ? null : source.getId(), source == null ? null : source.getName(), campaigns));
  }

  @POST
  @Path("/leads/{id}/campaigns")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Attribute the lead to a native marketing campaign", tags = {"IOETI marketing"})
  @IoetiEndpoint
  public Response attribute(@PathParam("id") Long id, Attribute command) {
    Lead lead = writable(Lead.class, id, command == null ? null : command.version());
    Campaign campaign = campaign(command.campaignId());
    if (campaign == null) throw ApiException.invalidField("campaignId", "REQUIRED", "Choose a campaign.");
    if (!Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_WRITE, Campaign.class, campaign.getId())) {
      throw new ApiException(403, "FORBIDDEN", "You may not change this campaign.", null);
    }
    write(() -> Beans.get(MarketingService.class).attribute(lead, campaign));
    return attribution(lead.getId());
  }

  // --- activity timeline and follow-ups ------------------------------------------------------------

  @GET
  @Path("/leads/{id}/timeline")
  @Operation(summary = "The lead's activities (native CRM events) and consent changes, newest first", tags = {"IOETI marketing"})
  @IoetiEndpoint
  public Response timeline(@PathParam("id") Long id) {
    Lead lead = RecordAccess.readable(Lead.class, id);
    List<TimelineItem> items = new ArrayList<>();
    if (Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, Event.class)) {
      for (Event e : readable(Event.class, new JPQLFilter("self.eventLead.id = ?", lead.getId())).fetch(200)) {
        items.add(new TimelineItem(e.getStartDateTime(), "ACTIVITY_" + followUpType(e.getTypeSelect()), e.getSubject(),
            status(e.getStatusSelect()), e.getUser() == null ? null : e.getUser().getName(), e.getId()));
      }
    }
    for (LeadConsentEvent c : Query.of(LeadConsentEvent.class).filter("self.lead = ?1", lead).fetch(200)) {
      items.add(new TimelineItem(c.getOccurredAt(), Boolean.TRUE.equals(c.getAllowed()) ? "CONSENT_GIVEN" : "OPTED_OUT",
          name(c.getChannelSelect(), CHANNELS), null, c.getActor() == null ? null : c.getActor().getName(), null));
    }
    items.sort(Comparator.comparing(TimelineItem::at, Comparator.nullsLast(Comparator.naturalOrder())).reversed());
    return ResponseConstructor.build(Response.Status.OK, "Timeline", items);
  }

  @POST
  @Path("/leads/{id}/follow-ups")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Plan a follow-up (native CRM event) on a lead; nothing is sent", tags = {"IOETI marketing"})
  @IoetiEndpoint
  public Response planFollowUp(@PathParam("id") Long id, PlanFollowUp command) {
    Lead lead = writable(Lead.class, id, command == null ? null : command.version());
    new SecurityCheck().createAccess(Event.class).check();
    int type = FOLLOW_UP_NATIVE[select("type", command.type(), FOLLOW_UP_TYPES) - 1];
    String subject = text("subject", command.subject(), 255, true);
    LocalDateTime at;
    try {
      at = LocalDateTime.parse(command.at());
    } catch (DateTimeParseException | NullPointerException e) {
      throw ApiException.invalidField("at", "FORMAT", "Use a date and time like 2026-11-01T10:00.");
    }
    Event[] saved = new Event[1];
    write(() -> saved[0] = Beans.get(MarketingService.class).followUp(lead, subject, at, type));
    return ResponseConstructor.build(Response.Status.CREATED, "Follow-up planned", view(saved[0]));
  }

  @GET
  @Path("/follow-ups")
  @Operation(summary = "The caller's planned lead follow-ups; overdue first", tags = {"IOETI marketing"})
  @IoetiEndpoint
  public Response followUps(@QueryParam("overdue") Boolean overdue) {
    new SecurityCheck().readAccess(Event.class).check();
    String condition = "self.eventLead IS NOT NULL AND self.user = ? AND self.statusSelect = ?"
        + (Boolean.TRUE.equals(overdue) ? " AND self.startDateTime < ?" : "");
    Object[] params = Boolean.TRUE.equals(overdue)
        ? new Object[] {AuthUtils.getUser(), EventRepository.STATUS_PLANNED, LocalDateTime.now()}
        : new Object[] {AuthUtils.getUser(), EventRepository.STATUS_PLANNED};
    List<FollowUpView> rows = readable(Event.class, new JPQLFilter(condition, params)).order("startDateTime").fetch(200).stream()
        .map(MarketingRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Follow-ups", rows);
  }

  @POST
  @Path("/follow-ups/{id}/done")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Mark a follow-up done", tags = {"IOETI marketing"})
  @IoetiEndpoint
  public Response done(@PathParam("id") Long id, VersionOnly command) {
    Event event = writable(Event.class, id, command == null ? null : command.version());
    if (event.getEventLead() == null) throw new ApiException(404, "NOT_FOUND", "Record not found.", null);
    write(() -> Beans.get(MarketingService.class).done(event));
    return ResponseConstructor.build(Response.Status.OK, "Follow-up done", view(event));
  }

  @POST
  @Path("/leads/{id}/route")
  @Operation(summary = "Route the lead automatically: blocked until routing and response targets (D-12)", tags = {"IOETI marketing"})
  @IoetiEndpoint
  public Response route(@PathParam("id") Long id) {
    RecordAccess.writable(Lead.class, id);
    throw ApiException.policyBlocked("D-12");
  }

  // --- helpers -------------------------------------------------------------------------------------

  private static <T> T found(String field, T record) {
    if (record == null) throw ApiException.invalidField(field, "UNAVAILABLE", "Choose a configured value.");
    return record;
  }

  private static BusinessLine businessLine(String code) {
    BusinessLine line = Query.of(BusinessLine.class).filter("self.code = ?1", code).fetchOne();
    if (line == null || !Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, BusinessLine.class, line.getId())) {
      throw ApiException.invalidField("businessLineCode", "UNAVAILABLE", "Choose a business line you can see.");
    }
    return line;
  }

  private static Campaign campaign(Long id) {
    if (id == null) return null;
    Campaign campaign = id <= 0 ? null : JPA.find(Campaign.class, id);
    if (campaign == null || !Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, Campaign.class, campaign.getId())) {
      throw ApiException.invalidField("campaignId", "UNAVAILABLE", "Choose a campaign you can see.");
    }
    return campaign;
  }

  private static <T extends Model> Query<T> readable(Class<T> type, Filter condition) {
    Filter security = Beans.get(JpaSecurity.class).getFilter(JpaSecurity.CAN_READ, type);
    Filter combined = security == null ? condition : condition == null ? security : Filter.and(security, condition);
    return combined == null ? Query.of(type) : combined.build(type);
  }

  private static <T extends AuditableModel> T writable(Class<T> type, Long id, Integer version) {
    if (version == null) throw ApiException.badRequest("Record version is required.");
    T record = RecordAccess.writable(type, id);
    ConflictChecker.checkVersion(record, version);
    return record;
  }

  private static void write(Runnable command) {
    OptimisticLockConflicts.translate(command::run);
  }

  static int select(String field, String value, String... names) {
    for (int i = 0; i < names.length; i++) if (names[i].equals(value)) return i + 1;
    throw ApiException.invalidField(field, "UNAVAILABLE", "Use one of " + String.join(", ", names) + ".");
  }

  static String name(Integer select, String... names) {
    return select == null || select < 1 || select > names.length ? null : names[select - 1];
  }

  static String text(String field, String value, int max, boolean required) {
    String text = value == null ? null : value.strip();
    if (text == null || text.isEmpty()) {
      if (required) throw ApiException.invalidField(field, "REQUIRED", "This field is required.");
      return null;
    }
    if (text.length() > max) throw ApiException.invalidField(field, "TOO_LONG", "This field can have at most " + max + " characters.");
    return text;
  }

  static String followUpType(Integer nativeType) {
    for (int i = 0; i < FOLLOW_UP_NATIVE.length; i++) if (Integer.valueOf(FOLLOW_UP_NATIVE[i]).equals(nativeType)) return FOLLOW_UP_TYPES[i];
    return "OTHER";
  }

  static String status(Integer select) {
    if (Integer.valueOf(EventRepository.STATUS_PLANNED).equals(select)) return "PLANNED";
    if (Integer.valueOf(EventRepository.STATUS_REALIZED).equals(select)) return "DONE";
    if (Integer.valueOf(EventRepository.STATUS_CANCELED).equals(select)) return "CANCELLED";
    return null;
  }

  static SavedView view(SavedLeadView v) {
    return new SavedView(v.getId(), v.getName(), v.getSearchText(), v.getStage() == null ? null : v.getStage().getId(),
        v.getSource() == null ? null : v.getSource().getId(), v.getBusinessLine() == null ? null : v.getBusinessLine().getCode(),
        Boolean.TRUE.equals(v.getOnlyMine()));
  }

  static LeadConsentView view(LeadConsentEvent c) {
    return new LeadConsentView(c.getId(), name(c.getChannelSelect(), CHANNELS), Boolean.TRUE.equals(c.getAllowed()),
        name(c.getMethodSelect(), METHODS), c.getEvidenceReference(), c.getActor() == null ? null : c.getActor().getName(), c.getOccurredAt());
  }

  static FollowUpView view(Event e) {
    Lead lead = e.getEventLead();
    boolean overdue = Integer.valueOf(EventRepository.STATUS_PLANNED).equals(e.getStatusSelect())
        && e.getStartDateTime() != null && e.getStartDateTime().isBefore(LocalDateTime.now());
    String leadName = lead == null ? null : ((lead.getFirstName() == null ? "" : lead.getFirstName() + " ") + lead.getName()).strip();
    return new FollowUpView(e.getId(), e.getVersion(), followUpType(e.getTypeSelect()), e.getSubject(), e.getStartDateTime(),
        status(e.getStatusSelect()), overdue, lead == null ? null : lead.getId(), leadName);
  }

  public record VersionOnly(Integer version) {}
  public record Intake(
      String firstName, String name, String organization, String email, String phone, String businessLineCode, Long sourceId,
      Long campaignId, Boolean confirmNotDuplicate) {}
  public record EditLead(
      Integer version, String firstName, String name, String organization, String email, String phone, String businessLineCode,
      Long sourceId, Boolean confirmNotDuplicate) {}
  public record SaveView(String name, String searchText, Long stageId, Long sourceId, String businessLineCode, Boolean onlyMine) {}
  public record RecordLeadConsent(Integer version, String channel, Boolean allowed, String method, String evidenceReference) {}
  public record Attribute(Integer version, Long campaignId) {}
  public record PlanFollowUp(Integer version, String type, String subject, String at) {}
  public record Option(Long id, String name) {}
  public record AddSource(String name) {}
  public record SavedView(Long id, String name, String searchText, Long stageId, Long sourceId, String businessLineCode, boolean onlyMine) {}
  public record LeadConsentView(Long id, String channel, boolean allowed, String method, String evidenceReference, String recordedBy, LocalDateTime at) {}
  public record ChannelConsent(String channel, boolean allowed) {}
  public record ConsentState(List<ChannelConsent> channels, List<LeadConsentView> history) {}
  public record Attribution(Long sourceId, String sourceName, List<Option> campaigns) {}
  public record TimelineItem(LocalDateTime at, String kind, String label, String status, String actorName, Long eventId) {}
  public record FollowUpView(
      Long id, Integer version, String type, String subject, LocalDateTime at, String status, boolean overdue, Long leadId, String leadName) {}
}
