package com.ioeti.automation.rest;

import com.axelor.apps.crm.db.Lead;
import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.User;
import com.axelor.db.JPA;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.axelor.utils.api.ConflictChecker;
import com.axelor.utils.api.ResponseConstructor;
import com.ioeti.automation.db.InboxNotice;
import com.ioeti.automation.db.OutboundMessage;
import com.ioeti.automation.db.repo.OutboundMessageRepository;
import com.ioeti.automation.service.AutomationService;
import com.ioeti.content.service.ContentService;
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
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * The caller's in-app inbox, mentions between colleagues, and the outbox of messages to leads
 * (Wave 7b). Nothing here sends anything outside the CRM: outbound channels are D-10, and automatic
 * reminders or escalations are D-12.
 */
@Path("/ioeti/automation")
@Produces(MediaType.APPLICATION_JSON)
public class AutomationRestController {

  static final String[] CHANNELS = {"EMAIL"};
  static final String[] OUTBOX_STATUSES = {"DRAFT", "CANCELLED"};
  static final int MAX_MESSAGE = 280;
  static final int MAX_BODY = 20_000;

  // --- inbox ---------------------------------------------------------------------------------------

  @GET
  @Path("/inbox")
  @Operation(summary = "The caller's notices, newest first", tags = {"IOETI automation"})
  @IoetiEndpoint
  public Response inbox(@QueryParam("unread") Boolean unread, @QueryParam("limit") Integer limit) {
    int size = limit == null ? 50 : limit;
    if (size < 1 || size > 100) throw ApiException.badRequest("Invalid limit.");
    List<NoticeView> rows = Query.of(InboxNotice.class)
        .filter("self.recipient = ?1" + (Boolean.TRUE.equals(unread) ? " AND (self.seen IS NULL OR self.seen = false)" : ""), AuthUtils.getUser())
        .order("-createdAt").order("-id").fetch(size).stream().map(AutomationRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Inbox", rows);
  }

  @GET
  @Path("/inbox/count")
  @Operation(summary = "How many of the caller's notices are unread", tags = {"IOETI automation"})
  @IoetiEndpoint
  public Response unread() {
    long count = Query.of(InboxNotice.class).filter("self.recipient = ?1 AND (self.seen IS NULL OR self.seen = false)", AuthUtils.getUser()).count();
    return ResponseConstructor.build(Response.Status.OK, "Unread", Map.of("unread", count));
  }

  @POST
  @Path("/inbox/{id}/read")
  @Operation(summary = "Mark one of the caller's notices read", tags = {"IOETI automation"})
  @IoetiEndpoint
  public Response read(@PathParam("id") Long id) {
    InboxNotice notice = id == null ? null : JPA.find(InboxNotice.class, id);
    if (notice == null || !AuthUtils.getUser().equals(notice.getRecipient())) throw ApiException.notFound();
    write(() -> Beans.get(AutomationService.class).markRead(List.of(notice)));
    return ResponseConstructor.build(Response.Status.OK, "Read", view(notice));
  }

  @POST
  @Path("/inbox/read-all")
  @Operation(summary = "Mark all of the caller's notices read", tags = {"IOETI automation"})
  @IoetiEndpoint
  public Response readAll() {
    List<InboxNotice> notices = Query.of(InboxNotice.class)
        .filter("self.recipient = ?1 AND (self.seen IS NULL OR self.seen = false)", AuthUtils.getUser()).fetch(1000);
    write(() -> Beans.get(AutomationService.class).markRead(notices));
    return ResponseConstructor.build(Response.Status.OK, "Read", Map.of("marked", notices.size()));
  }

  // --- mentions ------------------------------------------------------------------------------------

  @GET
  @Path("/people")
  @Operation(summary = "Active colleagues by name (for mentions); at least 2 characters", tags = {"IOETI automation"})
  @IoetiEndpoint
  public Response people(@QueryParam("q") String q) {
    String text = q == null ? "" : q.strip();
    if (text.length() < 2 || text.length() > 60) return ResponseConstructor.build(Response.Status.OK, "People", List.of());
    String like = "%" + text.toLowerCase().replace("%", "").replace("_", "") + "%";
    List<Person> rows = Query.of(User.class)
        .filter("(self.blocked IS NULL OR self.blocked = false) AND (self.archived IS NULL OR self.archived = false) AND LOWER(self.name) LIKE ?1 AND self != ?2",
            like, AuthUtils.getUser())
        .order("name").fetch(20).stream().map(u -> new Person(u.getId(), u.getName())).toList();
    return ResponseConstructor.build(Response.Status.OK, "People", rows);
  }

  @POST
  @Path("/mentions")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Point a colleague to a record the caller may read (in-app only)", tags = {"IOETI automation"})
  @IoetiEndpoint
  public Response mention(Mention command) {
    if (command == null) throw ApiException.badRequest("Mention details are required.");
    int subject = ContentService.subject(command.subject());
    ContentService.readableSubject(subject, command.subjectId());
    User recipient = command.recipientId() == null ? null : JPA.find(User.class, command.recipientId());
    if (recipient == null || Boolean.TRUE.equals(recipient.getBlocked()) || Boolean.TRUE.equals(recipient.getArchived())) {
      throw ApiException.invalidField("recipientId", "UNAVAILABLE", "Choose an active colleague.");
    }
    if (recipient.equals(AuthUtils.getUser())) throw ApiException.invalidField("recipientId", "SELF", "Mention someone else.");
    String message = text("message", command.message(), MAX_MESSAGE, true);
    write(() -> Beans.get(AutomationService.class).deliver(recipient, command.subject(), command.subjectId(), message));
    return ResponseConstructor.build(Response.Status.CREATED, "Mentioned", Map.of("recipientId", recipient.getId()));
  }

  // --- outbox --------------------------------------------------------------------------------------

  @GET
  @Path("/outbox")
  @Operation(summary = "Messages drafted for a lead the caller may read", tags = {"IOETI automation"})
  @IoetiEndpoint
  public Response outbox(@QueryParam("leadId") Long leadId) {
    Lead lead = RecordAccess.readable(Lead.class, leadId);
    List<OutboundView> rows = Query.of(OutboundMessage.class).filter("self.lead = ?1", lead).order("-createdAt").order("-id").fetch(100)
        .stream().map(AutomationRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Outbox", rows);
  }

  @POST
  @Path("/outbox")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Draft a message to a lead; refused when the lead opted out or has no address", tags = {"IOETI automation"})
  @IoetiEndpoint
  public Response draft(Draft command) {
    if (command == null) throw ApiException.badRequest("Message details are required.");
    Lead lead = RecordAccess.writable(Lead.class, command.leadId());
    int channel = select("channel", command.channel(), CHANNELS);
    checkReachable(lead, channel);
    OutboundMessage message = new OutboundMessage();
    message.setLead(lead);
    message.setChannelSelect(channel);
    message.setSubjectLine(text("subjectLine", command.subjectLine(), 200, true));
    message.setBody(text("body", command.body(), MAX_BODY, true));
    message.setStatusSelect(OutboundMessageRepository.STATUS_DRAFT);
    message.setAuthor(AuthUtils.getUser());
    message.setCreatedAt(LocalDateTime.now());
    OutboundMessage[] saved = new OutboundMessage[1];
    write(() -> saved[0] = Beans.get(AutomationService.class).save(message));
    return ResponseConstructor.build(Response.Status.CREATED, "Drafted", view(saved[0]));
  }

  @POST
  @Path("/outbox/{id}/send")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Send a drafted message: consent is checked again, then BLOCKED_BY_POLICY (D-10)", tags = {"IOETI automation"})
  @IoetiEndpoint
  public Response send(@PathParam("id") Long id, VersionOnly command) {
    OutboundMessage message = writableMessage(id, command == null ? null : command.version());
    if (!Integer.valueOf(OutboundMessageRepository.STATUS_DRAFT).equals(message.getStatusSelect())) {
      throw new ApiException(422, "MESSAGE_STATE", "Only a draft can be sent.", null);
    }
    checkReachable(message.getLead(), message.getChannelSelect());
    throw ApiException.policyBlocked("D-10");
  }

  @POST
  @Path("/outbox/{id}/cancel")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Cancel a drafted message", tags = {"IOETI automation"})
  @IoetiEndpoint
  public Response cancel(@PathParam("id") Long id, VersionOnly command) {
    OutboundMessage message = writableMessage(id, command == null ? null : command.version());
    if (!Integer.valueOf(OutboundMessageRepository.STATUS_DRAFT).equals(message.getStatusSelect())) {
      throw new ApiException(422, "MESSAGE_STATE", "Only a draft can be cancelled.", null);
    }
    message.setStatusSelect(OutboundMessageRepository.STATUS_CANCELLED);
    write(() -> Beans.get(AutomationService.class).save(message));
    return ResponseConstructor.build(Response.Status.OK, "Cancelled", view(JPA.find(OutboundMessage.class, id)));
  }

  /** The lead must not have opted out of the channel and must have an address for it. */
  static void checkReachable(Lead lead, int channel) {
    if (channel == OutboundMessageRepository.CHANNEL_EMAIL) {
      if (Boolean.TRUE.equals(lead.getIsDoNotSendEmail())) {
        throw new ApiException(422, "OPTED_OUT", "The lead opted out of e-mail.", null);
      }
      if (lead.getEmailAddress() == null || lead.getEmailAddress().getAddress() == null || lead.getEmailAddress().getAddress().isBlank()) {
        throw new ApiException(422, "NO_ADDRESS", "The lead has no e-mail address.", null);
      }
    }
  }

  private static OutboundMessage writableMessage(Long id, Integer version) {
    if (version == null) throw ApiException.badRequest("Record version is required.");
    OutboundMessage message = id == null ? null : JPA.find(OutboundMessage.class, id);
    if (message == null) throw ApiException.notFound();
    RecordAccess.writable(Lead.class, message.getLead().getId());
    ConflictChecker.checkVersion(message, version);
    return message;
  }

  // --- helpers -------------------------------------------------------------------------------------

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

  static NoticeView view(InboxNotice n) {
    return new NoticeView(n.getId(), n.getKind(), n.getSubject(), n.getSubjectId(), n.getTitle(),
        n.getActor() == null ? null : n.getActor().getName(), Boolean.TRUE.equals(n.getSeen()), n.getCreatedAt());
  }

  static OutboundView view(OutboundMessage m) {
    return new OutboundView(m.getId(), m.getVersion(), m.getLead().getId(), name(m.getChannelSelect(), CHANNELS), m.getSubjectLine(), m.getBody(),
        name(m.getStatusSelect(), OUTBOX_STATUSES), m.getAuthor() == null ? null : m.getAuthor().getName(), m.getCreatedAt(), "BLOCKED_BY_POLICY");
  }

  public record VersionOnly(Integer version) {}
  public record NoticeView(Long id, String kind, String subject, Long subjectId, String title, String actorName, boolean read, LocalDateTime at) {}
  public record Person(Long id, String name) {}
  public record Mention(Long recipientId, String subject, Long subjectId, String message) {}
  public record Draft(Long leadId, String channel, String subjectLine, String body) {}
  public record OutboundView(
      Long id, Integer version, Long leadId, String channel, String subjectLine, String body, String status, String authorName,
      LocalDateTime createdAt, String sendStatus) {}
}
