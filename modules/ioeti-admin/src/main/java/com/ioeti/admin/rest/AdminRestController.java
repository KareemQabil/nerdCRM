package com.ioeti.admin.rest;

import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.Group;
import com.axelor.auth.db.Permission;
import com.axelor.auth.db.User;
import com.axelor.db.JPA;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.axelor.team.db.Team;
import com.axelor.utils.api.ConflictChecker;
import com.axelor.utils.api.ResponseConstructor;
import com.ioeti.admin.db.AdminAuditEvent;
import com.ioeti.admin.service.AdminService;
import com.ioeti.admin.service.AdminService.LineChange;
import com.ioeti.admin.service.AdminService.NewUser;
import com.ioeti.admin.service.AdminService.UserChange;
import com.ioeti.businessline.db.BusinessLine;
import com.ioeti.businessline.db.repo.BusinessLineRepository;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.IoetiEndpoint;
import com.ioeti.core.text.ArabicNormalizer;
import com.ioeti.core.web.OptimisticLockConflicts;
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
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Set;

/**
 * Administration from the platform (journeys plan, phase 1): people, access profiles, teams, business
 * lines and the audit trail of every change. Administrators only, checked here on every call; nothing
 * relies on the screen hiding a button.
 *
 * <p>E-mail addresses are written but never returned ({@code contactOnFile} only). Passwords are set by the
 * administrator as temporary passwords the person must change at the next sign-in; they are never
 * returned or stored in the audit trail. Defining roles and their matrix is policy D-07: profiles are
 * listed and assigned here, not authored.
 */
@Path("/ioeti/admin")
@Produces(MediaType.APPLICATION_JSON)
public class AdminRestController {

  // --- people --------------------------------------------------------------------------------------

  @GET
  @Path("/users")
  @Operation(summary = "People who can sign in, with their profile, business lines and teams (administrators)", tags = {"IOETI admin"})
  @IoetiEndpoint
  public Response users(@QueryParam("q") String q, @QueryParam("status") String status, @QueryParam("businessLine") String line) {
    admin();
    List<String> where = new ArrayList<>(List.of("(self.archived IS NULL OR self.archived = false)"));
    List<Object> params = new ArrayList<>();
    if ("active".equals(status)) where.add("(self.blocked IS NULL OR self.blocked = false)");
    if ("inactive".equals(status)) where.add("self.blocked = true");
    if (line != null && !line.isBlank()) {
      where.add("self.id IN (SELECT u.id FROM User u JOIN u.ioetiBusinessLines bl WHERE bl.code = ?" + (params.size() + 1) + ")");
      params.add(line.strip());
    }
    String search = ArabicNormalizer.normalize(AdminService.text("q", q, 100, false));
    List<UserView> rows = Query.of(User.class).filter(String.join(" AND ", where), params.toArray()).order("name").fetch(500).stream()
        .filter(u -> search.isEmpty() || ArabicNormalizer.normalize(u.getName() + " " + u.getCode()).contains(search))
        .map(AdminRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "People", rows);
  }

  @GET
  @Path("/users/{id}")
  @Operation(summary = "One person, with what their profile allows (administrators)", tags = {"IOETI admin"})
  @IoetiEndpoint
  public Response user(@PathParam("id") Long id) {
    admin();
    User user = existing(id);
    return ResponseConstructor.build(Response.Status.OK, "Person", new UserDetailView(view(user), access(user.getGroup())));
  }

  @POST
  @Path("/users")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Add a person with a temporary password they must change at the first sign-in (administrators)", tags = {"IOETI admin"})
  @IoetiEndpoint
  public Response createUser(CreateUser command) {
    admin();
    if (command == null) throw ApiException.badRequest("Person details are required.");
    NewUser input = new NewUser(AdminService.login(command.code()), AdminService.text("name", command.name(), 255, true),
        AdminService.email(command.email()), AdminService.language(command.language()), command.temporaryPassword(),
        AdminService.profile(command.profileCode()), AdminService.lines(command.businessLines()), AdminService.teams(command.teamIds()));
    User[] saved = new User[1];
    OptimisticLockConflicts.translate(() -> saved[0] = Beans.get(AdminService.class).createUser(input));
    return ResponseConstructor.build(Response.Status.CREATED, "Person added", view(JPA.find(User.class, saved[0].getId())));
  }

  @POST
  @Path("/users/{id}")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Change a person's name, e-mail, language, profile, business lines or teams (administrators)", tags = {"IOETI admin"})
  @IoetiEndpoint
  public Response updateUser(@PathParam("id") Long id, UpdateUser command) {
    admin();
    if (command == null) throw ApiException.badRequest("Changes are required.");
    User user = versioned(id, command.version());
    boolean clearEmail = command.email() != null && command.email().isBlank();
    UserChange change = new UserChange(AdminService.text("name", command.name(), 255, false),
        clearEmail ? null : AdminService.email(command.email()), clearEmail,
        command.language() == null ? null : AdminService.language(command.language()),
        command.profileCode() == null ? null : AdminService.profile(command.profileCode()), command.profileCode() != null,
        command.businessLines() == null ? null : AdminService.lines(command.businessLines()),
        command.teamIds() == null ? null : AdminService.teams(command.teamIds()));
    OptimisticLockConflicts.translate(() -> Beans.get(AdminService.class).updateUser(user, change));
    return ResponseConstructor.build(Response.Status.OK, "Person saved", view(JPA.find(User.class, id)));
  }

  @POST
  @Path("/users/{id}/deactivate")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Stop a person from signing in; their records stay (administrators)", tags = {"IOETI admin"})
  @IoetiEndpoint
  public Response deactivate(@PathParam("id") Long id, VersionCommand command) {
    admin();
    User user = versioned(id, command == null ? null : command.version());
    OptimisticLockConflicts.translate(() -> Beans.get(AdminService.class).setActive(user, false));
    return ResponseConstructor.build(Response.Status.OK, "Person deactivated", view(JPA.find(User.class, id)));
  }

  @POST
  @Path("/users/{id}/activate")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Let a deactivated person sign in again (administrators)", tags = {"IOETI admin"})
  @IoetiEndpoint
  public Response activate(@PathParam("id") Long id, VersionCommand command) {
    admin();
    User user = versioned(id, command == null ? null : command.version());
    OptimisticLockConflicts.translate(() -> Beans.get(AdminService.class).setActive(user, true));
    return ResponseConstructor.build(Response.Status.OK, "Person activated", view(JPA.find(User.class, id)));
  }

  @POST
  @Path("/users/{id}/password")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Set a temporary password the person must change at the next sign-in (administrators)", tags = {"IOETI admin"})
  @IoetiEndpoint
  public Response password(@PathParam("id") Long id, SetPassword command) {
    admin();
    if (command == null) throw ApiException.badRequest("A temporary password is required.");
    User user = versioned(id, command.version());
    OptimisticLockConflicts.translate(() -> Beans.get(AdminService.class).resetPassword(user, command.temporaryPassword()));
    return ResponseConstructor.build(Response.Status.OK, "Temporary password set", view(JPA.find(User.class, id)));
  }

  // --- access profiles (D-07: listed and assigned, not authored) -------------------------------------

  @GET
  @Path("/profiles")
  @Operation(summary = "Access profiles (native groups) with how many people use each (administrators)", tags = {"IOETI admin"})
  @IoetiEndpoint
  public Response profiles() {
    admin();
    List<ProfileView> rows = Query.of(Group.class).order("name").fetch(200).stream().map(g -> new ProfileView(g.getId(), g.getCode(), g.getName(),
        AdminService.isAdminProfile(g), Query.of(User.class).filter("self.group = ?1", g).count(),
        g.getPermissions() == null ? 0 : g.getPermissions().size())).toList();
    return ResponseConstructor.build(Response.Status.OK, "Profiles", rows);
  }

  @GET
  @Path("/profiles/{code}")
  @Operation(summary = "What one access profile allows, per record type (administrators)", tags = {"IOETI admin"})
  @IoetiEndpoint
  public Response profile(@PathParam("code") String code) {
    admin();
    Group group = Query.of(Group.class).filter("self.code = ?1", code).fetchOne();
    if (group == null) throw ApiException.notFound();
    return ResponseConstructor.build(Response.Status.OK, "Profile", access(group));
  }

  // --- teams ---------------------------------------------------------------------------------------

  @GET
  @Path("/teams")
  @Operation(summary = "Teams and their members (administrators)", tags = {"IOETI admin"})
  @IoetiEndpoint
  public Response teams() {
    admin();
    List<TeamView> rows = Query.of(Team.class).order("name").fetch(300).stream().map(AdminRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Teams", rows);
  }

  @POST
  @Path("/teams")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Add a team (administrators)", tags = {"IOETI admin"})
  @IoetiEndpoint
  public Response createTeam(EditTeam command) {
    admin();
    if (command == null) throw ApiException.badRequest("Team details are required.");
    String name = AdminService.text("name", command.name(), 255, true);
    if (Query.of(Team.class).filter("LOWER(self.name) = ?1", name.toLowerCase()).count() > 0) {
      throw ApiException.invalidField("name", "DUPLICATE", "A team with this name exists.");
    }
    Set<User> members = AdminService.users(command.memberIds(), "memberIds");
    Team[] saved = new Team[1];
    OptimisticLockConflicts.translate(() -> saved[0] = Beans.get(AdminService.class)
        .saveTeam(new Team(), name, AdminService.text("code", command.code(), 60, false), members, true));
    return ResponseConstructor.build(Response.Status.CREATED, "Team added", view(JPA.find(Team.class, saved[0].getId())));
  }

  @POST
  @Path("/teams/{id}")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Rename a team or set its members (administrators)", tags = {"IOETI admin"})
  @IoetiEndpoint
  public Response updateTeam(@PathParam("id") Long id, EditTeam command) {
    admin();
    if (command == null || command.version() == null) throw ApiException.badRequest("Record version is required.");
    Team team = JPA.find(Team.class, id);
    if (team == null) throw ApiException.notFound();
    ConflictChecker.checkVersion(team, command.version());
    Set<User> members = command.memberIds() == null ? null : AdminService.users(command.memberIds(), "memberIds");
    OptimisticLockConflicts.translate(() -> Beans.get(AdminService.class)
        .saveTeam(team, AdminService.text("name", command.name(), 255, false), AdminService.text("code", command.code(), 60, false), members, false));
    return ResponseConstructor.build(Response.Status.OK, "Team saved", view(JPA.find(Team.class, id)));
  }

  // --- business lines ------------------------------------------------------------------------------

  @GET
  @Path("/business-lines")
  @Operation(summary = "Every business line in any status, with its team, manager and member count (administrators)", tags = {"IOETI admin"})
  @IoetiEndpoint
  public Response lines() {
    admin();
    List<LineView> rows = Query.of(BusinessLine.class).order("sequence").order("code").fetch(200).stream().map(AdminRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Business lines", rows);
  }

  @POST
  @Path("/business-lines")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Add a business line; it starts in set-up (administrators)", tags = {"IOETI admin"})
  @IoetiEndpoint
  public Response createLine(EditLine command) {
    admin();
    if (command == null) throw ApiException.badRequest("Business line details are required.");
    String code = AdminService.lineCode(command.code());
    LineChange change = lineChange(command, true);
    BusinessLine[] saved = new BusinessLine[1];
    OptimisticLockConflicts.translate(() -> saved[0] = Beans.get(AdminService.class).createLine(code, change));
    return ResponseConstructor.build(Response.Status.CREATED, "Business line added", view(JPA.find(BusinessLine.class, saved[0].getId())));
  }

  @POST
  @Path("/business-lines/{code}")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Change a business line: names, status, order, team or manager (administrators)", tags = {"IOETI admin"})
  @IoetiEndpoint
  public Response updateLine(@PathParam("code") String code, EditLine command) {
    admin();
    if (command == null || command.version() == null) throw ApiException.badRequest("Record version is required.");
    BusinessLine line = line(code);
    ConflictChecker.checkVersion(line, command.version());
    LineChange change = lineChange(command, false);
    OptimisticLockConflicts.translate(() -> Beans.get(AdminService.class).updateLine(line, change));
    return ResponseConstructor.build(Response.Status.OK, "Business line saved", view(JPA.find(BusinessLine.class, line.getId())));
  }

  @GET
  @Path("/business-lines/{code}/members")
  @Operation(summary = "People who belong to a business line (administrators)", tags = {"IOETI admin"})
  @IoetiEndpoint
  public Response members(@PathParam("code") String code) {
    admin();
    BusinessLine line = line(code);
    List<PersonRef> rows = Query.of(User.class).filter("?1 MEMBER OF self.ioetiBusinessLines", line).order("name").fetch(500)
        .stream().map(AdminRestController::ref).toList();
    return ResponseConstructor.build(Response.Status.OK, "Members", rows);
  }

  @POST
  @Path("/business-lines/{code}/members")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Set exactly who belongs to a business line (administrators)", tags = {"IOETI admin"})
  @IoetiEndpoint
  public Response setMembers(@PathParam("code") String code, SetMembers command) {
    admin();
    if (command == null || command.userIds() == null) throw ApiException.badRequest("The member list is required.");
    BusinessLine line = line(code);
    Set<User> members = AdminService.users(command.userIds(), "userIds");
    OptimisticLockConflicts.translate(() -> Beans.get(AdminService.class).setMembers(line, members));
    return members(code);
  }

  // --- audit trail ---------------------------------------------------------------------------------

  @GET
  @Path("/audit")
  @Operation(summary = "Administrative changes, newest first (administrators)", tags = {"IOETI admin"})
  @IoetiEndpoint
  public Response audit(@QueryParam("subject") String subject, @QueryParam("subjectId") Long subjectId,
      @QueryParam("limit") Integer limit, @QueryParam("offset") Integer offset) {
    admin();
    List<String> where = new ArrayList<>(List.of("1 = 1"));
    List<Object> params = new ArrayList<>();
    if (subject != null && !subject.isBlank()) { where.add("self.subject = ?" + (params.size() + 1)); params.add(subject.strip()); }
    if (subjectId != null) { where.add("self.subjectId = ?" + (params.size() + 1)); params.add(subjectId); }
    int size = limit == null ? 50 : Math.max(1, Math.min(limit, 200));
    int skip = offset == null ? 0 : Math.max(0, offset);
    List<AdminChangeView> rows = Query.of(AdminAuditEvent.class).filter(String.join(" AND ", where), params.toArray())
        .order("-createdAt").order("-id").fetch(size, skip).stream()
        .map(e -> new AdminChangeView(e.getId(), e.getAction(), e.getSubject(), e.getSubjectId(), e.getSubjectLabel(),
            e.getChanges(), e.getActor() == null ? null : e.getActor().getName(), e.getCreatedAt())).toList();
    return ResponseConstructor.build(Response.Status.OK, "Audit trail", rows);
  }

  // --- helpers -------------------------------------------------------------------------------------

  private static void admin() {
    User me = AuthUtils.getUser();
    if (me == null || !AuthUtils.isAdmin(me)) throw ApiException.forbidden();
  }

  private static User existing(Long id) {
    User user = id == null ? null : JPA.find(User.class, id);
    if (user == null || Boolean.TRUE.equals(user.getArchived())) throw ApiException.notFound();
    return user;
  }

  private static User versioned(Long id, Integer version) {
    if (version == null) throw ApiException.badRequest("Record version is required.");
    User user = existing(id);
    ConflictChecker.checkVersion(user, version);
    return user;
  }

  private static BusinessLine line(String code) {
    BusinessLine line = code == null ? null : Query.of(BusinessLine.class).filter("self.code = ?1", code.strip()).fetchOne();
    if (line == null) throw ApiException.notFound();
    return line;
  }

  private static LineChange lineChange(EditLine command, boolean create) {
    Integer status = command.status();
    if (status != null && (status < BusinessLineRepository.STATUS_IN_SETUP || status > BusinessLineRepository.STATUS_SUSPENDED)) {
      throw ApiException.invalidField("status", "UNAVAILABLE", "Use 1 (set-up), 2 (active) or 3 (suspended).");
    }
    Team team = command.responsibleTeamId() == null || command.responsibleTeamId() <= 0 ? null : JPA.find(Team.class, command.responsibleTeamId());
    if (command.responsibleTeamId() != null && command.responsibleTeamId() > 0 && team == null) {
      throw ApiException.invalidField("responsibleTeamId", "UNKNOWN", "This team does not exist.");
    }
    User manager = command.managerId() == null || command.managerId() <= 0 ? null : JPA.find(User.class, command.managerId());
    if (command.managerId() != null && command.managerId() > 0 && manager == null) {
      throw ApiException.invalidField("managerId", "UNKNOWN", "This person does not exist.");
    }
    return new LineChange(AdminService.text("nameEn", command.nameEn(), 255, create), AdminService.text("nameAr", command.nameAr(), 255, create),
        status, command.sequence(), AdminService.text("purpose", command.purpose(), 4000, false), command.purpose() != null,
        team, command.responsibleTeamId() != null, manager, command.managerId() != null);
  }

  static UserView view(User u) {
    List<String> lines = u.getIoetiBusinessLines() == null ? List.of()
        : u.getIoetiBusinessLines().stream().map(BusinessLine::getCode).sorted().toList();
    List<TeamRef> teams = u.getTeamSet() == null ? List.of()
        : u.getTeamSet().stream().sorted(Comparator.comparing(Team::getName, Comparator.nullsLast(String::compareTo)))
            .map(t -> new TeamRef(t.getId(), t.getName())).toList();
    Group g = u.getGroup();
    return new UserView(u.getId(), u.getVersion(), u.getCode(), u.getName(), u.getEmail() != null && !u.getEmail().isBlank(),
        u.getLanguage(), AuthUtils.isActive(u), Boolean.TRUE.equals(u.getForcePasswordChange()),
        g == null ? null : g.getCode(), g == null ? null : g.getName(), AdminService.isAdminProfile(g), lines, teams, u.getCreatedOn());
  }

  static TeamView view(Team t) {
    List<PersonRef> members = t.getMembers() == null ? List.of()
        : t.getMembers().stream().sorted(Comparator.comparing(User::getName, Comparator.nullsLast(String::compareTo))).map(AdminRestController::ref).toList();
    return new TeamView(t.getId(), t.getVersion(), t.getCode(), t.getName(), members);
  }

  static LineView view(BusinessLine l) {
    long members = Query.of(User.class).filter("?1 MEMBER OF self.ioetiBusinessLines", l).count();
    return new LineView(l.getId(), l.getVersion(), l.getCode(), l.getNameEn(), l.getNameAr(), l.getStatusSelect(), l.getSequence(),
        l.getDescription(), l.getResponsibleTeam() == null ? null : new TeamRef(l.getResponsibleTeam().getId(), l.getResponsibleTeam().getName()),
        l.getManager() == null ? null : ref(l.getManager()), members);
  }

  static PersonRef ref(User u) {
    return new PersonRef(u.getId(), u.getCode(), u.getName(), AuthUtils.isActive(u));
  }

  static ProfileAccess access(Group group) {
    if (group == null) return new ProfileAccess(null, null, false, List.of());
    List<RightView> rights = new ArrayList<>();
    if (group.getPermissions() != null) {
      for (Permission p : group.getPermissions()) {
        rights.add(new RightView(p.getObject(), Boolean.TRUE.equals(p.getCanRead()), Boolean.TRUE.equals(p.getCanWrite()),
            Boolean.TRUE.equals(p.getCanCreate()), Boolean.TRUE.equals(p.getCanRemove()), p.getCondition() != null && !p.getCondition().isBlank()));
      }
    }
    rights.sort(Comparator.comparing(RightView::object, Comparator.nullsLast(String::compareTo)));
    return new ProfileAccess(group.getCode(), group.getName(), AdminService.isAdminProfile(group), rights);
  }

  // --- requests and responses ------------------------------------------------------------------------

  public record CreateUser(String code, String name, String email, String language, String temporaryPassword,
      String profileCode, List<String> businessLines, List<Long> teamIds) {}

  public record UpdateUser(Integer version, String name, String email, String language, String profileCode,
      List<String> businessLines, List<Long> teamIds) {}

  public record VersionCommand(Integer version) {}

  public record SetPassword(Integer version, String temporaryPassword) {}

  public record EditTeam(Integer version, String name, String code, List<Long> memberIds) {}

  public record EditLine(Integer version, String code, String nameEn, String nameAr, Integer status, Integer sequence,
      String purpose, Long responsibleTeamId, Long managerId) {}

  public record SetMembers(List<Long> userIds) {}

  public record TeamRef(Long id, String name) {}

  public record PersonRef(Long id, String code, String name, boolean active) {}

  public record UserView(Long id, Integer version, String code, String name, boolean contactOnFile, String language, boolean active,
      boolean mustChangePassword, String profileCode, String profileName, boolean administrator, List<String> businessLines,
      List<TeamRef> teams, LocalDateTime createdOn) {}

  public record UserDetailView(UserView user, ProfileAccess access) {}

  public record ProfileView(Long id, String code, String name, boolean administrator, long people, int rules) {}

  public record RightView(String object, boolean read, boolean write, boolean create, boolean remove, boolean conditional) {}

  public record ProfileAccess(String code, String name, boolean administrator, List<RightView> rights) {}

  public record TeamView(Long id, Integer version, String code, String name, List<PersonRef> members) {}

  public record LineView(Long id, Integer version, String code, String nameEn, String nameAr, Integer status, Integer sequence,
      String purpose, TeamRef responsibleTeam, PersonRef manager, long members) {}

  public record AdminChangeView(Long id, String action, String subject, Long subjectId, String subjectLabel, String changes,
      String actorName, LocalDateTime createdAt) {}
}
