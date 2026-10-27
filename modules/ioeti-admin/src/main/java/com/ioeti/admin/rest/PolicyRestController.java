package com.ioeti.admin.rest;

import com.axelor.apps.base.service.app.AppBaseService;
import com.axelor.db.Query;
import com.axelor.team.db.Team;
import com.axelor.apps.base.db.Source;
import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.User;
import com.axelor.db.JPA;
import com.axelor.inject.Beans;
import com.axelor.utils.api.ResponseConstructor;
import com.fasterxml.jackson.databind.JsonNode;
import com.ioeti.admin.service.PolicyAdmin;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.IoetiEndpoint;
import com.ioeti.core.db.PolicyVersion;
import com.ioeti.core.policy.PolicyCatalog;
import com.ioeti.core.policy.PolicyDefinition;
import com.ioeti.core.policy.PolicyService;
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
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Business-rule policies (owner decisions D-01..D-12, signed 2026-10-25): what the owners set, from when,
 * by whom and why. Administrators and policy owners read them; only policy owners change them or appoint
 * other policy owners (an administrator may appoint the first one). Nothing is shipped: every workflow
 * that needs a policy is refused until it is set.
 */
@Path("/ioeti/policies")
@Produces(MediaType.APPLICATION_JSON)
public class PolicyRestController {

  @GET
  @Operation(summary = "Every policy the owners decided to keep configurable, with how many values are in force (administrators and policy owners)", tags = {"IOETI policies"})
  @IoetiEndpoint
  public Response overview() {
    User me = reader();
    LocalDate today = today();
    Map<String, Long> counts = PolicyService.setCounts(today);
    List<PolicySummaryView> rows = PolicyCatalog.all().stream().map(d -> new PolicySummaryView(d.key(), d.decision(), d.area(), d.scope().name(),
        d.allowsDefault(), d.titleAr(), d.titleEn(), d.helpAr(), d.helpEn(), counts.getOrDefault(d.key(), 0L))).toList();
    return ResponseConstructor.build(Response.Status.OK, "Policies",
        new PolicyOverviewView(PolicyService.isOwner(me), PolicyService.owners().isEmpty(), rows));
  }

  @GET
  @Path("/references")
  @Operation(summary = "The teams and lead sources policy values can name, for the editor (administrators and policy owners)", tags = {"IOETI policies"})
  @IoetiEndpoint
  public Response references() {
    reader();
    List<PolicyReferenceView> teams = Query.of(Team.class).order("name").fetch(500).stream()
        .map(t -> new PolicyReferenceView(t.getId(), t.getName())).toList();
    List<PolicyReferenceView> sources = Query.of(Source.class).order("name").fetch(500).stream()
        .map(o -> new PolicyReferenceView(o.getId(), o.getName())).toList();
    return ResponseConstructor.build(Response.Status.OK, "Policy references", new PolicyReferencesView(teams, sources));
  }

  @GET
  @Path("/{key}")
  @Operation(summary = "One policy: its fields, the value in force per scope, values scheduled to start later, and its history", tags = {"IOETI policies"})
  @IoetiEndpoint
  public Response detail(@PathParam("key") String key) {
    reader();
    return ResponseConstructor.build(Response.Status.OK, "Policy", detail(PolicyCatalog.get(key), today()));
  }

  @POST
  @Path("/{key}")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Set a policy value from a date (today or later), with the reason (policy owners)", tags = {"IOETI policies"})
  @IoetiEndpoint
  public Response set(@PathParam("key") String key, SetPolicy command) {
    if (command == null) throw ApiException.badRequest("A value is required.");
    PolicyDefinition definition = PolicyCatalog.get(key);
    LocalDate today = today();
    Beans.get(PolicyAdmin.class).set(key, command.scope(), command.value(), date(command.effectiveFrom()), command.reason(), today);
    return ResponseConstructor.build(Response.Status.CREATED, "Policy set", detail(definition, today));
  }

  @POST
  @Path("/{key}/retire")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Unset a policy from a date: workflows that need it are refused again from then (policy owners)", tags = {"IOETI policies"})
  @IoetiEndpoint
  public Response retire(@PathParam("key") String key, RetirePolicy command) {
    if (command == null) throw ApiException.badRequest("A reason is required.");
    PolicyDefinition definition = PolicyCatalog.get(key);
    LocalDate today = today();
    Beans.get(PolicyAdmin.class).retire(key, command.scope(), date(command.effectiveFrom()), command.reason(), today);
    return ResponseConstructor.build(Response.Status.OK, "Policy unset", detail(definition, today));
  }

  @GET
  @Path("/owners")
  @Operation(summary = "The policy owners (administrators and policy owners)", tags = {"IOETI policies"})
  @IoetiEndpoint
  public Response owners() {
    reader();
    return ResponseConstructor.build(Response.Status.OK, "Policy owners", ownerViews());
  }

  @GET
  @Path("/people")
  @Operation(summary = "Active people a policy owner may appoint (administrators and policy owners)", tags = {"IOETI policies"})
  @IoetiEndpoint
  public Response people() {
    reader();
    return ResponseConstructor.build(Response.Status.OK, "People", com.axelor.db.Query.of(User.class)
        .filter("self.blocked IS NULL OR self.blocked = false").order("name").fetch(500).stream()
        .map(u -> new PolicyOwnerView(u.getId(), u.getName(), u.equals(AuthUtils.getUser()))).toList());
  }

  @POST
  @Path("/owners")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Appoint a policy owner (policy owners; an administrator may appoint the first one)", tags = {"IOETI policies"})
  @IoetiEndpoint
  public Response appoint(OwnerCommand command) {
    User user = command == null || command.userId() == null ? null : JPA.find(User.class, command.userId());
    if (user == null) throw ApiException.invalidField("userId", "REQUIRED", "Choose a person.");
    Beans.get(PolicyAdmin.class).appoint(user);
    return ResponseConstructor.build(Response.Status.OK, "Policy owner appointed", ownerViews());
  }

  @POST
  @Path("/owners/{userId}/dismiss")
  @Operation(summary = "Remove a policy owner; the last one cannot be removed (policy owners)", tags = {"IOETI policies"})
  @IoetiEndpoint
  public Response dismiss(@PathParam("userId") Long userId) {
    User user = JPA.find(User.class, userId);
    if (user == null) throw ApiException.notFound();
    Beans.get(PolicyAdmin.class).dismiss(user);
    return ResponseConstructor.build(Response.Status.OK, "Policy owner removed", ownerViews());
  }

  // --- helpers -----------------------------------------------------------------------------------------

  /** Administrators and policy owners read policies; everyone else is refused. */
  private static User reader() {
    User me = AuthUtils.getUser();
    if (me == null || !(AuthUtils.isAdmin(me) || PolicyService.isOwner(me))) throw ApiException.forbidden();
    return me;
  }

  private static LocalDate today() {
    User me = AuthUtils.getUser();
    return Beans.get(AppBaseService.class).getTodayDate(me == null ? null : me.getActiveCompany());
  }

  private static LocalDate date(String value) {
    if (value == null || value.isBlank()) return null;
    try { return LocalDate.parse(value.strip()); }
    catch (DateTimeParseException e) { throw ApiException.invalidField("effectiveFrom", "FORMAT", "Use a date like 2026-11-01."); }
  }

  private static List<PolicyOwnerView> ownerViews() {
    return PolicyService.owners().stream().map(u -> new PolicyOwnerView(u.getId(), u.getName(), u.equals(AuthUtils.getUser()))).toList();
  }

  static PolicyDetailView detail(PolicyDefinition d, LocalDate today) {
    PolicyService service = Beans.get(PolicyService.class);
    List<PolicyVersion> history = service.history(d.key());
    // the value in force and the next scheduled change, per scope (null scope = company-wide / default)
    Map<String, PolicyValueView> values = new LinkedHashMap<>();
    for (PolicyVersion v : history) {
      String scope = v.getScopeKey();
      String k = scope == null ? "" : scope;
      if (values.containsKey(k)) continue;
      PolicyService.Applied now = service.current(d.key(), scope, today).filter(a -> java.util.Objects.equals(a.scope(), scope)).orElse(null);
      PolicyVersion next = history.stream().filter(x -> java.util.Objects.equals(x.getScopeKey(), scope) && x.getEffectiveFrom().isAfter(today))
          .min(java.util.Comparator.comparing(PolicyVersion::getEffectiveFrom).thenComparing(PolicyVersion::getId)).orElse(null);
      values.put(k, new PolicyValueView(scope, now == null ? null : now.versionId(), now == null ? null : now.value(),
          now == null ? null : now.effectiveFrom(), next == null ? null : next.getEffectiveFrom(),
          next == null ? null : (Boolean.TRUE.equals(next.getRetired()) ? null : com.ioeti.admin.rest.PolicyRestController.json(next.getValueJson())),
          next != null && Boolean.TRUE.equals(next.getRetired())));
    }
    List<PolicyVersionView> versions = new ArrayList<>();
    for (PolicyVersion v : history) {
      versions.add(new PolicyVersionView(v.getId(), v.getScopeKey(), Boolean.TRUE.equals(v.getRetired()) ? null : json(v.getValueJson()),
          Boolean.TRUE.equals(v.getRetired()), v.getEffectiveFrom(), v.getReason(), v.getAuthor() == null ? null : v.getAuthor().getName(), v.getCreatedAt()));
    }
    List<PolicyFieldView> fields = d.fields().stream().map(PolicyRestController::field).toList();
    return new PolicyDetailView(d.key(), d.decision(), d.area(), d.scope().name(), d.allowsDefault(), d.titleAr(), d.titleEn(), d.helpAr(), d.helpEn(),
        fields, PolicyService.isOwner(AuthUtils.getUser()), new ArrayList<>(values.values()), versions);
  }

  private static PolicyFieldView field(PolicyDefinition.Field f) {
    return new PolicyFieldView(f.name(), f.kind().name(), f.required(), f.options(), f.min(), f.max(),
        f.items().stream().map(PolicyRestController::field).toList(), f.titleAr(), f.titleEn());
  }

  static JsonNode json(String value) {
    try {
      return value == null ? null : new com.fasterxml.jackson.databind.ObjectMapper().readTree(value);
    } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
      throw new IllegalStateException(e);
    }
  }

  public record SetPolicy(String scope, JsonNode value, String effectiveFrom, String reason) {}

  public record RetirePolicy(String scope, String effectiveFrom, String reason) {}

  public record OwnerCommand(Long userId) {}

  public record PolicyOverviewView(boolean canEdit, boolean noOwners, List<PolicySummaryView> policies) {}

  /** One policy in the overview; inForce is how many scopes (or the company-wide value) have a value today. */
  public record PolicySummaryView(String key, String decision, String area, String scope, boolean allowsDefault, String titleAr, String titleEn,
      String helpAr, String helpEn, long inForce) {}

  public record PolicyFieldView(String name, String kind, boolean required, List<String> options, Integer min, Integer max,
      List<PolicyFieldView> items, String titleAr, String titleEn) {}

  /** The value in force for one scope (null scope = company-wide or default) and the next scheduled change. */
  public record PolicyValueView(String scope, Long versionId, JsonNode value, LocalDate since, LocalDate nextFrom, JsonNode nextValue, boolean nextUnsets) {}

  public record PolicyVersionView(Long id, String scope, JsonNode value, boolean retired, LocalDate effectiveFrom, String reason, String authorName,
      LocalDateTime createdAt) {}

  public record PolicyDetailView(String key, String decision, String area, String scope, boolean allowsDefault, String titleAr, String titleEn,
      String helpAr, String helpEn, List<PolicyFieldView> fields, boolean canEdit, List<PolicyValueView> values, List<PolicyVersionView> versions) {}

  public record PolicyOwnerView(Long id, String name, boolean me) {}

  public record PolicyReferenceView(Long id, String name) {}

  public record PolicyReferencesView(List<PolicyReferenceView> teams, List<PolicyReferenceView> sources) {}
}
