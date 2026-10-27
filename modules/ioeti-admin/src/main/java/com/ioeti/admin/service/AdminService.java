package com.ioeti.admin.service;

import com.axelor.auth.AuthService;
import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.Group;
import com.axelor.auth.db.User;
import com.axelor.db.JPA;
import com.axelor.db.Query;
import com.axelor.team.db.Team;
import com.google.inject.persist.Transactional;
import com.ioeti.admin.db.AdminAuditEvent;
import com.ioeti.businessline.db.BusinessLine;
import com.ioeti.businessline.db.repo.BusinessLineRepository;
import com.ioeti.core.api.ApiException;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Administration rules (journeys plan, phase 1).
 *
 * <ul>
 *   <li>Only administrators reach this service (checked by the REST layer before any read or write).
 *   <li>Every change is written to {@link AdminAuditEvent} in the same transaction; e-mail and password
 *       values are never stored there, only the fact that they changed.
 *   <li>An administrator cannot deactivate themselves or remove their own administrator profile, so the
 *       platform always keeps someone who can administer it.
 *   <li>A password set by an administrator is temporary: the person must change it at the next sign-in
 *       (native {@code forcePasswordChange}). It is hashed with the native {@link AuthService}.
 * </ul>
 */
public class AdminService {

  public static final String ADMIN_GROUP = "admins";
  public static final int MIN_PASSWORD = 12;
  static final Pattern LOGIN = Pattern.compile("[a-z0-9][a-z0-9._-]{2,59}");
  static final Pattern EMAIL = Pattern.compile("[^@\\s]+@[^@\\s]+\\.[^@\\s]+");
  static final Pattern LINE_CODE = Pattern.compile("[A-Z0-9_]{2,20}");
  public static final List<String> LANGUAGES = List.of("ar", "en", "fr");

  // --- validation helpers (pure, unit-tested) --------------------------------------------------------

  public static String login(String value) {
    String login = text("code", value, 60, true).toLowerCase(Locale.ROOT);
    if (!LOGIN.matcher(login).matches()) {
      throw ApiException.invalidField("code", "FORMAT", "Use 3 to 60 lower-case letters, digits, dot, dash or underscore.");
    }
    return login;
  }

  public static String email(String value) {
    String email = text("email", value, 200, false);
    if (email != null && !EMAIL.matcher(email).matches()) {
      throw ApiException.invalidField("email", "FORMAT", "Enter a valid e-mail address.");
    }
    return email;
  }

  public static String language(String value) {
    String language = text("language", value, 5, false);
    if (language == null) return "ar";
    if (!LANGUAGES.contains(language)) throw ApiException.invalidField("language", "UNAVAILABLE", "Use ar, en or fr.");
    return language;
  }

  public static String lineCode(String value) {
    String code = text("code", value, 20, true).toUpperCase(Locale.ROOT);
    if (!LINE_CODE.matcher(code).matches()) {
      throw ApiException.invalidField("code", "FORMAT", "Use 2 to 20 capital letters, digits or underscore.");
    }
    return code;
  }

  /** Length and variety only; the native password policies are applied too when the password is set. */
  public static void checkPassword(String password) {
    if (password == null || password.length() < MIN_PASSWORD) {
      throw ApiException.invalidField("temporaryPassword", "TOO_SHORT", "Use at least " + MIN_PASSWORD + " characters.");
    }
    if (password.length() > 128) throw ApiException.invalidField("temporaryPassword", "TOO_LONG", "Use at most 128 characters.");
    boolean lower = password.chars().anyMatch(Character::isLowerCase);
    boolean upper = password.chars().anyMatch(Character::isUpperCase);
    boolean digit = password.chars().anyMatch(Character::isDigit);
    if (!(lower && upper && digit)) {
      throw ApiException.invalidField("temporaryPassword", "WEAK", "Mix lower-case and capital letters and digits.");
    }
  }

  public static String text(String field, String value, int max, boolean required) {
    String text = value == null ? null : value.strip();
    if (text == null || text.isEmpty()) {
      if (required) throw ApiException.invalidField(field, "REQUIRED", "This field is required.");
      return null;
    }
    if (text.length() > max) throw ApiException.invalidField(field, "TOO_LONG", "This field can have at most " + max + " characters.");
    return text;
  }

  // --- lookups -----------------------------------------------------------------------------------------

  public static Group profile(String code) {
    if (code == null || code.isBlank()) return null;
    Group group = Query.of(Group.class).filter("self.code = ?1", code.strip()).fetchOne();
    if (group == null) throw ApiException.invalidField("profileCode", "UNKNOWN", "This access profile does not exist.");
    return group;
  }

  public static Set<BusinessLine> lines(Collection<String> codes) {
    Set<BusinessLine> lines = new LinkedHashSet<>();
    if (codes == null) return lines;
    for (String code : codes) {
      BusinessLine line = code == null ? null : Query.of(BusinessLine.class).filter("self.code = ?1", code.strip()).fetchOne();
      if (line == null) throw ApiException.invalidField("businessLines", "UNKNOWN", "A business line in the list does not exist.");
      lines.add(line);
    }
    return lines;
  }

  public static Set<Team> teams(Collection<Long> ids) {
    Set<Team> teams = new LinkedHashSet<>();
    if (ids == null) return teams;
    for (Long id : ids) {
      Team team = id == null ? null : JPA.find(Team.class, id);
      if (team == null) throw ApiException.invalidField("teamIds", "UNKNOWN", "A team in the list does not exist.");
      teams.add(team);
    }
    return teams;
  }

  public static Set<User> users(Collection<Long> ids, String field) {
    Set<User> users = new LinkedHashSet<>();
    if (ids == null) return users;
    for (Long id : ids) {
      User user = id == null ? null : JPA.find(User.class, id);
      if (user == null) throw ApiException.invalidField(field, "UNKNOWN", "A person in the list does not exist.");
      users.add(user);
    }
    return users;
  }

  public static boolean isAdminProfile(Group group) {
    return group != null && ADMIN_GROUP.equals(group.getCode());
  }

  // --- people --------------------------------------------------------------------------------------

  public record NewUser(String code, String name, String email, String language, String password, Group profile,
      Set<BusinessLine> lines, Set<Team> teams) {}

  public record UserChange(String name, String email, boolean clearEmail, String language, Group profile,
      boolean profileGiven, Set<BusinessLine> lines, Set<Team> teams) {}

  @Transactional(rollbackOn = {Exception.class})
  public User createUser(NewUser input) {
    if (Query.of(User.class).filter("LOWER(self.code) = ?1", input.code()).count() > 0) {
      throw ApiException.invalidField("code", "DUPLICATE", "This sign-in name is already used.");
    }
    User user = new User();
    user.setCode(input.code());
    user.setName(input.name());
    user.setEmail(input.email());
    user.setLanguage(input.language());
    user.setBlocked(false);
    user.setGroup(input.profile());
    user.setIoetiBusinessLines(new HashSet<>(input.lines()));
    user.setTeamSet(new HashSet<>(input.teams()));
    user.setActiveTeam(input.teams().isEmpty() ? null : input.teams().iterator().next());
    setTemporaryPassword(user, input.password());
    User saved = JPA.save(user);
    List<String> changes = new ArrayList<>(List.of("created", "language=" + input.language()));
    if (input.email() != null) changes.add("email set");
    if (input.profile() != null) changes.add("profile=" + input.profile().getCode());
    if (!input.lines().isEmpty()) changes.add("businessLines=" + codes(input.lines()));
    if (!input.teams().isEmpty()) changes.add("teams=" + teamNames(input.teams()));
    changes.add("temporary password set");
    audit("USER_CREATED", "USER", saved.getId(), saved.getCode(), changes);
    return saved;
  }

  @Transactional(rollbackOn = {Exception.class})
  public User updateUser(User user, UserChange input) {
    List<String> changes = new ArrayList<>();
    if (input.name() != null && !input.name().equals(user.getName())) {
      user.setName(input.name());
      changes.add("name");
    }
    if (input.clearEmail() && user.getEmail() != null) {
      user.setEmail(null);
      changes.add("email removed");
    } else if (input.email() != null && !input.email().equalsIgnoreCase(Objects.toString(user.getEmail(), ""))) {
      user.setEmail(input.email());
      changes.add("email changed");
    }
    if (input.language() != null && !input.language().equals(user.getLanguage())) {
      changes.add("language=" + user.getLanguage() + "→" + input.language());
      user.setLanguage(input.language());
    }
    if (input.profileGiven() && !Objects.equals(code(user.getGroup()), code(input.profile()))) {
      if (isSelf(user) && isAdminProfile(user.getGroup()) && !isAdminProfile(input.profile())) {
        throw new ApiException(422, "SELF_LOCKOUT", "You cannot remove your own administrator profile.", null);
      }
      changes.add("profile=" + code(user.getGroup()) + "→" + code(input.profile()));
      user.setGroup(input.profile());
    }
    if (input.lines() != null) {
      Set<BusinessLine> current = user.getIoetiBusinessLines() == null ? Set.of() : user.getIoetiBusinessLines();
      if (!codes(current).equals(codes(input.lines()))) {
        changes.add("businessLines=" + codes(current) + "→" + codes(input.lines()));
        user.setIoetiBusinessLines(new HashSet<>(input.lines()));
      }
    }
    if (input.teams() != null) {
      Set<Team> current = user.getTeamSet() == null ? Set.of() : user.getTeamSet();
      if (!teamNames(current).equals(teamNames(input.teams()))) {
        changes.add("teams=" + teamNames(current) + "→" + teamNames(input.teams()));
        user.setTeamSet(new HashSet<>(input.teams()));
        if (user.getActiveTeam() == null || !input.teams().contains(user.getActiveTeam())) {
          user.setActiveTeam(input.teams().isEmpty() ? null : input.teams().iterator().next());
        }
      }
    }
    if (changes.isEmpty()) return user;
    User saved = JPA.save(user);
    audit("USER_UPDATED", "USER", saved.getId(), saved.getCode(), changes);
    return saved;
  }

  @Transactional(rollbackOn = {Exception.class})
  public User setActive(User user, boolean active) {
    if (!active && isSelf(user)) {
      throw new ApiException(422, "SELF_LOCKOUT", "You cannot deactivate your own account.", null);
    }
    boolean current = !Boolean.TRUE.equals(user.getBlocked());
    if (current == active) return user;
    user.setBlocked(!active);
    if (active && user.getExpiresOn() != null && user.getExpiresOn().isBefore(LocalDateTime.now())) {
      user.setExpiresOn(null);
    }
    User saved = JPA.save(user);
    audit(active ? "USER_ACTIVATED" : "USER_DEACTIVATED", "USER", saved.getId(), saved.getCode(), List.of(active ? "active" : "inactive"));
    return saved;
  }

  @Transactional(rollbackOn = {Exception.class})
  public User resetPassword(User user, String password) {
    if (isSelf(user)) {
      throw new ApiException(422, "SELF_PASSWORD", "Change your own password from your settings.", null);
    }
    setTemporaryPassword(user, password);
    User saved = JPA.save(user);
    audit("USER_PASSWORD_RESET", "USER", saved.getId(), saved.getCode(), List.of("temporary password set", "change required at next sign-in"));
    return saved;
  }

  private static void setTemporaryPassword(User user, String password) {
    checkPassword(password);
    AuthService auth = AuthService.getInstance();
    var invalid = auth.validatePasswordPolicies(user, password);
    if (invalid != null) {
      throw ApiException.invalidField("temporaryPassword", "POLICY", "This password does not meet the password rules.");
    }
    user.setPassword(auth.encrypt(password));
    user.setPasswordUpdatedOn(LocalDateTime.now());
    user.setForcePasswordChange(true);
  }

  // --- teams ---------------------------------------------------------------------------------------

  @Transactional(rollbackOn = {Exception.class})
  public Team saveTeam(Team team, String name, String code, Set<User> members, boolean created) {
    List<String> changes = new ArrayList<>();
    if (created) changes.add("created");
    if (name != null && !name.equals(team.getName())) {
      if (!created) changes.add("name");
      team.setName(name);
    }
    if (code != null && !code.equals(team.getCode())) {
      changes.add("code=" + code);
      team.setCode(code);
    }
    if (members != null) {
      Set<User> current = team.getMembers() == null ? Set.of() : team.getMembers();
      if (!logins(current).equals(logins(members))) {
        changes.add("members=" + logins(current) + "→" + logins(members));
        team.setMembers(new HashSet<>(members));
      }
    }
    if (changes.isEmpty()) return team;
    Team saved = JPA.save(team);
    audit(created ? "TEAM_CREATED" : "TEAM_UPDATED", "TEAM", saved.getId(), saved.getName(), changes);
    return saved;
  }

  // --- business lines ------------------------------------------------------------------------------

  public record LineChange(String nameEn, String nameAr, Integer status, Integer sequence, String description,
      boolean descriptionGiven, Team team, boolean teamGiven, User manager, boolean managerGiven) {}

  @Transactional(rollbackOn = {Exception.class})
  public BusinessLine createLine(String code, LineChange input) {
    if (Query.of(BusinessLine.class).filter("self.code = ?1", code).count() > 0) {
      throw ApiException.invalidField("code", "DUPLICATE", "This code is already used.");
    }
    BusinessLine line = new BusinessLine();
    line.setCode(code);
    line.setStatusSelect(BusinessLineRepository.STATUS_IN_SETUP);
    List<String> changes = new ArrayList<>(List.of("created"));
    apply(line, input, changes);
    BusinessLine saved = JPA.save(line);
    audit("LINE_CREATED", "BUSINESS_LINE", saved.getId(), saved.getCode(), changes);
    return saved;
  }

  @Transactional(rollbackOn = {Exception.class})
  public BusinessLine updateLine(BusinessLine line, LineChange input) {
    List<String> changes = new ArrayList<>();
    apply(line, input, changes);
    if (changes.isEmpty()) return line;
    BusinessLine saved = JPA.save(line);
    audit("LINE_UPDATED", "BUSINESS_LINE", saved.getId(), saved.getCode(), changes);
    return saved;
  }

  private static void apply(BusinessLine line, LineChange input, List<String> changes) {
    if (input.nameEn() != null && !input.nameEn().equals(line.getNameEn())) {
      line.setNameEn(input.nameEn());
      changes.add("nameEn");
    }
    if (input.nameAr() != null && !input.nameAr().equals(line.getNameAr())) {
      line.setNameAr(input.nameAr());
      changes.add("nameAr");
    }
    if (input.status() != null && !input.status().equals(line.getStatusSelect())) {
      changes.add("status=" + line.getStatusSelect() + "→" + input.status());
      line.setStatusSelect(input.status());
    }
    if (input.sequence() != null && !input.sequence().equals(line.getSequence())) {
      line.setSequence(input.sequence());
      changes.add("sequence");
    }
    if (input.descriptionGiven() && !Objects.equals(input.description(), line.getDescription())) {
      line.setDescription(input.description());
      changes.add("description");
    }
    if (input.teamGiven() && !Objects.equals(id(input.team()), id(line.getResponsibleTeam()))) {
      line.setResponsibleTeam(input.team());
      changes.add("responsibleTeam=" + (input.team() == null ? "-" : input.team().getName()));
    }
    if (input.managerGiven() && !Objects.equals(id(input.manager()), id(line.getManager()))) {
      line.setManager(input.manager());
      changes.add("manager=" + (input.manager() == null ? "-" : input.manager().getCode()));
    }
  }

  /** Sets exactly who belongs to a line (the users' own line memberships, SEC-003). */
  @Transactional(rollbackOn = {Exception.class})
  public void setMembers(BusinessLine line, Set<User> members) {
    List<User> current = Query.of(User.class).filter("?1 MEMBER OF self.ioetiBusinessLines", line).fetch();
    Set<String> before = logins(current);
    for (User user : current) {
      if (!members.contains(user)) {
        user.getIoetiBusinessLines().remove(line);
        JPA.save(user);
      }
    }
    for (User user : members) {
      if (user.getIoetiBusinessLines() == null) user.setIoetiBusinessLines(new HashSet<>());
      if (user.getIoetiBusinessLines().add(line)) JPA.save(user);
    }
    Set<String> after = logins(members);
    if (!before.equals(after)) {
      audit("LINE_MEMBERS", "BUSINESS_LINE", line.getId(), line.getCode(), List.of("members=" + before + "→" + after));
    }
  }

  // --- audit ---------------------------------------------------------------------------------------

  /** Records a change made outside this service (for example the MFA self-service) in the same admin change log. */
  @Transactional(rollbackOn = {Exception.class})
  public void auditChange(String action, String subject, Long subjectId, String label, List<String> changes) {
    audit(action, subject, subjectId, label, changes);
  }

  void audit(String action, String subject, Long subjectId, String label, List<String> changes) {
    AdminAuditEvent event = new AdminAuditEvent();
    event.setActor(AuthUtils.getUser());
    event.setAction(action);
    event.setSubject(subject);
    event.setSubjectId(subjectId);
    event.setSubjectLabel(label == null ? null : label.substring(0, Math.min(label.length(), 200)));
    event.setChanges(String.join("; ", changes));
    event.setCreatedAt(LocalDateTime.now());
    JPA.save(event);
  }

  // --- small helpers -------------------------------------------------------------------------------

  static boolean isSelf(User user) {
    User me = AuthUtils.getUser();
    return me != null && user != null && Objects.equals(me.getId(), user.getId());
  }

  static String code(Group group) {
    return group == null ? "-" : group.getCode();
  }

  static Long id(Object model) {
    if (model instanceof Team t) return t.getId();
    if (model instanceof User u) return u.getId();
    return null;
  }

  static Set<String> codes(Collection<BusinessLine> lines) {
    Set<String> out = new java.util.TreeSet<>();
    for (BusinessLine line : lines) out.add(line.getCode());
    return out;
  }

  static Set<String> teamNames(Collection<Team> teams) {
    Set<String> out = new java.util.TreeSet<>();
    for (Team team : teams) out.add(team.getName());
    return out;
  }

  static Set<String> logins(Collection<User> users) {
    Set<String> out = new java.util.TreeSet<>();
    for (User user : users) out.add(user.getCode());
    return out;
  }
}
