package com.ioeti.reports.rest;

import com.axelor.apps.crm.db.Event;
import com.axelor.apps.crm.db.Lead;
import com.axelor.apps.crm.db.LeadStatus;
import com.axelor.apps.crm.db.Opportunity;
import com.axelor.apps.crm.db.repo.EventRepository;
import com.axelor.apps.marketing.db.Campaign;
import com.axelor.apps.project.db.Project;
import com.axelor.auth.AuthUtils;
import com.axelor.db.JPA;
import com.axelor.db.Model;
import com.axelor.apps.base.AxelorException;
import com.axelor.inject.Beans;
import com.axelor.meta.db.MetaModule;
import com.axelor.utils.api.ResponseConstructor;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ioeti.businessline.service.LeadLifecycleService;
import com.ioeti.certification.db.CertificationCycle;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.IoetiEndpoint;
import com.ioeti.fundraising.db.FundingOpportunity;
import com.ioeti.operations.db.HandoverRequest;
import com.ioeti.recruitment.db.CandidateApplication;
import com.ioeti.recruitment.db.ClientJobOrder;
import com.ioeti.recruitment.db.Placement;
import com.ioeti.reports.service.ScopedAggregates;
import com.ioeti.training.db.TrainingEnrollment;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Reports from authorized queries (Wave 7b). Every figure is an aggregate of real records inside the
 * caller's read permissions; an area the caller cannot read is {@code null} (left out), never 0.
 * Opportunity amounts are the salespeople's expected values per currency, never added across
 * currencies and never presented as revenue.
 */
@Path("/ioeti/reports")
@Produces(MediaType.APPLICATION_JSON)
public class ReportsRestController {

  // --- sales: pipeline, lead funnel, campaigns, follow-ups ----------------------------------------

  @GET
  @Path("/sales")
  @Operation(summary = "Pipeline, lead funnel, campaigns and follow-ups the caller may read", tags = {"IOETI reports"})
  @IoetiEndpoint
  public Response sales(@QueryParam("from") String from, @QueryParam("to") String to, @QueryParam("businessLine") String line) {
    Range range = range(from, to);
    boolean byLine = line != null && !line.isBlank();
    return ResponseConstructor.build(Response.Status.OK, "Sales report", new SalesReport(range.from(), range.to(), byLine ? line : null,
        pipeline(range, byLine ? line : null), funnel(range, byLine ? line : null), campaigns(range), followUps()));
  }

  private static List<PipelineRow> pipeline(Range range, String line) {
    if (!ScopedAggregates.permitted(Opportunity.class)) return null;
    Criteria c = range.criteria();
    if (line != null) c.add("bl.code = ?", line);
    List<Object[]> rows = ScopedAggregates.rows(Opportunity.class,
        "bl.code, st.id, st.name, st.sequence, st.isOpen, cur.codeISO, count(self), sum(self.amount)",
        "LEFT JOIN self.ioetiBusinessLine bl LEFT JOIN self.opportunityStatus st LEFT JOIN self.currency cur",
        c.where(), c.params(), "bl.code, st.id, st.name, st.sequence, st.isOpen, cur.codeISO");
    Map<String, PipelineRow> merged = new LinkedHashMap<>();
    rows.sort(Comparator.comparing((Object[] r) -> r[0] == null ? "~" : (String) r[0])
        .thenComparing(r -> r[3] == null ? Integer.MAX_VALUE : ((Number) r[3]).intValue()));
    for (Object[] r : rows) {
      String key = r[0] + "|" + r[1];
      PipelineRow row = merged.computeIfAbsent(key, k -> new PipelineRow((String) r[0], (String) r[2], r[4] == null ? null : (Boolean) r[4], 0, new ArrayList<>()));
      long count = ((Number) r[6]).longValue();
      BigDecimal sum = r[7] == null ? BigDecimal.ZERO : (BigDecimal) r[7];
      PipelineRow next = new PipelineRow(row.businessLineCode(), row.stage(), row.open(), row.count() + count, row.amounts());
      if (r[5] != null || sum.signum() != 0) next.amounts().add(new Amount((String) r[5], sum));
      merged.put(key, next);
    }
    return new ArrayList<>(merged.values());
  }

  private static Funnel funnel(Range range, String line) {
    if (!ScopedAggregates.permitted(Lead.class)) return null;
    Criteria c = range.criteria();
    if (line != null) c.add("bl.code = ?", line);
    List<Object[]> rows = ScopedAggregates.rows(Lead.class, "src.name, st.id, count(self)",
        "LEFT JOIN self.source src LEFT JOIN self.leadStatus st LEFT JOIN self.ioetiBusinessLine bl",
        c.where(), c.params(), "src.name, st.id");
    Map<String, long[]> bySource = new LinkedHashMap<>();
    long[] total = new long[4];
    for (Object[] r : rows) {
      long[] counts = bySource.computeIfAbsent(r[0] == null ? "" : (String) r[0], k -> new long[4]);
      long n = ((Number) r[2]).longValue();
      int slot = switch (kind(r[1] == null ? null : JPA.find(LeadStatus.class, ((Number) r[1]).longValue()))) {
        case "CONVERTED" -> 2;
        case "LOST" -> 3;
        default -> 1;
      };
      counts[0] += n;
      counts[slot] += n;
      total[0] += n;
      total[slot] += n;
    }
    List<SourceRow> sources = new ArrayList<>();
    bySource.forEach((name, n) -> sources.add(new SourceRow(name.isEmpty() ? null : name, n[0], n[1], n[2], n[3])));
    sources.sort(Comparator.comparingLong(SourceRow::total).reversed());
    return new Funnel(total[0], total[1], total[2], total[3], sources);
  }

  private static String kind(LeadStatus status) {
    if (status == null) return "OPEN";
    try {
      String kind = Beans.get(LeadLifecycleService.class).kind(status);
      return kind == null ? "OPEN" : kind;
    } catch (AxelorException e) {
      return "OPEN";
    }
  }

  /** Readable campaigns with the number of readable leads attributed to each. */
  private static List<CampaignRow> campaigns(Range range) {
    if (!ScopedAggregates.permitted(Campaign.class) || !ScopedAggregates.permitted(Lead.class)) return null;
    List<Object[]> readable = ScopedAggregates.rows(Campaign.class, "self.id, self.name", null, null, List.of(), null);
    List<CampaignRow> out = new ArrayList<>();
    for (Object[] c : readable.size() > 100 ? readable.subList(0, 100) : readable) {
      Criteria criteria = range.criteria();
      criteria.add("EXISTS (SELECT 1 FROM Campaign c JOIN c.leadSet cl WHERE c.id = ? AND cl = self)", c[0]);
      long leads = ScopedAggregates.count(Lead.class, criteria.where(), criteria.params());
      out.add(new CampaignRow(((Number) c[0]).longValue(), (String) c[1], leads));
    }
    out.sort(Comparator.comparingLong(CampaignRow::leads).reversed());
    return out;
  }

  /** The caller's own lead follow-ups (planned, overdue, done in the last 30 days). */
  private static FollowUps followUps() {
    if (!ScopedAggregates.permitted(Event.class)) return null;
    Object me = AuthUtils.getUser();
    String mine = "self.eventLead IS NOT NULL AND self.user = ?";
    long planned = ScopedAggregates.count(Event.class, mine + " AND self.statusSelect = ?", List.of(me, EventRepository.STATUS_PLANNED));
    long overdue = ScopedAggregates.count(Event.class, mine + " AND self.statusSelect = ? AND self.startDateTime < ?",
        List.of(me, EventRepository.STATUS_PLANNED, LocalDateTime.now()));
    long done = ScopedAggregates.count(Event.class, mine + " AND self.statusSelect = ? AND self.startDateTime >= ?",
        List.of(me, EventRepository.STATUS_REALIZED, LocalDateTime.now().minusDays(30)));
    return new FollowUps(planned, overdue, done);
  }

  // --- activity across areas -----------------------------------------------------------------------

  @GET
  @Path("/areas")
  @Operation(summary = "How many records the caller may read in each area (left out when not permitted)", tags = {"IOETI reports"})
  @IoetiEndpoint
  public Response areas(@QueryParam("from") String from, @QueryParam("to") String to) {
    Range range = range(from, to);
    List<AreaRow> rows = new ArrayList<>();
    area(rows, "TRAINING_ENROLLMENTS", TrainingEnrollment.class, range, null);
    area(rows, "CERTIFICATION_CYCLES", CertificationCycle.class, range, null);
    area(rows, "JOB_ORDERS", ClientJobOrder.class, range, null);
    area(rows, "APPLICATIONS", CandidateApplication.class, range, null);
    area(rows, "PLACEMENTS", Placement.class, range, null);
    area(rows, "HANDOVERS", HandoverRequest.class, range, null);
    area(rows, "ENGAGEMENTS", Project.class, range, "self.ioetiHandover IS NOT NULL");
    area(rows, "FUNDING_OPPORTUNITIES", FundingOpportunity.class, range, null);
    return ResponseConstructor.build(Response.Status.OK, "Areas", new AreasReport(range.from(), range.to(), rows));
  }

  private static void area(List<AreaRow> rows, String key, Class<? extends Model> type, Range range, String extra) {
    if (!ScopedAggregates.permitted(type)) return;
    Criteria c = range.criteria();
    if (extra != null) c.add(extra);
    rows.add(new AreaRow(key, ScopedAggregates.count(type, c.where(), c.params())));
  }

  // --- system (administrators) ---------------------------------------------------------------------

  @GET
  @Path("/system")
  @Operation(summary = "Installed IOETI modules, applied schema migrations and the policy decisions (administrators)", tags = {"IOETI reports"})
  @IoetiEndpoint
  public Response system() {
    if (!AuthUtils.isAdmin(AuthUtils.getUser())) throw ApiException.forbidden();
    List<String> modules = JPA.em().createQuery("SELECT m.name FROM MetaModule m WHERE m.name LIKE 'ioeti-%' ORDER BY m.name", String.class)
        .getResultList();
    List<Migration> migrations = new ArrayList<>();
    try {
      @SuppressWarnings("unchecked")
      List<Object[]> rows = JPA.em().createNativeQuery("SELECT version, name, applied_on FROM ioeti_schema_migration ORDER BY version").getResultList();
      for (Object[] r : rows) migrations.add(new Migration(((Number) r[0]).intValue(), (String) r[1], r[2] == null ? null : r[2].toString()));
    } catch (RuntimeException e) {
      migrations = null; // the ledger does not exist where migrations were never applied (e.g. a fresh dev database)
    }
    return ResponseConstructor.build(Response.Status.OK, "System", new SystemReport(modules, migrations, policies()));
  }

  static List<Policy> policies() {
    try (InputStream in = ReportsRestController.class.getResourceAsStream("/ioeti/policy-decisions.json")) {
      if (in == null) return List.of();
      return new ObjectMapper().readValue(in, new TypeReference<List<Policy>>() {});
    } catch (IOException e) {
      return List.of();
    }
  }

  // --- helpers -------------------------------------------------------------------------------------

  record Range(LocalDate from, LocalDate to) {
    Criteria criteria() {
      Criteria c = new Criteria();
      if (from != null) c.add("self.createdOn >= ?", from.atStartOfDay());
      if (to != null) c.add("self.createdOn < ?", to.plusDays(1).atStartOfDay());
      return c;
    }
  }

  static final class Criteria {
    private final List<String> conditions = new ArrayList<>();
    private final List<Object> params = new ArrayList<>();

    void add(String condition, Object... values) {
      conditions.add(condition);
      params.addAll(List.of(values));
    }

    String where() {
      return conditions.isEmpty() ? null : String.join(" AND ", conditions);
    }

    List<Object> params() {
      return params;
    }
  }

  static Range range(String from, String to) {
    LocalDate start = date("from", from);
    LocalDate end = date("to", to);
    if (start != null && end != null && end.isBefore(start)) throw ApiException.invalidField("to", "BEFORE_START", "The end is before the start.");
    if (start != null && end != null && start.plusYears(5).isBefore(end)) throw ApiException.invalidField("to", "TOO_LONG", "Use at most five years.");
    return new Range(start, end);
  }

  private static LocalDate date(String field, String value) {
    if (value == null || value.isBlank()) return null;
    try {
      return LocalDate.parse(value.strip());
    } catch (DateTimeParseException e) {
      throw ApiException.invalidField(field, "FORMAT", "Use a date like 2026-01-31.");
    }
  }

  public record Amount(String currency, BigDecimal amount) {}
  public record PipelineRow(String businessLineCode, String stage, Boolean open, long count, List<Amount> amounts) {}
  public record SourceRow(String source, long total, long open, long converted, long lost) {}
  public record Funnel(long total, long open, long converted, long lost, List<SourceRow> bySource) {}
  public record CampaignRow(Long id, String name, long leads) {}
  public record FollowUps(long planned, long overdue, long doneLast30Days) {}
  public record SalesReport(LocalDate from, LocalDate to, String businessLineCode, List<PipelineRow> pipeline, Funnel leads,
      List<CampaignRow> campaigns, FollowUps followUps) {}
  public record AreaRow(String key, long count) {}
  public record AreasReport(LocalDate from, LocalDate to, List<AreaRow> areas) {}
  public record Migration(int version, String name, String appliedOn) {}
  public record Policy(String id, String title, String status) {}
  public record SystemReport(List<String> modules, List<Migration> migrations, List<Policy> policies) {}
}
