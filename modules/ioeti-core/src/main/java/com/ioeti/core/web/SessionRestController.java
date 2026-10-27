package com.ioeti.core.web;

import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.User;
import com.axelor.db.JpaSecurity;
import com.axelor.db.Model;
import com.axelor.inject.Beans;
import com.ioeti.core.api.IoetiEndpoint;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
    return Response.ok(new SessionIdentity(user.getCode(), user.getName(), user.getLanguage(), AuthUtils.isAdmin(user),
        com.ioeti.core.policy.PolicyService.isOwner(user), pages())).build();
  }

  /**
   * The pages whose main records the person may read, so the menu offers only what will open. A page appears when any of
   * its record types is readable natively. Modules live in other jars, so the types are named, and a type that is not
   * installed simply does not count.
   */
  static final Map<String, List<String>> PAGES = new LinkedHashMap<>();

  static {
    PAGES.put("leads", List.of("com.axelor.apps.crm.db.Lead"));
    PAGES.put("accounts", List.of("com.axelor.apps.base.db.Partner"));
    PAGES.put("opportunities", List.of("com.axelor.apps.crm.db.Opportunity"));
    PAGES.put("catalog", List.of("com.axelor.apps.base.db.Product"));
    PAGES.put("campaigns", List.of("com.axelor.apps.marketing.db.Campaign"));
    PAGES.put("operations", List.of("com.ioeti.operations.db.HandoverRequest", "com.axelor.apps.project.db.Project"));
    PAGES.put("visits", List.of("com.axelor.apps.intervention.db.Intervention"));
    PAGES.put("quality", List.of("com.axelor.apps.quality.db.QualityImprovement"));
    PAGES.put("finance", List.of("com.ioeti.workspace.db.InvoiceRequest", "com.axelor.apps.sale.db.SaleOrder"));
    PAGES.put("certification", List.of("com.ioeti.certification.db.CertificationCycle"));
    PAGES.put("training", List.of("com.ioeti.training.db.TrainingCohort", "com.ioeti.training.db.TrainingCourse"));
    PAGES.put("recruitment", List.of("com.ioeti.recruitment.db.ClientJobOrder"));
    PAGES.put("fundraising", List.of("com.ioeti.fundraising.db.DonorProfile", "com.ioeti.fundraising.db.FundingOpportunity"));
    PAGES.put("knowledge", List.of("com.ioeti.content.db.KnowledgeArticle"));
  }

  @SuppressWarnings("unchecked")
  static List<String> pages() {
    JpaSecurity security = Beans.get(JpaSecurity.class);
    List<String> out = new ArrayList<>();
    PAGES.forEach((page, types) -> {
      for (String type : types) {
        try {
          if (security.isPermitted(JpaSecurity.CAN_READ, (Class<? extends Model>) Class.forName(type))) {
            out.add(page);
            return;
          }
        } catch (ClassNotFoundException e) {
          // that module is not installed
        }
      }
    });
    return out;
  }

  /**
   * {@code administrator}, {@code policyOwner} and {@code pages} only choose which screens to offer; every endpoint checks
   * access again.
   */
  public record SessionIdentity(String code, String name, String language, boolean administrator, boolean policyOwner, List<String> pages) {}
}
