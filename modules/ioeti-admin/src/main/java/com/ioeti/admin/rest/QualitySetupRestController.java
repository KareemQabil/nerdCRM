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
 * The company's quality set-up (statuses, where issues are found, issue types, action types, and for
 * root-cause analysis analysis methods with their branches, the causes under each branch and processes),
 * managed by administrators.
 * Values are the company's own; none are shipped.
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
    return ResponseConstructor.build(Response.Status.CREATED, "Value added", view(setup().add(kind, command.name(), command.kind(), command.branchId(), command.ownerId())));
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
    OptimisticLockConflicts.translate(() -> saved[0] = setup().update(kind, id, command.version(), command.name(), command.kind(), command.branchId(), command.ownerId()));
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

  @POST
  @Path("/methods/{id}/branches")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Add a branch (cause category) at the end of an analysis method (the method's version; administrators)", tags = {"IOETI admin"})
  @IoetiEndpoint
  public Response addBranch(@PathParam("id") Long id, QualityValueCommand command) {
    admin();
    if (command == null) throw ApiException.badRequest("Record version is required.");
    Entry[] saved = new Entry[1];
    OptimisticLockConflicts.translate(() -> saved[0] = setup().addBranch(id, command.version(), command.name()));
    return ResponseConstructor.build(Response.Status.CREATED, "Branch added", view(saved[0]));
  }

  @POST
  @Path("/methods/{id}/branches/{branchId}/delete")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Remove a branch without causes from an analysis method (the method's version; administrators)", tags = {"IOETI admin"})
  @IoetiEndpoint
  public Response deleteBranch(@PathParam("id") Long id, @PathParam("branchId") Long branchId, QualityValueCommand command) {
    admin();
    Entry[] saved = new Entry[1];
    OptimisticLockConflicts.translate(() -> saved[0] = setup().deleteBranch(id, command == null ? null : command.version(), branchId));
    return ResponseConstructor.build(Response.Status.OK, "Branch removed", view(saved[0]));
  }

  private static QualitySetup setup() {
    return Beans.get(QualitySetup.class);
  }

  private static void admin() {
    User me = AuthUtils.getUser();
    if (me == null || !AuthUtils.isAdmin(me)) throw ApiException.forbidden();
  }

  static QualityValueView view(Entry e) {
    return new QualityValueView(e.id(), e.version(), e.name(), e.code(), e.flag(), e.sequence(), e.uses(),
        e.branches() == null ? null : e.branches().stream().map(b -> new QualityBranchView(b.id(), b.name(), b.causes())).toList(),
        e.branchId(), e.branchName(), e.ownerId(), e.ownerName());
  }

  static List<QualityValueView> views(List<Entry> entries) {
    return entries.stream().map(QualitySetupRestController::view).toList();
  }

  /** branchId: the branch a cause belongs to (causes only); ownerId: who owns a process (processes only). */
  public record QualityValueCommand(Integer version, String name, String kind, Long branchId, Long ownerId) {}

  /**
   * A quality set-up value; kind is the status kind or the detection origin, null otherwise; branches only for
   * methods; branchId/branchName only for causes; ownerId/ownerName only for processes.
   */
  public record QualityValueView(Long id, Integer version, String name, String code, String kind, Integer sequence, long uses,
      List<QualityBranchView> branches, Long branchId, String branchName, Long ownerId, String ownerName) {}

  /** A branch of an analysis method with how many causes it has. */
  public record QualityBranchView(Long id, String name, long causes) {}
}
