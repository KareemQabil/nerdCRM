package com.ioeti.training.rest;

import com.axelor.apps.base.db.Partner;
import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.AuditableModel;
import com.axelor.db.JPA;
import com.axelor.db.JpaSecurity;
import com.axelor.db.Model;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.axelor.rpc.filter.Filter;
import com.axelor.rpc.filter.JPQLFilter;
import com.axelor.utils.api.ConflictChecker;
import com.axelor.utils.api.ResponseConstructor;
import com.axelor.utils.api.SecurityCheck;
import com.ioeti.businessline.db.BusinessLine;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.IoetiEndpoint;
import com.ioeti.core.api.RecordAccess;
import com.ioeti.core.web.OptimisticLockConflicts;
import com.ioeti.training.db.CohortSession;
import com.ioeti.training.db.TrainingAttendance;
import com.ioeti.training.db.TrainingCohort;
import com.ioeti.training.db.TrainingCourse;
import com.ioeti.training.db.TrainingEnrollment;
import com.ioeti.training.db.repo.TrainingAttendanceRepository;
import com.ioeti.training.db.repo.TrainingCohortRepository;
import com.ioeti.training.db.repo.TrainingEnrollmentRepository;
import com.ioeti.training.service.TrainingService;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * External training (Wave 4): courses, cohorts with capacity and waitlist, enrolment of existing
 * partners as trainees, sessions and attendance. Every record goes through native permissions and
 * record filters; unknown and unreadable ids answer the same 404.
 *
 * <p>Fail closed until policy D-03 is signed: certificates, refunds and cohort cancellation (which
 * implies refund and rescheduling rules). National IDs are not modelled at all.
 */
@Path("/ioeti/training")
@Produces(MediaType.APPLICATION_JSON)
public class TrainingRestController {

  static final Pattern CODE = Pattern.compile("[A-Z0-9][A-Z0-9-]{1,29}");
  static final int MAX_CAPACITY = 500;
  static final Map<String, Integer> ATTENDANCE = Map.of(
      "PRESENT", TrainingAttendanceRepository.STATUS_PRESENT,
      "ABSENT", TrainingAttendanceRepository.STATUS_ABSENT,
      "EXCUSED", TrainingAttendanceRepository.STATUS_EXCUSED);

  // --- courses -------------------------------------------------------------------------------------

  @GET
  @Path("/courses")
  @Operation(summary = "Training courses the caller may read", tags = {"IOETI training"})
  @IoetiEndpoint
  public Response courses() {
    new SecurityCheck().readAccess(TrainingCourse.class).check();
    List<CourseView> courses = readable(TrainingCourse.class, null).order("code").fetch(200).stream()
        .map(TrainingRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Courses", courses);
  }

  @POST
  @Path("/courses")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Create a training course", tags = {"IOETI training"})
  @IoetiEndpoint
  public Response createCourse(CreateCourse command) {
    if (command == null) throw ApiException.badRequest("Course details are required.");
    new SecurityCheck().createAccess(TrainingCourse.class).check();
    String code = checkedCode(command.code());
    if (Query.of(TrainingCourse.class).filter("self.code = ?", code).count() > 0) {
      throw ApiException.invalidField("code", "DUPLICATE", "Another course already uses this code.");
    }
    TrainingCourse course = new TrainingCourse();
    course.setCode(code);
    course.setName(checkedText("name", command.name(), 255, true));
    course.setNameAr(checkedText("nameAr", command.nameAr(), 255, false));
    if (command.durationHours() != null && (command.durationHours() < 1 || command.durationHours() > 2000)) {
      throw ApiException.invalidField("durationHours", "RANGE", "Duration must be between 1 and 2000 hours.");
    }
    course.setDurationHours(command.durationHours());
    course.setActive(true);
    course.setBusinessLine(Query.of(BusinessLine.class).filter("self.code = 'TRAINING'").fetchOne());
    TrainingCourse[] saved = new TrainingCourse[1];
    write(() -> saved[0] = Beans.get(TrainingService.class).create(course));
    return ResponseConstructor.build(Response.Status.CREATED, "Course created", view(saved[0]));
  }

  // --- cohorts -------------------------------------------------------------------------------------

  @GET
  @Path("/cohorts")
  @Operation(summary = "Cohorts the caller may read, optionally of one course", tags = {"IOETI training"})
  @IoetiEndpoint
  public Response cohorts(@QueryParam("courseId") Long courseId) {
    new SecurityCheck().readAccess(TrainingCohort.class).check();
    Filter ofCourse = null;
    if (courseId != null) {
      ofCourse = new JPQLFilter("self.course.id = " + RecordAccess.readable(TrainingCourse.class, courseId).getId());
    }
    List<CohortView> cohorts = readable(TrainingCohort.class, ofCourse).order("-startDate").order("-id")
        .fetch(100).stream().map(TrainingRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Cohorts", cohorts);
  }

  @GET
  @Path("/cohorts/{id}")
  @Operation(summary = "One cohort with its seat counts", tags = {"IOETI training"})
  @IoetiEndpoint
  public Response cohort(@PathParam("id") Long id) {
    return ResponseConstructor.build(Response.Status.OK, "Cohort", view(RecordAccess.readable(TrainingCohort.class, id)));
  }

  @POST
  @Path("/cohorts")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Plan a cohort of a course; the caller coordinates it", tags = {"IOETI training"})
  @IoetiEndpoint
  public Response createCohort(CreateCohort command) {
    if (command == null) throw ApiException.badRequest("Cohort details are required.");
    new SecurityCheck().createAccess(TrainingCohort.class).check();
    TrainingCourse course = command.courseId() == null || command.courseId() <= 0
        ? null : JPA.find(TrainingCourse.class, command.courseId());
    if (course == null || !Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, TrainingCourse.class, course.getId())
        || !Boolean.TRUE.equals(course.getActive())) {
      throw ApiException.invalidField("courseId", "UNAVAILABLE", "Choose an active course.");
    }
    String code = checkedCode(command.code());
    if (Query.of(TrainingCohort.class).filter("self.code = ?", code).count() > 0) {
      throw ApiException.invalidField("code", "DUPLICATE", "Another cohort already uses this code.");
    }
    if (command.capacity() == null || command.capacity() < 1 || command.capacity() > MAX_CAPACITY) {
      throw ApiException.invalidField("capacity", "RANGE", "Capacity must be between 1 and 500.");
    }
    if (command.minSeats() != null && (command.minSeats() < 0 || command.minSeats() > command.capacity())) {
      throw ApiException.invalidField("minSeats", "RANGE", "Minimum seats must be between 0 and the capacity.");
    }
    LocalDate start = checkedDate("startDate", command.startDate());
    LocalDate end = checkedDate("endDate", command.endDate());
    if (start != null && end != null && end.isBefore(start)) {
      throw ApiException.invalidField("endDate", "RANGE", "The end date cannot be before the start date.");
    }
    TrainingCohort cohort = new TrainingCohort();
    cohort.setCourse(course);
    cohort.setCode(code);
    cohort.setCapacity(command.capacity());
    cohort.setMinSeats(command.minSeats());
    cohort.setStartDate(start);
    cohort.setEndDate(end);
    cohort.setLocation(checkedText("location", command.location(), 255, false));
    cohort.setStatusSelect(TrainingCohortRepository.STATUS_PLANNED);
    cohort.setCoordinator(AuthUtils.getUser());
    TrainingCohort[] saved = new TrainingCohort[1];
    write(() -> saved[0] = Beans.get(TrainingService.class).create(cohort));
    return ResponseConstructor.build(Response.Status.CREATED, "Cohort planned", view(saved[0]));
  }

  @POST
  @Path("/cohorts/{id}/open")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Open a planned cohort for enrolment", tags = {"IOETI training"})
  @IoetiEndpoint
  public Response open(@PathParam("id") Long id, VersionOnly command) {
    TrainingCohort cohort = writable(TrainingCohort.class, id, command == null ? null : command.version());
    write(() -> Beans.get(TrainingService.class)
        .transition(cohort, TrainingCohortRepository.STATUS_PLANNED, TrainingCohortRepository.STATUS_OPEN));
    return ResponseConstructor.build(Response.Status.OK, "Cohort open", view(cohort));
  }

  @POST
  @Path("/cohorts/{id}/close")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Close enrolment of an open cohort", tags = {"IOETI training"})
  @IoetiEndpoint
  public Response close(@PathParam("id") Long id, VersionOnly command) {
    TrainingCohort cohort = writable(TrainingCohort.class, id, command == null ? null : command.version());
    write(() -> Beans.get(TrainingService.class)
        .transition(cohort, TrainingCohortRepository.STATUS_OPEN, TrainingCohortRepository.STATUS_CLOSED));
    return ResponseConstructor.build(Response.Status.OK, "Cohort closed", view(cohort));
  }

  @POST
  @Path("/cohorts/{id}/cancel")
  @Operation(summary = "Cancel a cohort: blocked until the cancellation and refund policy (D-03)", tags = {"IOETI training"})
  @IoetiEndpoint
  public Response cancelCohort(@PathParam("id") Long id) {
    RecordAccess.writable(TrainingCohort.class, id);
    throw ApiException.policyBlocked("D-03");
  }

  // --- enrolments ----------------------------------------------------------------------------------

  @GET
  @Path("/cohorts/{id}/enrollments")
  @Operation(summary = "Enrolments of a cohort: confirmed first, then the waitlist in order", tags = {"IOETI training"})
  @IoetiEndpoint
  public Response enrollments(@PathParam("id") Long id) {
    TrainingCohort cohort = RecordAccess.readable(TrainingCohort.class, id);
    new SecurityCheck().readAccess(TrainingEnrollment.class).check();
    Filter ofCohort = new JPQLFilter("self.cohort.id = " + cohort.getId());
    List<EnrollmentView> rows = readable(TrainingEnrollment.class, ofCohort)
        .order("statusSelect").order("waitlistPosition").order("id").fetch(MAX_CAPACITY * 2).stream()
        .map(TrainingRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Enrolments", rows);
  }

  @POST
  @Path("/cohorts/{id}/enrollments")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Enrol a trainee: confirmed while seats are left, otherwise waitlisted", tags = {"IOETI training"})
  @IoetiEndpoint
  public Response enroll(@PathParam("id") Long id, Enroll command) {
    TrainingCohort cohort = writable(TrainingCohort.class, id, command == null ? null : command.version());
    new SecurityCheck().createAccess(TrainingEnrollment.class).check();
    Partner trainee = readablePartner("traineeId", command.traineeId());
    Partner client = command.clientId() == null ? null : readablePartner("clientId", command.clientId());
    TrainingEnrollment[] saved = new TrainingEnrollment[1];
    write(() -> saved[0] = Beans.get(TrainingService.class).enroll(cohort, trainee, client));
    return ResponseConstructor.build(Response.Status.CREATED, "Enrolled", view(saved[0]));
  }

  @POST
  @Path("/enrollments/{id}/cancel")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Cancel an enrolment; the first waitlisted trainee takes a freed seat", tags = {"IOETI training"})
  @IoetiEndpoint
  public Response cancelEnrollment(@PathParam("id") Long id, VersionOnly command) {
    TrainingEnrollment enrollment = writable(TrainingEnrollment.class, id, command == null ? null : command.version());
    write(() -> Beans.get(TrainingService.class).cancel(enrollment));
    return ResponseConstructor.build(Response.Status.OK, "Enrolment cancelled", view(enrollment));
  }

  @POST
  @Path("/enrollments/{id}/certificate")
  @Operation(summary = "Issue a certificate: blocked until the training policy (D-03)", tags = {"IOETI training"})
  @IoetiEndpoint
  public Response certificate(@PathParam("id") Long id) {
    RecordAccess.writable(TrainingEnrollment.class, id);
    throw ApiException.policyBlocked("D-03");
  }

  // --- sessions and attendance ---------------------------------------------------------------------

  @GET
  @Path("/cohorts/{id}/sessions")
  @Operation(summary = "Sessions of a cohort, in time order", tags = {"IOETI training"})
  @IoetiEndpoint
  public Response sessions(@PathParam("id") Long id) {
    TrainingCohort cohort = RecordAccess.readable(TrainingCohort.class, id);
    new SecurityCheck().readAccess(CohortSession.class).check();
    List<SessionView> rows = readable(CohortSession.class, new JPQLFilter("self.cohort.id = " + cohort.getId()))
        .order("startsAt").fetch(500).stream().map(TrainingRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Sessions", rows);
  }

  @POST
  @Path("/cohorts/{id}/sessions")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Schedule a session of a cohort", tags = {"IOETI training"})
  @IoetiEndpoint
  public Response createSession(@PathParam("id") Long id, CreateSession command) {
    TrainingCohort cohort = writable(TrainingCohort.class, id, command == null ? null : command.version());
    new SecurityCheck().createAccess(CohortSession.class).check();
    LocalDateTime startsAt;
    try {
      startsAt = command.startsAt() == null ? null : LocalDateTime.parse(command.startsAt());
    } catch (DateTimeParseException e) {
      startsAt = null;
    }
    if (startsAt == null) {
      throw ApiException.invalidField("startsAt", "FORMAT", "Use a date and time like 2026-11-01T09:00.");
    }
    if (command.durationMinutes() != null && (command.durationMinutes() < 15 || command.durationMinutes() > 720)) {
      throw ApiException.invalidField("durationMinutes", "RANGE", "Duration must be between 15 and 720 minutes.");
    }
    CohortSession session = new CohortSession();
    session.setTitle(checkedText("title", command.title(), 255, true));
    session.setStartsAt(startsAt);
    session.setDurationMinutes(command.durationMinutes());
    CohortSession[] saved = new CohortSession[1];
    write(() -> saved[0] = Beans.get(TrainingService.class).schedule(cohort, session));
    return ResponseConstructor.build(Response.Status.CREATED, "Session scheduled", view(saved[0]));
  }

  @GET
  @Path("/sessions/{id}/attendance")
  @Operation(summary = "Attendance of a session", tags = {"IOETI training"})
  @IoetiEndpoint
  public Response attendance(@PathParam("id") Long id) {
    CohortSession session = RecordAccess.readable(CohortSession.class, id);
    new SecurityCheck().readAccess(TrainingAttendance.class).check();
    List<AttendanceView> rows = readable(TrainingAttendance.class, new JPQLFilter("self.session.id = " + session.getId()))
        .order("id").fetch(MAX_CAPACITY).stream().map(TrainingRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Attendance", rows);
  }

  @POST
  @Path("/sessions/{id}/attendance")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Record or correct a confirmed trainee's attendance", tags = {"IOETI training"})
  @IoetiEndpoint
  public Response recordAttendance(@PathParam("id") Long id, RecordAttendance command) {
    CohortSession session = writable(CohortSession.class, id, command == null ? null : command.version());
    new SecurityCheck().createAccess(TrainingAttendance.class).check();
    Integer status = command.status() == null ? null : ATTENDANCE.get(command.status());
    if (status == null) {
      throw ApiException.invalidField("status", "UNAVAILABLE", "Use PRESENT, ABSENT or EXCUSED.");
    }
    TrainingEnrollment enrollment = command.enrollmentId() == null || command.enrollmentId() <= 0
        ? null : JPA.find(TrainingEnrollment.class, command.enrollmentId());
    if (enrollment == null
        || !Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, TrainingEnrollment.class, enrollment.getId())) {
      throw ApiException.invalidField(
          "enrollmentId", "UNAVAILABLE", "Choose a confirmed trainee of this session's cohort.");
    }
    TrainingAttendance[] saved = new TrainingAttendance[1];
    write(() -> saved[0] = Beans.get(TrainingService.class).record(session, enrollment, status));
    return ResponseConstructor.build(Response.Status.OK, "Attendance recorded", view(saved[0]));
  }

  // --- helpers -------------------------------------------------------------------------------------

  private static <T extends Model> Query<T> readable(Class<T> type, Filter condition) {
    Filter security = Beans.get(JpaSecurity.class).getFilter(JpaSecurity.CAN_READ, type);
    Filter combined = security == null ? condition : condition == null ? security : Filter.and(security, condition);
    return combined == null ? Query.of(type) : combined.build(type);
  }

  private static <T extends AuditableModel> T writable(Class<T> type, Long id, Integer version) {
    if (version == null) throw ApiException.badRequest("Record version is required.");
    T record = RecordAccess.writable(type, id);
    ConflictChecker.checkVersion(record, version);
    return record;
  }

  /** Unknown and unreadable partners are refused identically (no oracle). */
  private static Partner readablePartner(String field, Long partnerId) {
    Partner partner = partnerId == null || partnerId <= 0 ? null : JPA.find(Partner.class, partnerId);
    if (partner == null || !Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, Partner.class, partnerId)) {
      throw ApiException.invalidField(field, "UNAVAILABLE", "Choose a person or organization you can see.");
    }
    return partner;
  }

  /** Commits now; a concurrent commit on the same rows answers 409. */
  private static void write(Runnable command) {
    OptimisticLockConflicts.translate(command::run);
  }

  static String checkedCode(String code) {
    String value = code == null ? "" : code.strip().toUpperCase();
    if (!CODE.matcher(value).matches()) {
      throw ApiException.invalidField("code", "FORMAT", "Use 2 to 30 letters, digits or dashes.");
    }
    return value;
  }

  static String checkedText(String field, String value, int max, boolean required) {
    String text = value == null ? null : value.strip();
    if (text == null || text.isEmpty()) {
      if (required) throw ApiException.invalidField(field, "REQUIRED", "This field is required.");
      return null;
    }
    if (text.length() > max) {
      throw ApiException.invalidField(field, "TOO_LONG", "This field can have at most " + max + " characters.");
    }
    return text;
  }

  static LocalDate checkedDate(String field, String value) {
    if (value == null || value.isBlank()) return null;
    try {
      return LocalDate.parse(value);
    } catch (DateTimeParseException e) {
      throw ApiException.invalidField(field, "FORMAT", "Use a date like 2026-11-01.");
    }
  }

  static String status(Integer select, String... names) {
    return select == null || select < 1 || select > names.length ? null : names[select - 1];
  }

  static CourseView view(TrainingCourse course) {
    return new CourseView(course.getId(), course.getVersion(), course.getCode(), course.getName(),
        course.getNameAr(), course.getDurationHours(), Boolean.TRUE.equals(course.getActive()));
  }

  static CohortView view(TrainingCohort cohort) {
    List<TrainingEnrollment> active = TrainingService.active(cohort);
    long confirmed = active.stream()
        .filter(e -> Integer.valueOf(TrainingEnrollmentRepository.STATUS_CONFIRMED).equals(e.getStatusSelect())).count();
    TrainingCourse course = cohort.getCourse();
    return new CohortView(cohort.getId(), cohort.getVersion(), cohort.getCode(),
        course == null ? null : course.getId(), course == null ? null : course.getName(),
        cohort.getStartDate(), cohort.getEndDate(), cohort.getCapacity(), cohort.getMinSeats(),
        cohort.getLocation(), status(cohort.getStatusSelect(), "PLANNED", "OPEN", "CLOSED"),
        confirmed, active.size() - confirmed, Math.max(0, cohort.getCapacity() - confirmed),
        cohort.getCoordinator() != null && cohort.getCoordinator().equals(AuthUtils.getUser()));
  }

  static EnrollmentView view(TrainingEnrollment enrollment) {
    JpaSecurity security = Beans.get(JpaSecurity.class);
    Partner trainee = enrollment.getTrainee();
    Partner client = enrollment.getClient();
    return new EnrollmentView(enrollment.getId(), enrollment.getVersion(),
        trainee.getId(),
        security.isPermitted(JpaSecurity.CAN_READ, Partner.class, trainee.getId()) ? trainee.getSimpleFullName() : null,
        client != null && security.isPermitted(JpaSecurity.CAN_READ, Partner.class, client.getId()) ? client.getName() : null,
        status(enrollment.getStatusSelect(), "CONFIRMED", "WAITLISTED", "CANCELLED"),
        enrollment.getWaitlistPosition());
  }

  static SessionView view(CohortSession session) {
    return new SessionView(session.getId(), session.getVersion(), session.getTitle(), session.getStartsAt(),
        session.getDurationMinutes());
  }

  static AttendanceView view(TrainingAttendance attendance) {
    return new AttendanceView(attendance.getId(), attendance.getEnrollment().getId(),
        status(attendance.getStatusSelect(), "PRESENT", "ABSENT", "EXCUSED"));
  }

  public record VersionOnly(Integer version) {}
  public record CreateCourse(String code, String name, String nameAr, Integer durationHours) {}
  public record CreateCohort(
      Long courseId, String code, String startDate, String endDate, Integer capacity, Integer minSeats,
      String location) {}
  public record Enroll(Integer version, Long traineeId, Long clientId) {}
  public record CreateSession(Integer version, String title, String startsAt, Integer durationMinutes) {}
  public record RecordAttendance(Integer version, Long enrollmentId, String status) {}
  public record CourseView(
      Long id, Integer version, String code, String name, String nameAr, Integer durationHours, boolean active) {}
  public record CohortView(
      Long id, Integer version, String code, Long courseId, String courseName, LocalDate startDate,
      LocalDate endDate, Integer capacity, Integer minSeats, String location, String status, long confirmed,
      long waitlisted, long seatsLeft, boolean coordinatedByMe) {}
  public record EnrollmentView(
      Long id, Integer version, Long traineeId, String traineeName, String clientName, String status,
      Integer waitlistPosition) {}
  public record SessionView(Long id, Integer version, String title, LocalDateTime startsAt, Integer durationMinutes) {}
  public record AttendanceView(Long id, Long enrollmentId, String status) {}
}
