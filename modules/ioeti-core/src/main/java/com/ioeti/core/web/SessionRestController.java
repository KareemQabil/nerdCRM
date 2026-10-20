package com.ioeti.core.web;

import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.User;
import com.ioeti.core.api.IoetiEndpoint;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.apache.shiro.subject.Subject;

/**
 * Authoritative session identity for the custom IOETI frontend.
 *
 * Unlike a BusinessLine fetch, this endpoint succeeds for any authenticated user,
 * even when that user has no permissions on business models.
 */
@Path("/ioeti/session")
@Produces(MediaType.APPLICATION_JSON)
public class SessionRestController {

  @GET
  @IoetiEndpoint
  public Response me() {
    Subject subject = AuthUtils.getSubject();
    if (subject == null || !subject.isAuthenticated()) {
      return Response.status(Response.Status.UNAUTHORIZED).build();
    }
    User user = AuthUtils.getUser();
    if (user == null || !AuthUtils.isActive(user)) {
      return Response.status(Response.Status.UNAUTHORIZED).build();
    }
    return Response.ok(new SessionIdentity(user.getCode(), user.getName(), user.getLanguage())).build();
  }

  public record SessionIdentity(String code, String name, String language) {}
}
