package com.ioeti.workspace.rest;

import com.axelor.apps.base.service.app.AppBaseService;
import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.User;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.axelor.utils.api.ResponseConstructor;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.IoetiEndpoint;
import com.ioeti.core.policy.PolicyCatalog;
import com.ioeti.core.policy.PolicyService;
import com.ioeti.workspace.db.RetentionDecision;
import com.ioeti.workspace.service.RetentionService;
import com.ioeti.workspace.service.RetentionService.Due;
import com.ioeti.workspace.service.RetentionService.Period;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Optional;

/**
 * D-07 retention review (signed 2026-10-25): the records whose retention period has run out, for a policy owner to keep
 * (with a reason, until a date) or anonymize. Nothing here runs on its own; every change is one person's decision on one
 * record. The queue reads every record whatever its owner or business line, so it is for policy owners only.
 */
@Path("/ioeti/privacy/retention")
@Produces(MediaType.APPLICATION_JSON)
public class RetentionRestController {

  @GET
  @Operation(summary = "Per data type: the retention period in force and how many records are due for review (policy owners)", tags = {"IOETI privacy"})
  @IoetiEndpoint
  public Response overview() {
    owner();
    LocalDate today = today();
    RetentionService service = Beans.get(RetentionService.class);
    List<RetentionTypeView> types = PolicyCatalog.DATA_TYPES.stream().map(type -> {
      Optional<Period> period = service.period(type, today);
      return period.map(p -> new RetentionTypeView(type, true, p.months(), p.version().getId(), p.version().getEffectiveFrom(), service.count(type, p, today),
              RetentionService.ANONYMIZABLE.contains(type)))
          .orElseGet(() -> new RetentionTypeView(type, false, null, null, null, null, RetentionService.ANONYMIZABLE.contains(type)));
    }).toList();
    return ResponseConstructor.build(Response.Status.OK, "Retention", new RetentionOverviewView(today, types));
  }

  @GET
  @Path("/decisions")
  @Operation(summary = "The latest retention decisions, newest first (policy owners)", tags = {"IOETI privacy"})
  @IoetiEndpoint
  public Response decisions() {
    owner();
    List<RetentionDecisionView> rows = Query.of(RetentionDecision.class).order("-decidedAt").order("-id").fetch(100).stream()
        .map(RetentionRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Retention decisions", rows);
  }

  @GET
  @Path("/{type}")
  @Operation(summary = "The records of one data type due for review, the longest overdue first (policy owners; 422 POLICY_NOT_SET without a period)",
      tags = {"IOETI privacy"})
  @IoetiEndpoint
  public Response queue(@PathParam("type") String rawType) {
    owner();
    String type = RetentionService.type(rawType);
    LocalDate today = today();
    RetentionService service = Beans.get(RetentionService.class);
    Period period = service.require(type, today);
    List<RetentionDueView> rows = service.list(type, period, today, RetentionService.PAGE).stream()
        .map(d -> new RetentionDueView(d.id(), d.label(), d.lastActivityOn(), d.dueSince())).toList();
    return ResponseConstructor.build(Response.Status.OK, "Retention queue", new RetentionQueueView(type, period.months(), period.cutoff(),
        service.count(type, period, today), RetentionService.ANONYMIZABLE.contains(type), rows));
  }

  @POST
  @Path("/{type}/{id}/keep")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Keep a due record, with a reason, until a date at most one more period away (policy owners)", tags = {"IOETI privacy"})
  @IoetiEndpoint
  public Response keep(@PathParam("type") String rawType, @PathParam("id") Long id, RetentionKeepCommand command) {
    User me = owner();
    String type = RetentionService.type(rawType);
    if (id == null || command == null) throw ApiException.badRequest("A reason and a date are required.");
    RetentionDecision d = Beans.get(RetentionService.class).keep(type, id, command.reason(), date(command.reviewAgainOn()), me, today());
    return ResponseConstructor.build(Response.Status.OK, "Kept", view(d));
  }

  @POST
  @Path("/{type}/{id}/anonymize")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Anonymize a due lead or candidate in place; it cannot be undone (policy owners)", tags = {"IOETI privacy"})
  @IoetiEndpoint
  public Response anonymize(@PathParam("type") String rawType, @PathParam("id") Long id, RetentionAnonymizeCommand command) {
    User me = owner();
    String type = RetentionService.type(rawType);
    if (id == null || command == null) throw ApiException.badRequest("A reason is required.");
    RetentionDecision d = Beans.get(RetentionService.class).anonymize(type, id, command.reason(), me, today());
    return ResponseConstructor.build(Response.Status.OK, "Anonymized", view(d));
  }

  // --- helpers -----------------------------------------------------------------------------------------------

  private static User owner() {
    User me = AuthUtils.getUser();
    if (!PolicyService.isOwner(me)) throw ApiException.forbidden();
    return me;
  }

  private static LocalDate today() {
    User me = AuthUtils.getUser();
    return Beans.get(AppBaseService.class).getTodayDate(me == null ? null : me.getActiveCompany());
  }

  private static LocalDate date(String value) {
    if (value == null || value.isBlank()) return null;
    try {
      return LocalDate.parse(value.strip());
    } catch (DateTimeParseException e) {
      throw ApiException.invalidField("reviewAgainOn", "FORMAT", "Use a date like 2027-01-31.");
    }
  }

  private static RetentionDecisionView view(RetentionDecision d) {
    return new RetentionDecisionView(d.getId(), d.getDataType(), d.getRecordId(), d.getDecision(), d.getReason(), d.getReviewAgainOn(),
        d.getLastActivityOn(), d.getPolicyVersion() == null ? null : d.getPolicyVersion().getId(),
        d.getDecidedBy() == null ? null : d.getDecidedBy().getName(), d.getDecidedAt());
  }

  public record RetentionKeepCommand(String reason, String reviewAgainOn) {}

  public record RetentionAnonymizeCommand(String reason) {}

  /** One data type: whether a period is set, and how many records are due (null when no period is set, never zero). */
  public record RetentionTypeView(String dataType, boolean set, Integer months, Long policyVersionId, LocalDate since, Long due, boolean canAnonymize) {}

  public record RetentionOverviewView(LocalDate today, List<RetentionTypeView> types) {}

  public record RetentionDueView(long id, String label, LocalDate lastActivityOn, LocalDate dueSince) {}

  public record RetentionQueueView(String dataType, int months, LocalDate cutoff, long total, boolean canAnonymize, List<RetentionDueView> rows) {}

  public record RetentionDecisionView(Long id, String dataType, Long recordId, String decision, String reason, LocalDate reviewAgainOn,
      LocalDate lastActivityOn, Long policyVersionId, String decidedBy, LocalDateTime decidedAt) {}
}
