package com.ioeti.admin.rest;

import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.User;
import com.axelor.inject.Beans;
import com.axelor.utils.api.ResponseConstructor;
import com.ioeti.admin.service.Numbering;
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

/** How the records the platform creates are numbered, set up by administrators. Administrators only. */
@Path("/ioeti/admin/numbering")
@Produces(MediaType.APPLICATION_JSON)
public class NumberingRestController {

  @GET
  @Operation(summary = "How the records the platform creates are numbered (administrators)", tags = {"IOETI admin"})
  @IoetiEndpoint
  public Response numbering() {
    admin();
    return ResponseConstructor.build(Response.Status.OK, "Numbering",
        Beans.get(Numbering.class).list().stream().map(NumberingRestController::numberingView).toList());
  }

  @POST
  @Path("/{code}")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Set up or change the numbering of a record type: prefix and digits (administrators)", tags = {"IOETI admin"})
  @IoetiEndpoint
  public Response setNumbering(@PathParam("code") String code, NumberingCommand command) {
    admin();
    if (command == null) throw ApiException.badRequest("A prefix is required.");
    Numbering.Entry[] saved = new Numbering.Entry[1];
    OptimisticLockConflicts.translate(() -> saved[0] = Beans.get(Numbering.class).set(code, command.version(), command.prefix(), command.digits()));
    return ResponseConstructor.build(Response.Status.OK, "Numbering saved", numberingView(saved[0]));
  }

  static NumberingView numberingView(Numbering.Entry e) {
    return new NumberingView(e.code(), e.name(), e.configured(), e.version(), e.prefix(), e.padding(), e.nextNumber(), e.example());
  }

  private static void admin() {
    User me = AuthUtils.getUser();
    if (me == null || !AuthUtils.isAdmin(me)) throw ApiException.forbidden();
  }

  public record NumberingCommand(Integer version, String prefix, Integer digits) {}

  /** A record type's numbering; example is the next number as it will look. */
  public record NumberingView(String code, String name, boolean configured, Integer version, String prefix, Integer digits,
      Long nextNumber, String example) {}
}
