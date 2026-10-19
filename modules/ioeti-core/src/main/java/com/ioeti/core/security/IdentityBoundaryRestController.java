package com.ioeti.core.security;

import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.User;
import com.axelor.utils.api.HttpExceptionHandler;
import com.axelor.utils.api.ResponseConstructor;
import jakarta.ws.rs.ForbiddenException;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

/** Admin-only SEC-001 diagnostics: is the boundary installed, and what has it cleared. */
@Path("/ioeti/security/identity-boundary")
@Produces(MediaType.APPLICATION_JSON)
public class IdentityBoundaryRestController {

  @GET
  @HttpExceptionHandler
  public Response stats() {
    User user = AuthUtils.getUser();
    if (user == null || !AuthUtils.isAdmin(user)) {
      throw new ForbiddenException("Administrators only.");
    }
    return ResponseConstructor.build(
        Response.Status.OK, "Request identity boundary", RequestIdentityBoundary.stats());
  }
}
