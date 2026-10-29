package com.ioeti.training.rest;

import com.axelor.apps.base.db.Partner;
import com.axelor.db.JpaSecurity;
import com.axelor.inject.Beans;
import com.axelor.rpc.filter.JPQLFilter;
import com.axelor.utils.api.ResponseConstructor;
import com.axelor.utils.api.SecurityCheck;
import com.fasterxml.jackson.databind.JsonNode;
import com.ioeti.core.api.IoetiEndpoint;
import com.ioeti.core.api.RecordAccess;
import com.ioeti.core.policy.PolicyService;
import com.ioeti.training.db.TrainingCertificate;
import com.ioeti.training.db.TrainingCohort;
import com.ioeti.training.db.TrainingCourse;
import com.ioeti.training.db.TrainingEnrollment;
import com.ioeti.training.db.TrainingNationalId;
import com.ioeti.training.db.repo.TrainingCertificateRepository;
import com.ioeti.training.service.CompletionService;
import com.ioeti.training.service.CompletionService.Standing;
import com.ioeti.training.service.RefundService;
import com.ioeti.training.service.TrainingRules;
import com.ioeti.training.service.TrainingRules.Criteria;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * D-03 (signed 2026-10-25), completing a course: the rules a cohort runs under, assessment scores, who meets the
 * course's criteria, certificates (issue one, issue all eligible, revoke) and recording a national ID. Every record goes
 * through native permissions and record filters, like the rest of {@code /ws/ioeti/training}.
 */
@Path("/ioeti/training")
@Produces(MediaType.APPLICATION_JSON)
public class TrainingCompletionRestController {

  // --- rules --------------------------------------------------------------------------------------------------

  @GET
  @Path("/cohorts/{id}/rules")
  @Operation(summary = "The D-03 policies a cohort runs under today: certificate criteria, national ID, cancellation", tags = {"IOETI training"})
  @IoetiEndpoint
  public Response rules(@PathParam("id") Long id) {
    TrainingCohort cohort = RecordAccess.readable(TrainingCohort.class, id);
    LocalDate today = CompletionService.today();
    CompletionService completion = Beans.get(CompletionService.class);
    TrainingCourse course = cohort.getCourse();
    Optional<PolicyService.Applied> criteria = completion.criteria(cohort, today);
    Optional<PolicyService.Applied> identity = completion.identityRule(course, today);
    String line = course.getBusinessLine() == null ? null : course.getBusinessLine().getCode();
    Optional<PolicyService.Applied> cancellation = Beans.get(PolicyService.class).current(RefundService.POLICY, line, today);
    List<TrainingRefundStepView> steps = cancellation.map(a -> TrainingRules.steps(a.value()).stream()
        .map(s -> new TrainingRefundStepView(s.daysBeforeStart(), s.refundPercent())).toList()).orElse(null);
    BigDecimal cohortRefund = cancellation.map(a -> a.value().hasNonNull("cohortCancelledRefundPercent")
        ? a.value().get("cohortCancelledRefundPercent").decimalValue() : null).orElse(null);
    return ResponseConstructor.build(Response.Status.OK, "Rules", new TrainingRulesView(
        criteria.isPresent(), criteria.map(a -> a.value().path("minAttendancePercent").decimalValue()).orElse(null),
        criteria.map(a -> passMark(a.value())).orElse(null),
        identity.map(a -> a.value().path("collect").asText()).orElse(null),
        cancellation.isPresent(), steps, cohortRefund));
  }

  private static BigDecimal passMark(JsonNode value) {
    return value.hasNonNull("passMark") ? value.get("passMark").decimalValue() : null;
  }

  // --- eligibility and assessment ------------------------------------------------------------------------------

  @GET
  @Path("/cohorts/{id}/eligibility")
  @Operation(summary = "Each confirmed trainee's attendance, score and whether they meet the course's certificate criteria (D-03)",
      tags = {"IOETI training"})
  @IoetiEndpoint
  public Response eligibility(@PathParam("id") Long id) {
    TrainingCohort cohort = RecordAccess.readable(TrainingCohort.class, id);
    new SecurityCheck().readAccess(TrainingEnrollment.class).check();
    LocalDate today = CompletionService.today();
    CompletionService completion = Beans.get(CompletionService.class);
    Optional<PolicyService.Applied> applied = completion.criteria(cohort, today);
    Criteria criteria = applied.map(a -> Criteria.of(a.value())).orElse(null);
    JpaSecurity security = Beans.get(JpaSecurity.class);
    boolean seeCertificates = security.isPermitted(JpaSecurity.CAN_READ, TrainingCertificate.class);
    List<TrainingEligibilityRowView> rows = new ArrayList<>();
    for (Standing s : completion.standings(cohort, criteria)) {
      TrainingEnrollment e = s.enrollment();
      if (!security.isPermitted(JpaSecurity.CAN_READ, TrainingEnrollment.class, e.getId())) continue;
      TrainingCertificate c = seeCertificates && s.certificate() != null
          && security.isPermitted(JpaSecurity.CAN_READ, TrainingCertificate.class, s.certificate().getId()) ? s.certificate() : null;
      rows.add(new TrainingEligibilityRowView(e.getId(), e.getVersion(), traineeName(e), s.present(), s.eligibility().attendancePercent(),
          e.getAssessmentScore(), s.eligibility().eligible(), s.eligibility().reason(),
          c == null ? null : c.getId(), c == null ? null : c.getVersion(), c == null ? null : c.getSerial(), c == null ? null : c.getIssueDate()));
    }
    boolean canIssue = security.isPermitted(JpaSecurity.CAN_CREATE, TrainingCertificate.class)
        && security.isPermitted(JpaSecurity.CAN_WRITE, TrainingCohort.class, cohort.getId());
    return ResponseConstructor.build(Response.Status.OK, "Eligibility", new TrainingEligibilityView(cohort.getId(), cohort.getVersion(),
        criteria != null, criteria == null ? null : criteria.minAttendancePercent(), criteria == null ? null : criteria.passMark(),
        CompletionService.sessions(cohort), canIssue, rows));
  }

  @POST
  @Path("/enrollments/{id}/assessment")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Record or correct a trainee's assessment score (0-100) where the course has a pass mark (D-03)", tags = {"IOETI training"})
  @IoetiEndpoint
  public Response assess(@PathParam("id") Long id, RecordTrainingScore command) {
    TrainingEnrollment enrollment = TrainingRestController.writable(TrainingEnrollment.class, id, command == null ? null : command.version());
    LocalDate today = CompletionService.today();
    TrainingRestController.write(() -> Beans.get(CompletionService.class).assess(enrollment, command.score(), today));
    return ResponseConstructor.build(Response.Status.OK, "Score recorded", TrainingRestController.view(enrollment));
  }

  @POST
  @Path("/enrollments/{id}/national-id")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Record or correct a trainee's national ID where the course asks for it; never returned (D-03)", tags = {"IOETI training"})
  @IoetiEndpoint
  public Response nationalId(@PathParam("id") Long id, RecordNationalId command) {
    TrainingEnrollment enrollment = TrainingRestController.writable(TrainingEnrollment.class, id, command == null ? null : command.version());
    new SecurityCheck().createAccess(TrainingNationalId.class).writeAccess(TrainingNationalId.class).check();
    LocalDate today = CompletionService.today();
    TrainingRestController.write(() -> Beans.get(CompletionService.class).recordIdentity(enrollment, command.nationalId(), today));
    return ResponseConstructor.build(Response.Status.OK, "National ID recorded", TrainingRestController.view(enrollment));
  }

  // --- certificates -------------------------------------------------------------------------------------------

  @POST
  @Path("/enrollments/{id}/certificate")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Issue a certificate to a trainee who meets the course's criteria; otherwise 422 NOT_ELIGIBLE with the reason (D-03)",
      tags = {"IOETI training"})
  @IoetiEndpoint
  public Response issue(@PathParam("id") Long id, TrainingRestController.VersionOnly command) {
    TrainingEnrollment enrollment = TrainingRestController.writable(TrainingEnrollment.class, id, command == null ? null : command.version());
    new SecurityCheck().createAccess(TrainingCertificate.class).check();
    LocalDate today = CompletionService.today();
    TrainingCertificate[] saved = new TrainingCertificate[1];
    TrainingRestController.write(() -> saved[0] = Beans.get(CompletionService.class).issue(enrollment, today));
    return ResponseConstructor.build(Response.Status.CREATED, "Certificate issued", view(saved[0]));
  }

  @POST
  @Path("/cohorts/{id}/certificates")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Issue certificates to every trainee of the cohort who meets the criteria and has none; the others are listed with the reason (D-03)",
      tags = {"IOETI training"})
  @IoetiEndpoint
  public Response issueAll(@PathParam("id") Long id, TrainingRestController.VersionOnly command) {
    TrainingCohort cohort = TrainingRestController.writable(TrainingCohort.class, id, command == null ? null : command.version());
    new SecurityCheck().createAccess(TrainingCertificate.class).writeAccess(TrainingEnrollment.class).check();
    LocalDate today = CompletionService.today();
    CompletionService.Bulk[] done = new CompletionService.Bulk[1];
    TrainingRestController.write(() -> done[0] = Beans.get(CompletionService.class).issueAll(cohort, today));
    List<TrainingCertificateView> issued = done[0].issued().stream().map(TrainingCompletionRestController::view).toList();
    List<TrainingSkippedView> skipped = done[0].skipped().stream()
        .map(s -> new TrainingSkippedView(s.enrollment().getId(), traineeName(s.enrollment()), s.eligibility().reason())).toList();
    return ResponseConstructor.build(Response.Status.OK, "Certificates issued", new TrainingBulkIssueView(issued, skipped));
  }

  @GET
  @Path("/certificates/{id}")
  @Operation(summary = "One certificate, as issued (for printing)", tags = {"IOETI training"})
  @IoetiEndpoint
  public Response certificate(@PathParam("id") Long id) {
    return ResponseConstructor.build(Response.Status.OK, "Certificate", view(RecordAccess.readable(TrainingCertificate.class, id)));
  }

  @GET
  @Path("/cohorts/{id}/certificates")
  @Operation(summary = "Certificates of a cohort, issued and revoked", tags = {"IOETI training"})
  @IoetiEndpoint
  public Response certificates(@PathParam("id") Long id) {
    TrainingCohort cohort = RecordAccess.readable(TrainingCohort.class, id);
    new SecurityCheck().readAccess(TrainingCertificate.class).check();
    List<TrainingCertificateView> rows = TrainingRestController.readable(TrainingCertificate.class,
            new JPQLFilter("self.enrollment.cohort.id = " + cohort.getId()))
        .order("serial").fetch(TrainingRestController.MAX_CAPACITY * 2).stream().map(TrainingCompletionRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Certificates", rows);
  }

  @POST
  @Path("/certificates/{id}/revoke")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Revoke a certificate with the reason (kept, never returned) (D-03)", tags = {"IOETI training"})
  @IoetiEndpoint
  public Response revoke(@PathParam("id") Long id, RevokeTrainingCertificate command) {
    TrainingCertificate certificate = TrainingRestController.writable(TrainingCertificate.class, id, command == null ? null : command.version());
    LocalDate today = CompletionService.today();
    TrainingRestController.write(() -> Beans.get(CompletionService.class).revoke(certificate, command.reason(), today));
    return ResponseConstructor.build(Response.Status.OK, "Certificate revoked", view(certificate));
  }

  // --- views --------------------------------------------------------------------------------------------------

  static String traineeName(TrainingEnrollment e) {
    Partner trainee = e.getTrainee();
    return Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, Partner.class, trainee.getId()) ? trainee.getSimpleFullName() : null;
  }

  static TrainingCertificateView view(TrainingCertificate c) {
    TrainingEnrollment e = c.getEnrollment();
    TrainingCohort cohort = e.getCohort();
    TrainingCourse course = cohort.getCourse();
    return new TrainingCertificateView(c.getId(), c.getVersion(), c.getSerial(), e.getId(), c.getIssueDate(), c.getTraineeName(),
        c.getCourseTitle(), c.getCourseTitleAr(), course.getDurationHours(), cohort.getCode(), cohort.getStartDate(), cohort.getEndDate(),
        c.getAttendancePercent(), c.getScore(),
        Integer.valueOf(TrainingCertificateRepository.STATUS_REVOKED).equals(c.getStatusSelect()) ? "REVOKED" : "ISSUED", c.getRevokedOn());
  }

  public record RecordTrainingScore(Integer version, BigDecimal score) {}
  /** nationalId is input only (G-007 RESTRICTED). */
  public record RecordNationalId(Integer version, String nationalId) {}
  /** reason is input only (G-007 RESTRICTED: free text about a person). */
  public record RevokeTrainingCertificate(Integer version, String reason) {}
  public record TrainingRefundStepView(Integer daysBeforeStart, BigDecimal refundPercent) {}
  /** identityCollection: NOT_ASKED, OPTIONAL, REQUIRED, or null while the course's policy is not set. */
  public record TrainingRulesView(boolean criteriaSet, BigDecimal minAttendancePercent, BigDecimal passMark, String identityCollection,
      boolean cancellationSet, List<TrainingRefundStepView> refundSteps, BigDecimal cohortCancelledRefundPercent) {}
  /** reason: null when eligible, else NOT_CONFIRMED, NO_SESSIONS, ATTENDANCE_BELOW, SCORE_MISSING, SCORE_BELOW or POLICY_NOT_SET. */
  public record TrainingEligibilityRowView(Long enrollmentId, Integer version, String traineeName, int sessionsPresent,
      BigDecimal attendancePercent, BigDecimal score, boolean eligible, String reason, Long certificateId, Integer certificateVersion,
      String certificateSerial, LocalDate certificateIssued) {}
  public record TrainingEligibilityView(Long cohortId, Integer cohortVersion, boolean criteriaSet, BigDecimal minAttendancePercent,
      BigDecimal passMark, int sessions, boolean canIssue, List<TrainingEligibilityRowView> rows) {}
  public record TrainingCertificateView(Long id, Integer version, String serial, Long enrollmentId, LocalDate issueDate, String traineeName,
      String courseName, String courseNameAr, Integer durationHours, String cohortCode, LocalDate startDate, LocalDate endDate,
      BigDecimal attendancePercent, BigDecimal score, String status, LocalDate revokedOn) {}
  public record TrainingSkippedView(Long enrollmentId, String traineeName, String reason) {}
  public record TrainingBulkIssueView(List<TrainingCertificateView> issued, List<TrainingSkippedView> skipped) {}
}
