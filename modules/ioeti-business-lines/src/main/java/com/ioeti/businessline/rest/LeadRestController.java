package com.ioeti.businessline.rest;

import com.axelor.apps.crm.db.Lead;
import com.axelor.db.JpaSecurity;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.axelor.rpc.filter.Filter;
import com.axelor.utils.api.HttpExceptionHandler;
import com.axelor.utils.api.ResponseConstructor;
import com.axelor.utils.api.SecurityCheck;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.List;

/**
 * Source-first, read-only lead explorer for the IOETI custom UI.
 * Fields deliberately exclude contact details, sensitive notes and conversion actions.
 */
@Path("/ioeti/leads")
@Produces(MediaType.APPLICATION_JSON)
public class LeadRestController {
  @GET
  @Operation(summary = "Read authorized leads using the existing Axelor CRM model", tags = {"IOETI leads"})
  @HttpExceptionHandler
  public Response list(@QueryParam("limit") Integer requestedLimit, @QueryParam("offset") Integer requestedOffset) {
    new SecurityCheck().readAccess(Lead.class).check();
    int limit = requestedLimit == null ? 25 : requestedLimit;
    int offset = requestedOffset == null ? 0 : requestedOffset;
    if (limit < 1 || limit > 50 || offset < 0 || offset > 10000) {
      throw new BadRequestException("Invalid pagination parameters");
    }
    Filter condition = Beans.get(JpaSecurity.class).getFilter(JpaSecurity.CAN_READ, Lead.class);
    Query<Lead> query = condition == null ? Query.of(Lead.class) : condition.build(Lead.class);
    List<LeadView> records = query.order("-id").fetch(limit, offset).stream().map(this::project).toList();
    return ResponseConstructor.build(Response.Status.OK, "Leads", records);
  }

  @GET
  @Path("/{id}")
  @Operation(summary = "Read one lead with record-level permission checks", tags = {"IOETI leads"})
  @HttpExceptionHandler
  public Response get(@PathParam("id") Long id) {
    new SecurityCheck().readAccess(Lead.class, id).check();
    Filter condition = Beans.get(JpaSecurity.class).getFilter(JpaSecurity.CAN_READ, Lead.class);
    Query<Lead> query = condition == null ? Query.of(Lead.class) : condition.build(Lead.class);
    Lead lead = query.filter("self.id = :id").bind("id", id).fetchOne();
    // Preserve record-level security even if Query.filter replaces earlier predicates:
    if (lead == null || !Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, Lead.class, id)) {
      throw new NotFoundException();
    }
    return ResponseConstructor.build(Response.Status.OK, "Lead", project(lead));
  }

  private LeadView project(Lead lead) {
    return new LeadView(
      lead.getId(),
      lead.getFullName() == null || lead.getFullName().isBlank() ? lead.getName() : lead.getFullName(),
      lead.getEnterpriseName(),
      lead.getLeadStatus() == null ? null : lead.getLeadStatus().getName()
    );
  }
  public record LeadView(Long id, String name, String organization, String stage) {}
}
