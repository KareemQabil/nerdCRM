package com.ioeti.admin.rest;

import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.User;
import com.axelor.inject.Beans;
import com.axelor.utils.api.ResponseConstructor;
import com.ioeti.admin.service.ReferenceLists;
import com.ioeti.admin.service.ReferenceLists.Entry;
import com.ioeti.admin.service.ReferenceLists.Kind;
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
 * The reference lists people pick from (lost reasons, lead sources, opportunity stages), managed by
 * administrators from the platform. Administrators only, checked on every call.
 */
@Path("/ioeti/admin/lists")
@Produces(MediaType.APPLICATION_JSON)
public class ReferenceListRestController {

  @GET
  @Path("/{list}")
  @Operation(summary = "The values of a reference list with how often each is used (administrators)", tags = {"IOETI admin"})
  @IoetiEndpoint
  public Response list(@PathParam("list") String list) {
    admin();
    return ResponseConstructor.build(Response.Status.OK, "Reference list", views(lists().list(Kind.of(list))));
  }

  @POST
  @Path("/{list}")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Add a value to a reference list (administrators)", tags = {"IOETI admin"})
  @IoetiEndpoint
  public Response add(@PathParam("list") String list, NameCommand command) {
    admin();
    Kind kind = Kind.of(list);
    if (command == null) throw ApiException.badRequest("A name is required.");
    return ResponseConstructor.build(Response.Status.CREATED, "Value added", view(lists().add(kind, command.name())));
  }

  @POST
  @Path("/{list}/{id}")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Rename a value of a reference list (administrators)", tags = {"IOETI admin"})
  @IoetiEndpoint
  public Response rename(@PathParam("list") String list, @PathParam("id") Long id, NameCommand command) {
    admin();
    Kind kind = Kind.of(list);
    if (command == null) throw ApiException.badRequest("A name is required.");
    Entry[] saved = new Entry[1];
    OptimisticLockConflicts.translate(() -> saved[0] = lists().rename(kind, id, command.version(), command.name()));
    return ResponseConstructor.build(Response.Status.OK, "Value renamed", view(saved[0]));
  }

  @POST
  @Path("/{list}/{id}/delete")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Delete an unused value of a reference list (administrators)", tags = {"IOETI admin"})
  @IoetiEndpoint
  public Response delete(@PathParam("list") String list, @PathParam("id") Long id, NameCommand command) {
    admin();
    Kind kind = Kind.of(list);
    OptimisticLockConflicts.translate(() -> lists().delete(kind, id, command == null ? null : command.version()));
    return ResponseConstructor.build(Response.Status.OK, "Value deleted", views(lists().list(kind)));
  }

  @POST
  @Path("/opportunity-stages/order")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Put the open opportunity stages in a new order; won and lost stay last (administrators)", tags = {"IOETI admin"})
  @IoetiEndpoint
  public Response order(OrderCommand command) {
    admin();
    @SuppressWarnings("unchecked")
    List<Entry>[] rows = new List[1];
    OptimisticLockConflicts.translate(() -> rows[0] = lists().order(command == null ? null : command.ids()));
    return ResponseConstructor.build(Response.Status.OK, "Stages ordered", views(rows[0]));
  }

  private static ReferenceLists lists() {
    return Beans.get(ReferenceLists.class);
  }

  private static void admin() {
    User me = AuthUtils.getUser();
    if (me == null || !AuthUtils.isAdmin(me)) throw ApiException.forbidden();
  }

  static ListValueView view(Entry e) {
    return new ListValueView(e.id(), e.version(), e.name(), e.sequence(), e.role(), e.uses());
  }

  static List<ListValueView> views(List<Entry> entries) {
    return entries.stream().map(ReferenceListRestController::view).toList();
  }

  public record NameCommand(Integer version, String name) {}

  /** A value of a reference list; role marks a protected stage (WON, LOST, DEFAULT, PROPOSITION). */
  public record ListValueView(Long id, Integer version, String name, Integer sequence, String role, long uses) {}

  public record OrderCommand(List<Long> ids) {}
}
