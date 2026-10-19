package com.ioeti.core.api;

import com.axelor.app.AppSettings;
import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.User;
import jakarta.annotation.Priority;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.container.PreMatching;
import jakarta.ws.rs.ext.Provider;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * G-003 / SEC-002: ordinary staff use the IOETI application API only.
 *
 * <p>The generic Axelor endpoints ({@code /ws/rest}, {@code /ws/action}, {@code /ws/meta}, {@code
 * /ws/dms}, …) expose every readable model with every field: field-level read rules are not applied
 * on search/fetch (see docs/SECURITY_MODEL.md). Per ADR-001 the native Axelor UI is kept for
 * restricted maintenance, so those endpoints are only open to maintenance users: the administrator
 * and the groups listed in {@code ioeti.security.maintenance-groups} (default {@code admins}).
 * Everyone else gets 403 on every {@code /ws} path except {@code /ws/ioeti/*} and {@code
 * /ws/public/*}.
 *
 * <p>{@code ioeti.security.generic-api=open} disables the gate for an isolated development setup;
 * any other value, or none, keeps it restricted.
 */
@Provider
@PreMatching
@Priority(Priorities.AUTHORIZATION)
public class GenericApiExposureFilter implements ContainerRequestFilter {

  static final String MODE_KEY = "ioeti.security.generic-api";
  static final String GROUPS_KEY = "ioeti.security.maintenance-groups";
  private static final List<String> ALWAYS_ALLOWED = List.of("ioeti", "public");

  @Override
  public void filter(ContainerRequestContext request) {
    if (!isRestricted() || isAllowedPath(request.getUriInfo().getPath())) {
      return;
    }
    User user = AuthUtils.getUser();
    if (user == null || isMaintenanceUser(user)) {
      // unauthenticated requests never get here for protected paths (Shiro/pac4j answer 401)
      return;
    }
    request.abortWith(ApiErrors.response(403, "FORBIDDEN", ApiErrors.message(403), List.of()));
  }

  static boolean isRestricted() {
    return !"open".equalsIgnoreCase(AppSettings.get().get(MODE_KEY, "restricted").trim());
  }

  static boolean isAllowedPath(String path) {
    String p = IoetiApiFilter.normalize(path);
    return ALWAYS_ALLOWED.stream().anyMatch(prefix -> p.equals(prefix) || p.startsWith(prefix + "/"));
  }

  static Set<String> maintenanceGroups() {
    return Arrays.stream(AppSettings.get().get(GROUPS_KEY, "admins").split(","))
        .map(s -> s.trim().toLowerCase(Locale.ROOT))
        .filter(s -> !s.isEmpty())
        .collect(Collectors.toSet());
  }

  static boolean isMaintenanceUser(User user) {
    return AuthUtils.isAdmin(user)
        || (user.getGroup() != null
            && user.getGroup().getCode() != null
            && maintenanceGroups().contains(user.getGroup().getCode().toLowerCase(Locale.ROOT)));
  }
}
