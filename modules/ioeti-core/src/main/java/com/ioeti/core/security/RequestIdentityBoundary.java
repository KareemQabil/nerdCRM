package com.ioeti.core.security;

import com.google.inject.servlet.ServletModule;
import jakarta.servlet.DispatcherType;
import jakarta.servlet.FilterRegistration;
import jakarta.servlet.ServletContext;
import java.util.EnumSet;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Installs {@link RequestIdentityBoundaryFilter} as the first filter of the web application.
 *
 * <p>The AOP web injector is created in {@code AppContextListener.contextInitialized} (a listener
 * declared in {@code web.xml}), where the Servlet API still allows {@code addFilter}. A mapping
 * added with {@code isMatchAfter = false} precedes the {@code web.xml} mapping of {@code
 * GuiceFilter}, so the boundary wraps Shiro/pac4j, every Guice filter, RESTEasy and all servlets,
 * the same way in the embedded dev Tomcat, CI and a WAR deployment (no jar scanning involved).
 *
 * <p>Fails closed: in a web context where the filter cannot be registered, startup aborts. Without
 * a servlet context (unit tests, command-line tools) there are no HTTP requests and nothing to do.
 */
public final class RequestIdentityBoundary {

  public static final String FILTER_NAME = "ioetiRequestIdentityBoundary";

  private static final Logger LOG = LoggerFactory.getLogger(RequestIdentityBoundary.class);
  private static volatile boolean registered;

  private RequestIdentityBoundary() {}

  /** Registers the filter on the servlet context being initialized, if there is one. */
  public static void register() {
    register(new ServletContextAccess().servletContext());
  }

  static void register(ServletContext context) {
    if (context == null) {
      return;
    }
    if (context.getFilterRegistration(FILTER_NAME) != null) {
      registered = true;
      return;
    }
    FilterRegistration.Dynamic registration;
    try {
      registration = context.addFilter(FILTER_NAME, new RequestIdentityBoundaryFilter());
    } catch (RuntimeException e) {
      throw new IllegalStateException(
          "SEC-001: cannot install the request identity boundary; refusing to start", e);
    }
    if (registration == null) {
      throw new IllegalStateException(
          "SEC-001: cannot install the request identity boundary; refusing to start");
    }
    registration.setAsyncSupported(true);
    registration.addMappingForUrlPatterns(
        EnumSet.of(DispatcherType.REQUEST, DispatcherType.ASYNC, DispatcherType.ERROR),
        false,
        "/*");
    registered = true;
    LOG.info("SEC-001 request identity boundary installed before all other filters");
  }

  public static boolean isRegistered() {
    return registered;
  }

  /** Counters since startup, for the admin diagnostics endpoint and the live probe. */
  public static Map<String, Object> stats() {
    return Map.of(
        "registered", registered,
        "requests", RequestIdentityBoundaryFilter.REQUESTS.sum(),
        "staleAtEntry", RequestIdentityBoundaryFilter.STALE_AT_ENTRY.sum(),
        "clearedAtExit", RequestIdentityBoundaryFilter.CLEARED_AT_EXIT.sum());
  }

  /** Reads the context through Guice's supported {@code ServletModule#getServletContext()}. */
  private static final class ServletContextAccess extends ServletModule {
    ServletContext servletContext() {
      return getServletContext();
    }
  }
}
