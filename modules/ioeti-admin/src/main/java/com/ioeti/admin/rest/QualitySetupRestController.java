package com.ioeti.admin.rest;

import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.User;
import com.axelor.inject.Beans;
import com.axelor.utils.api.ResponseConstructor;
import com.ioeti.admin.service.QualitySetup;
import com.ioeti.admin.service.QualitySetup.Entry;
import com.ioeti.admin.service.QualitySetup.Kind;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.IoetiEndpoint;
import com.ioeti.core.web.OptimisticLockConflicts;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.List;

/**
 * The company's quality set-up (statuses, where issues are found, issue types, action types), managed by
 * administrators. Values are the company's own; none are shipped.
 */
@Path("/ioeti/admin/quality")
@Produces(MediaType.APPLICATION_JSON)
public class QualitySetupRestController {

  @GET
  @Path("/{list}")
  @Operation(summary = "A quality set-up list with how often each value is used (administrators)", tags = {"IOETI admin"})
  @IoetiEndpoint
  public Response list(@PathParam("list") String list) {
    admin();
    return ResponseConstructor.build(Response.Status.OK, "Quality set-up", views(setup().list(Kind.of(list))));
  }

  @POST
  @Path("/{list}")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Add a value: a status with its kind (OPEN, CLOSED, CANCELLED), a detection with its origin (INTERNAL, CUSTOMER, SUPPLIER), an issue type or an action type (administrators)", tags = {"IOETI admin"})
  @IoetiEndpoint
  public Response add(@PathParam("list") String list, QualityValueCommand command) {
    admin();
    Kind kind = Kind.of(list);
    if (command == null) throw ApiException.badRequest("A name is required.");
    return ResponseConstructor.build(Response.Status.CREATED, "Value added", view(setup().add(kind, command.name(), command.kind())));
  }

  @POST
  @Path("/{list}/{id}")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Rename a value, or change a status kind or detection origin (administrators)", tags = {"IOETI admin"})
  @IoetiEndpoint
  public Response update(@PathParam("list") String list, @PathParam("id") Long id, QualityValueCommand command) {
    admin();
    Kind kind = Kind.of(list);
    if (command == null) throw ApiException.badRequest("Record version is required.");
    Entry[] saved = new Entry[1];
    OptimisticLockConflicts.translate(() -> saved[0] = setup().update(kind, id, command.version(), command.name(), command.kind()));
    return ResponseConstructor.build(Response.Status.OK, "Value changed", view(saved[0]));
  }

  @POST
  @Path("/{list}/{id}/delete")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Delete an unused quality set-up value (administrators)", tags = {"IOETI admin"})
  @IoetiEndpoint
  public Response delete(@PathParam("list") String list, @PathParam("id") Long id, QualityValueCommand command) {
    admin();
    Kind kind = Kind.of(list);
    OptimisticLockConflicts.translate(() -> setup().delete(kind, id, command == null ? null : command.version()));
    return ResponseConstructor.build(Response.Status.OK, "Value deleted", views(setup().list(kind)));
  }

  private static QualitySetup setup() {
    return Beans.get(QualitySetup.class);
  }

  private static void admin() {
    User me = AuthUtils.getUser();
    if (me == null || !AuthUtils.isAdmin(me)) throw ApiException.forbidden();
  }

  static QualityValueView view(Entry e) {
    return new QualityValueView(e.id(), e.version(), e.name(), e.code(), e.flag(), e.sequence(), e.uses());
  }

  static List<QualityValueView> views(List<Entry> entries) {
    return entries.stream().map(QualitySetupRestController::view).toList();
  }

  public record QualityValueCommand(Integer version, String name, String kind) {}

  /** A quality set-up value; kind is the status kind or the detection origin, null for types. */
  public record QualityValueView(Long id, Integer version, String name, String code, String kind, Integer sequence, long uses) {}
}
