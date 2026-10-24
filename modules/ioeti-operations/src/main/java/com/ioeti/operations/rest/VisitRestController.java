package com.ioeti.operations.rest;

import com.axelor.apps.base.AxelorException;
import com.axelor.apps.base.db.Partner;
import com.axelor.apps.base.db.repo.TraceBackRepository;
import com.axelor.apps.base.service.app.AppBaseService;
import com.axelor.apps.contract.db.Contract;
import com.axelor.apps.crm.db.Opportunity;
import com.axelor.apps.intervention.db.AnswerValue;
import com.axelor.apps.intervention.db.Intervention;
import com.axelor.apps.intervention.db.InterventionQuestion;
import com.axelor.apps.intervention.db.InterventionRange;
import com.axelor.apps.intervention.db.InterventionType;
import com.axelor.auth.AuthUtils;
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
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.IoetiEndpoint;
import com.ioeti.core.api.RecordAccess;
import com.ioeti.core.web.OptimisticLockConflicts;
import com.ioeti.operations.db.VisitNote;
import com.ioeti.content.service.ContentService;
import com.ioeti.operations.service.VisitChecklistService;
import com.ioeti.operations.service.VisitService;
import com.axelor.apps.intervention.service.helper.InterventionQuestionHelper;
import com.axelor.meta.MetaFiles;
import com.axelor.meta.db.MetaFile;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.time.LocalDate;
import java.util.Base64;
import java.util.Comparator;
import java.util.Set;
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
import java.time.DateTimeException;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

/**
 * Field visits from the platform: plan a visit to a client, assign who goes and when, start, pause,
 * finish or cancel it on site, and keep its notes. Native intervention permissions decide on every call;
 * the client account must be one the caller may read. Times are wall-clock times judged in the caller's
 * own time zone. Nothing is sent to the customer (D-10).
 */
@Path("/ioeti/visits")
@Produces(MediaType.APPLICATION_JSON)
public class VisitRestController {

  private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(VisitRestController.class);

  @GET
  @Operation(summary = "Visits the caller may read: mine (assigned to me) or all, optionally by status", tags = {"IOETI visits"})
  @IoetiEndpoint
  public Response list(@QueryParam("mine") Boolean mine, @QueryParam("status") String status) {
    new SecurityCheck().readAccess(Intervention.class).check();
    List<String> where = new ArrayList<>(List.of("self.deliveredPartner IS NOT NULL"));
    List<Object> params = new ArrayList<>();
    if (Boolean.TRUE.equals(mine)) { where.add("self.assignedTo = ?"); params.add(AuthUtils.getUser()); }
    if (status != null && !status.isBlank()) {
      int code = switch (status.strip()) {
        case "TO_PLAN" -> VisitService.TO_PLAN; case "PLANNED" -> VisitService.PLANNED; case "STARTED" -> VisitService.STARTED;
        case "SUSPENDED" -> VisitService.SUSPENDED; case "FINISHED" -> VisitService.FINISHED; case "CANCELLED" -> VisitService.CANCELLED;
        default -> throw ApiException.invalidField("status", "UNAVAILABLE", "Use TO_PLAN, PLANNED, STARTED, SUSPENDED, FINISHED or CANCELLED.");
      };
      where.add("self.statusSelect = ?"); params.add(code);
    }
    List<VisitView> rows = readable(Intervention.class, new JPQLFilter(String.join(" AND ", where), params.toArray()))
        .order("planifStartDateTime").order("-id").fetch(300).stream().map(VisitRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Visits", rows);
  }

  @GET
  @Path("/{id}")
  @Operation(summary = "One visit with its notes", tags = {"IOETI visits"})
  @IoetiEndpoint
  public Response get(@PathParam("id") Long id) {
    Intervention visit = RecordAccess.readable(Intervention.class, id);
    List<VisitNoteView> notes = Query.of(VisitNote.class).filter("self.visit = ?1", visit).order("-writtenAt").order("-id").fetch(200).stream()
        .map(n -> new VisitNoteView(n.getId(), n.getBody(), n.getWrittenAt(), n.getAuthor() == null ? null : n.getAuthor().getName(),
            n.getAuthor() != null && n.getAuthor().equals(AuthUtils.getUser()))).toList();
    return ResponseConstructor.build(Response.Status.OK, "Visit", new VisitDetail(view(visit), notes));
  }

  @POST
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Plan a visit to a client account (native create permission on interventions)", tags = {"IOETI visits"})
  @IoetiEndpoint
  public Response create(NewVisit command) {
    new SecurityCheck().createAccess(Intervention.class).check();
    if (command == null || command.accountId() == null) throw ApiException.invalidField("accountId", "REQUIRED", "Choose the client account.");
    Partner account = RecordAccess.readable(Partner.class, command.accountId());
    if (!Boolean.TRUE.equals(account.getIsCustomer()) && !Boolean.TRUE.equals(account.getIsProspect())) throw ApiException.notFound();
    Intervention visit = new Intervention();
    visit.setDeliveredPartner(account);
    visit.setInvoicedPartner(account);
    visit.setDescription(text("purpose", command.purpose(), 4000, true));
    if (command.typeId() != null) {
      InterventionType type = JPA.find(InterventionType.class, command.typeId());
      if (type == null) throw ApiException.invalidField("typeId", "UNAVAILABLE", "Choose an existing visit type.");
      visit.setInterventionType(type);
    }
    if (command.opportunityId() != null) visit.setOpportunity(RecordAccess.readable(Opportunity.class, command.opportunityId()));
    if (command.contractId() != null) visit.setContract(RecordAccess.readable(Contract.class, command.contractId()));
    User me = AuthUtils.getUser();
    if (me != null && me.getActiveCompany() != null) visit.setCompany(me.getActiveCompany());
    User assignee = command.assignedToId() == null ? null : person(command.assignedToId());
    LocalDateTime start = time("start", command.start()), end = time("end", command.end());
    check(start, end, command.zone(), assignee != null || start != null);
    Intervention[] saved = new Intervention[1];
    try {
      OptimisticLockConflicts.translate(() -> saved[0] = Beans.get(VisitService.class).create(visit, assignee, start, end));
    } catch (RuntimeException e) {
      Integer category = nativeCategory(e);
      if (category != null && category == TraceBackRepository.CATEGORY_CONFIGURATION_ERROR) {
        throw new ApiException(422, "NUMBERING_REQUIRED", "Visit numbering is not set up; an administrator sets it under Numbering.", null);
      }
      if (category != null && category == TraceBackRepository.CATEGORY_MISSING_FIELD) {
        throw new ApiException(422, "ADDRESS_REQUIRED", "This visit type needs the client's address and company.", null);
      }
      throw e;
    }
    prepareChecklist(saved[0]);
    return ResponseConstructor.build(Response.Status.CREATED, "Visit added", view(reloaded(saved[0].getId())));
  }

  @POST
  @Path("/{id}/plan")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Assign the visit and set when it takes place (also reschedules)", tags = {"IOETI visits"})
  @IoetiEndpoint
  public Response plan(@PathParam("id") Long id, PlanVisit command) {
    Intervention visit = versioned(id, command == null ? null : command.version());
    if (command.assignedToId() == null) throw ApiException.invalidField("assignedToId", "REQUIRED", "Choose who makes the visit.");
    User assignee = person(command.assignedToId());
    LocalDateTime start = time("start", command.start()), end = time("end", command.end());
    check(start, end, command.zone(), true);
    Intervention[] saved = new Intervention[1];
    OptimisticLockConflicts.translate(() -> saved[0] = Beans.get(VisitService.class).plan(visit, assignee, start, end));
    prepareChecklist(saved[0]);
    return ResponseConstructor.build(Response.Status.OK, "Visit planned", view(reloaded(saved[0].getId())));
  }

  @POST
  @Path("/{id}/{command:start|suspend|finish|cancel}")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Start, pause, finish or cancel the visit (native rules)", tags = {"IOETI visits"})
  @IoetiEndpoint
  public Response command(@PathParam("id") Long id, @PathParam("command") String command, VisitCommand body) {
    Intervention visit = versioned(id, body == null ? null : body.version());
    LocalDateTime now = now(body.zone());
    VisitService service = Beans.get(VisitService.class);
    return run(() -> switch (command) {
      case "start" -> service.start(visit, now);
      case "suspend" -> service.suspend(visit, now);
      case "finish" -> service.finish(visit, now);
      default -> service.cancel(visit);
    }, "Visit updated");
  }

  @POST
  @Path("/{id}/notes")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Add a note to the visit (what was seen, agreed or needs follow-up)", tags = {"IOETI visits"})
  @IoetiEndpoint
  public Response note(@PathParam("id") Long id, AddVisitNote command) {
    Intervention visit = versioned(id, command == null ? null : command.version());
    String body = text("text", command.text(), 4000, true);
    LocalDateTime now = now(command.zone());
    VisitNote[] saved = new VisitNote[1];
    OptimisticLockConflicts.translate(() -> saved[0] = Beans.get(VisitService.class).note(visit, body, now));
    return ResponseConstructor.build(Response.Status.CREATED, "Note added",
        new VisitNoteView(saved[0].getId(), saved[0].getBody(), saved[0].getWrittenAt(), AuthUtils.getUser().getName(), true));
  }

  @GET
  @Path("/types")
  @Operation(summary = "Visit types (native intervention types)", tags = {"IOETI visits"})
  @IoetiEndpoint
  public Response types() {
    new SecurityCheck().readAccess(Intervention.class).check();
    return ResponseConstructor.build(Response.Status.OK, "Visit types",
        Query.of(InterventionType.class).order("name").fetch(200).stream().map(t -> new VisitOption(t.getId(), t.getName())).toList());
  }

  @GET
  @Path("/people")
  @Operation(summary = "Active people a visit can be assigned to (callers who may plan visits)", tags = {"IOETI visits"})
  @IoetiEndpoint
  public Response people() {
    new SecurityCheck().writeAccess(Intervention.class).check();
    return ResponseConstructor.build(Response.Status.OK, "People",
        Query.of(User.class).filter("self.blocked IS NULL OR self.blocked = false").order("name").fetch(300).stream()
            .map(u -> new VisitOption(u.getId(), u.getName())).toList());
  }

  // --- the checklist (native survey) --------------------------------------------------------------

  @GET
  @Path("/{id}/checklist")
  @Operation(summary = "The visit's checklist from its type's native ranges, with answers and what is still required", tags = {"IOETI visits"})
  @IoetiEndpoint
  public Response checklist(@PathParam("id") Long id) {
    Intervention visit = RecordAccess.readable(Intervention.class, id);
    return ResponseConstructor.build(Response.Status.OK, "Checklist", checklistView(visit, null));
  }

  @POST
  @Path("/{id}/checklist/prepare")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Generate or update the checklist from the visit type (native generator), for a planned or running visit", tags = {"IOETI visits"})
  @IoetiEndpoint
  public Response prepareChecklist(@PathParam("id") Long id, VisitCommand body) {
    Intervention visit = versioned(id, body == null ? null : body.version());
    int status = visit.getStatusSelect() == null ? VisitService.TO_PLAN : visit.getStatusSelect();
    if (status < VisitService.PLANNED || status >= VisitService.FINISHED) {
      throw new ApiException(422, "STATUS_NOT_ALLOWED", "The checklist is prepared for a planned or running visit.", null);
    }
    if (!VisitChecklistService.hasTemplate(visit)) {
      throw new ApiException(422, "NO_CHECKLIST", "This visit type has no checklist.", null);
    }
    String message = Beans.get(VisitChecklistService.class).generate(visit);
    return ResponseConstructor.build(Response.Status.OK, "Checklist", checklistView(reloaded(id), message));
  }

  @POST
  @Path("/{id}/checklist/{questionId}")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Answer one checklist item on site (or clear the answer), with the item's version", tags = {"IOETI visits"})
  @IoetiEndpoint
  public Response answer(@PathParam("id") Long id, @PathParam("questionId") Long questionId, AnswerChecklistItem body) {
    Intervention visit = RecordAccess.writable(Intervention.class, id);
    InterventionQuestion question = question(visit, questionId, body == null ? null : body.version());
    VisitChecklistService.checkAnswerable(visit, question);
    VisitChecklistService service = Beans.get(VisitChecklistService.class);
    boolean clear = Boolean.TRUE.equals(body.clear());
    OptimisticLockConflicts.translate(() -> {
      switch (question.getAnswerTypeSelect()) {
        case "list" -> {
          AnswerValue value = null;
          if (!clear) {
            if (body.choiceId() == null) throw ApiException.invalidField("choiceId", "REQUIRED", "Choose an answer.");
            value = question.getAnswerValueList() == null ? null
                : question.getAnswerValueList().stream().filter(v -> v.getId().equals(body.choiceId())).findFirst().orElse(null);
            if (value == null) throw ApiException.invalidField("choiceId", "UNAVAILABLE", "Choose one of the item's answers.");
          }
          service.answerList(question, value);
        }
        case "text" -> service.answerText(question, clear ? null : text("text", body.text(), 4000, true));
        case "date" -> service.answerDate(question, clear ? null : date(body.date()));
        case "measure" -> {
          if (!clear && body.measure() == null) throw ApiException.invalidField("measure", "REQUIRED", "Give the measured value.");
          service.answerMeasure(question, clear ? null : body.measure());
        }
        case "checkbox" -> {
          if (!clear && body.checked() == null) throw ApiException.invalidField("checked", "REQUIRED", "Tick or untick the item.");
          service.answerCheckbox(question, clear ? null : body.checked());
        }
        default -> {
          // photos and signatures are uploaded as files; here they can only be cleared
          if (!clear) throw ApiException.invalidField("content", "REQUIRED", "Upload the photo or signature as a file.");
          service.answerFile(question, null, null);
        }
      }
    });
    return ResponseConstructor.build(Response.Status.OK, "Answered", checklistView(JPA.find(Intervention.class, id), null));
  }

  @POST
  @Path("/{id}/checklist/{questionId}/file")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Answer a photo or signature item with a PNG or JPEG image (checked like any upload)", tags = {"IOETI visits"})
  @IoetiEndpoint
  public Response answerFile(@PathParam("id") Long id, @PathParam("questionId") Long questionId, UploadChecklistFile body) {
    Intervention visit = RecordAccess.writable(Intervention.class, id);
    InterventionQuestion question = question(visit, questionId, body == null ? null : body.version());
    VisitChecklistService.checkAnswerable(visit, question);
    if (!Set.of("picture", "signature").contains(question.getAnswerTypeSelect())) {
      throw new ApiException(422, "NOT_A_FILE_ITEM", "This item is not answered with a photo or a signature.", null);
    }
    if (body.contentBase64() == null || body.contentBase64().isBlank()) throw ApiException.invalidField("content", "REQUIRED", "The image is empty.");
    if (body.contentBase64().length() > (ContentService.MAX_BYTES / 3 + 1) * 4 + 8) {
      throw ApiException.invalidField("content", "TOO_LARGE", "Images can be at most 10 MiB.");
    }
    byte[] bytes;
    try { bytes = Base64.getDecoder().decode(body.contentBase64().strip()); }
    catch (IllegalArgumentException e) { throw ApiException.invalidField("content", "FORMAT", "The image is not valid base64."); }
    ContentService.Upload upload = ContentService.check(body.fileName(), bytes);
    if (!Set.of("png", "jpg", "jpeg").contains(upload.extension())) {
      throw ApiException.invalidField("fileName", "TYPE_NOT_ALLOWED", "Use a PNG or JPEG image.");
    }
    OptimisticLockConflicts.translate(() -> Beans.get(VisitChecklistService.class).answerFile(question, upload.fileName(), upload.bytes()));
    return ResponseConstructor.build(Response.Status.OK, "Answered", checklistView(JPA.find(Intervention.class, id), null));
  }

  @GET
  @Path("/{id}/checklist/{questionId}/file")
  @Produces({"image/png", "image/jpeg"})
  @Operation(summary = "The photo or signature given for a checklist item", tags = {"IOETI visits"})
  @IoetiEndpoint
  public Response answerFileContent(@PathParam("id") Long id, @PathParam("questionId") Long questionId) {
    Intervention visit = RecordAccess.readable(Intervention.class, id);
    InterventionQuestion question = question(visit, questionId, null);
    MetaFile file = "signature".equals(question.getAnswerTypeSelect()) ? question.getSignatureAnswer() : question.getPictureAnswer();
    if (file == null) throw ApiException.notFound();
    java.nio.file.Path path = MetaFiles.getPath(file);
    if (path == null || !Files.isRegularFile(path)) throw new ApiException(410, "FILE_MISSING", "The stored image is missing.", null);
    String type = "image/png".equals(file.getFileType()) ? "image/png" : "image/jpeg";
    return Response.ok(path.toFile(), type)
        .header("Content-Disposition", "inline")
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "private, no-store")
        .header("Content-Security-Policy", "default-src 'none'; sandbox")
        .build();
  }

  // --- helpers -------------------------------------------------------------------------------------

  private Response run(java.util.function.Supplier<Intervention> action, String message) {
    Intervention[] saved = new Intervention[1];
    OptimisticLockConflicts.translate(() -> saved[0] = action.get());
    return ResponseConstructor.build(Response.Status.OK, message, view(saved[0]));
  }

  /**
   * Generates the checklist once a visit with a checklist is planned, as native planning does. The visit is
   * already saved: a generation failure is logged and the checklist can be prepared later from the visit.
   */
  private static void prepareChecklist(Intervention visit) {
    int status = visit.getStatusSelect() == null ? VisitService.TO_PLAN : visit.getStatusSelect();
    if (status >= VisitService.PLANNED && status < VisitService.FINISHED && VisitChecklistService.hasTemplate(visit)) {
      try {
        Beans.get(VisitChecklistService.class).generate(visit);
      } catch (RuntimeException e) {
        LOG.warn("Checklist generation failed for visit {}; it can be prepared from the visit", visit.getId(), e);
      }
    }
  }

  /** The visit as stored now: the native checklist generator changes it from another thread. */
  private static Intervention reloaded(Long id) {
    Intervention visit = JPA.find(Intervention.class, id);
    JPA.em().refresh(visit);
    return visit;
  }

  private static InterventionQuestion question(Intervention visit, Long questionId, Integer version) {
    InterventionQuestion question = questionId == null ? null : Query.of(InterventionQuestion.class)
        .filter("self.id = ?1 AND self.interventionRange.intervention = ?2", questionId, visit).fetchOne();
    if (question == null) throw ApiException.notFound();
    if (version != null) ConflictChecker.checkVersion(question, version);
    return question;
  }

  private static LocalDate date(String value) {
    if (value == null || value.isBlank()) throw ApiException.invalidField("date", "REQUIRED", "Give the date.");
    try { return LocalDate.parse(value.strip()); }
    catch (DateTimeParseException e) { throw ApiException.invalidField("date", "FORMAT", "Use a date like 2026-11-01."); }
  }

  static ChecklistView checklistView(Intervention visit, String message) {
    boolean template = VisitChecklistService.hasTemplate(visit);
    List<InterventionRange> ranges = Query.of(InterventionRange.class).filter("self.intervention = ?1", visit).order("orderSeq").order("id").fetch(200);
    int status = visit.getStatusSelect() == null ? VisitService.TO_PLAN : visit.getStatusSelect();
    boolean canAnswer = (status == VisitService.STARTED || status == VisitService.SUSPENDED)
        && Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_WRITE, Intervention.class, visit.getId());
    long requiredOpen = 0;
    List<ChecklistSectionView> sections = new ArrayList<>();
    for (InterventionRange range : ranges) {
      List<InterventionQuestion> questions = range.getInterventionQuestionList() == null ? List.of()
          : range.getInterventionQuestionList().stream().sorted(Comparator.comparing((InterventionQuestion q) -> q.getOrderSeq() == null ? 0L : q.getOrderSeq())
              .thenComparing(InterventionQuestion::getId)).toList();
      List<ChecklistItemView> items = new ArrayList<>();
      for (InterventionQuestion q : questions) {
        boolean active = InterventionQuestionHelper.isActive(q);
        boolean answered = Boolean.TRUE.equals(q.getIsAnswered());
        boolean required = Boolean.TRUE.equals(q.getIsRequired());
        if (required && !answered) requiredOpen++;
        List<ChecklistChoice> choices = q.getAnswerValueList() == null ? List.of()
            : q.getAnswerValueList().stream().sorted(Comparator.comparing((AnswerValue v) -> v.getSequence() == null ? 0 : v.getSequence()).thenComparing(AnswerValue::getId))
                .map(v -> new ChecklistChoice(v.getId(), v.getName(), Boolean.TRUE.equals(v.getNonConforming()))).toList();
        AnswerValue chosen = q.getListAnswer();
        MetaFile file = "signature".equals(q.getAnswerTypeSelect()) ? q.getSignatureAnswer() : q.getPictureAnswer();
        items.add(new ChecklistItemView(q.getId(), q.getVersion(), q.getTitle(), q.getIndication(), q.getAnswerTypeSelect(), required, active, answered,
            VisitChecklistService.ANSWERABLE.contains(q.getAnswerTypeSelect()), q.getDesiredUnit() == null ? null : q.getDesiredUnit().getName(),
            q.getCheckboxName(), q.getIndicationText(), choices, chosen == null ? null : chosen.getId(), q.getTextAnswer(), q.getDateAnswer(),
            q.getMeasureAnswer(), q.getCheckboxAnswer(), file != null, chosen != null && Boolean.TRUE.equals(chosen.getNonConforming())));
      }
      sections.add(new ChecklistSectionView(range.getId(), range.getRangeVal() == null ? range.getName() : range.getRangeVal().getTitle(), items));
    }
    return new ChecklistView(template, !ranges.isEmpty(), Boolean.TRUE.equals(visit.getIsSurveyGenerationRunning()), canAnswer, requiredOpen,
        message, sections);
  }

  /** The category of a native error raised while saving (the native repository wraps it), if any. */
  private static Integer nativeCategory(Throwable e) {
    for (Throwable t = e; t != null; t = t.getCause()) {
      if (t instanceof AxelorException axelor) return axelor.getCategory();
    }
    return null;
  }

  private static Intervention versioned(Long id, Integer version) {
    if (version == null) throw ApiException.badRequest("Record version is required.");
    Intervention visit = RecordAccess.writable(Intervention.class, id);
    ConflictChecker.checkVersion(visit, version);
    return visit;
  }

  private static User person(Long id) {
    User user = JPA.find(User.class, id);
    if (user == null || Boolean.TRUE.equals(user.getBlocked())) throw ApiException.invalidField("assignedToId", "UNAVAILABLE", "Choose an active person.");
    return user;
  }

  private static String text(String field, String value, int max, boolean required) {
    String text = value == null ? null : value.strip();
    if (text == null || text.isEmpty()) {
      if (required) throw ApiException.invalidField(field, "REQUIRED", "This field is required.");
      return null;
    }
    if (text.length() > max) throw ApiException.invalidField(field, "TOO_LONG", "This field can have at most " + max + " characters.");
    return text;
  }

  private static LocalDateTime time(String field, String value) {
    if (value == null || value.isBlank()) return null;
    try { return LocalDateTime.parse(value.strip()).truncatedTo(ChronoUnit.MINUTES); }
    catch (DateTimeParseException e) { throw ApiException.invalidField(field, "FORMAT", "Use a date and time like 2026-11-01T10:00."); }
  }

  /** A planned visit needs who and when, cannot start in the past, and ends after it starts. */
  private static void check(LocalDateTime start, LocalDateTime end, String zone, boolean planning) {
    if (!planning) return;
    if (start == null) throw ApiException.invalidField("start", "REQUIRED", "Choose when the visit takes place.");
    if (start.isBefore(now(zone).minusMinutes(10))) throw ApiException.invalidField("start", "PAST", "A visit cannot be planned in the past.");
    if (end != null && !end.isAfter(start)) throw ApiException.invalidField("end", "BEFORE_START", "The end must be after the start.");
  }

  /** The caller's wall-clock now: their browser's zone, else the company's native "today". */
  static LocalDateTime now(String zone) {
    if (zone != null && !zone.isBlank()) {
      try { return LocalDateTime.now(ZoneId.of(zone.strip())).truncatedTo(ChronoUnit.MINUTES); }
      catch (DateTimeException e) { throw ApiException.invalidField("zone", "UNKNOWN", "Unknown time zone."); }
    }
    User me = AuthUtils.getUser();
    return Beans.get(AppBaseService.class).getTodayDateTime(me == null ? null : me.getActiveCompany()).toLocalDateTime().truncatedTo(ChronoUnit.MINUTES);
  }

  private static <T extends Model> Query<T> readable(Class<T> type, Filter condition) {
    Filter security = Beans.get(JpaSecurity.class).getFilter(JpaSecurity.CAN_READ, type);
    Filter combined = security == null ? condition : condition == null ? security : Filter.and(security, condition);
    return combined == null ? Query.of(type) : combined.build(type);
  }

  static VisitView view(Intervention v) {
    Partner account = v.getDeliveredPartner();
    boolean canReadAccount = account != null && Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, Partner.class, account.getId());
    return new VisitView(v.getId(), v.getVersion(), v.getSequence(), VisitService.status(v), v.getDescription(),
        canReadAccount ? account.getId() : null, canReadAccount ? account.getName() : null,
        v.getInterventionType() == null ? null : v.getInterventionType().getName(),
        v.getAssignedTo() == null ? null : v.getAssignedTo().getId(), v.getAssignedTo() == null ? null : v.getAssignedTo().getName(),
        v.getAssignedTo() != null && v.getAssignedTo().equals(AuthUtils.getUser()),
        v.getPlanifStartDateTime(), v.getPlanifEndDateTime(), v.getStartDateTime(), v.getEndDateTime(), v.getTotalDuration(),
        v.getOpportunity() == null ? null : v.getOpportunity().getId(), v.getContract() == null ? null : v.getContract().getId());
  }

  public record NewVisit(Long accountId, String purpose, Long typeId, Long opportunityId, Long contractId, Long assignedToId, String start,
      String end, String zone) {}

  public record PlanVisit(Integer version, Long assignedToId, String start, String end, String zone) {}

  public record VisitCommand(Integer version, String zone) {}

  public record AddVisitNote(Integer version, String text, String zone) {}

  public record VisitView(Long id, Integer version, String reference, String status, String purpose, Long accountId, String accountName,
      String type, Long assigneeId, String assigneeName, boolean mine, LocalDateTime plannedStart, LocalDateTime plannedEnd,
      LocalDateTime startedAt, LocalDateTime finishedAt, Long durationSeconds, Long opportunityId, Long contractId) {}

  public record VisitNoteView(Long id, String text, LocalDateTime at, String authorName, boolean mine) {}

  public record VisitDetail(VisitView visit, List<VisitNoteView> log) {}

  public record VisitOption(Long id, String name) {}

  public record AnswerChecklistItem(Integer version, Long choiceId, String text, String date, BigDecimal measure, Boolean checked, Boolean clear) {}

  public record UploadChecklistFile(Integer version, String fileName, String contentBase64) {}

  /** The visit's checklist: available = the visit type has one; requiredOpen counts required items not answered. */
  public record ChecklistView(boolean available, boolean generated, boolean generating, boolean canAnswer, long requiredOpen, String message,
      List<ChecklistSectionView> sections) {}

  public record ChecklistSectionView(Long id, String title, List<ChecklistItemView> items) {}

  /** One checklist item; type is the native answer type; nonConforming marks an answer the company flagged as such. */
  public record ChecklistItemView(Long id, Integer version, String title, String hint, String type, boolean required, boolean active,
      boolean answered, boolean answerable, String unit, String checkboxLabel, String indicationText, List<ChecklistChoice> choices,
      Long choiceId, String text, LocalDate date, BigDecimal measure, Boolean checked, boolean hasFile, boolean nonConforming) {}

  public record ChecklistChoice(Long id, String name, boolean nonConforming) {}
}
