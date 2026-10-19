package com.ioeti.businessline.rest;

import com.axelor.db.JpaSecurity;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.axelor.rpc.filter.Filter;
import com.axelor.utils.api.ResponseConstructor;
import com.axelor.utils.api.SecurityCheck;
import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.User;
import com.ioeti.businessline.db.BusinessLine;
import com.ioeti.businessline.db.repo.BusinessLineRepository;
import com.ioeti.businessline.security.BusinessLineEligibility;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.IoetiEndpoint;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.List;
import java.util.Locale;

/**
 * Read API for business lines: {@code GET /ws/ioeti/business-lines} and {@code GET
 * /ws/ioeti/business-lines/{code}}.
 *
 * <p>Security is enforced server-side: model-level read permission via {@link SecurityCheck}, and
 * record-level conditions (Axelor permission conditions) via {@link JpaSecurity#getFilter} applied
 * to the query. Callers never receive rows their permissions exclude.
 */
@Path("/ioeti/business-lines")
@Produces(MediaType.APPLICATION_JSON)
public class BusinessLineRestController {

  @Operation(
      summary = "List business lines visible to the current user",
      tags = {"IOETI business lines"})
  @GET
  @IoetiEndpoint
  public Response list(
      @QueryParam("activeOnly") boolean activeOnly, @QueryParam("creatable") boolean creatable) {
    new SecurityCheck().readAccess(BusinessLine.class).check();
    User user = AuthUtils.getUser();
    List<BusinessLineResponse> lines =
        readableLines().order("sequence").order("code").fetch().stream()
            .filter(
                line ->
                    !(activeOnly || creatable)
                        || Integer.valueOf(BusinessLineRepository.STATUS_ACTIVE)
                            .equals(line.getStatusSelect()))
            // SEC-003: only lines the user may start opportunities in
            .filter(line -> !creatable || BusinessLineEligibility.canCreateIn(user, line))
            .map(BusinessLineResponse::of)
            .toList();
    return ResponseConstructor.build(Response.Status.OK, "Business lines", lines);
  }

  @Operation(
      summary = "Get one business line by code",
      tags = {"IOETI business lines"})
  @GET
  @Path("/{code}")
  @IoetiEndpoint
  public Response get(@PathParam("code") String code) {
    new SecurityCheck().readAccess(BusinessLine.class).check();
    String wanted = code == null ? "" : code.trim().toUpperCase(Locale.ROOT);
    return readableLines().fetch().stream()
        .filter(line -> wanted.equals(line.getCode()))
        .findFirst()
        .map(
            line ->
                ResponseConstructor.build(
                    Response.Status.OK, "Business line", BusinessLineResponse.of(line)))
        .orElseThrow(ApiException::notFound);
  }

  /** Query restricted by the record-level conditions of the current user's permissions. */
  private Query<BusinessLine> readableLines() {
    Filter filter =
        Beans.get(JpaSecurity.class).getFilter(JpaSecurity.CAN_READ, BusinessLine.class);
    return filter == null ? Query.of(BusinessLine.class) : filter.build(BusinessLine.class);
  }
}
