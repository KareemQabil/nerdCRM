package com.ioeti.core.security;

import com.axelor.auth.AuthUtils;
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import java.io.IOException;
import java.util.concurrent.atomic.LongAdder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * SEC-001: every HTTP request starts and ends without a thread-bound user.
 *
 * <p>{@code AuthUtils.getUser()} (AOP 8.2.5) returns the thread-bound {@code CURRENT_USER} before
 * the session subject. {@code ContextState.restore} re-applies the caller's resolved session user
 * when a context-aware task runs inline on a request thread (e.g. {@code
 * ModuleManager.installModules} during "restore all views"), so that pooled thread keeps the
 * identity after the request. Registered by {@link RequestIdentityBoundary} in front of {@code
 * GuiceFilter}, this filter runs before Shiro/pac4j (which also call {@code AuthUtils.getUser()}),
 * the JAX-RS dispatcher and any servlet, and clears the thread-bound user on entry and in {@code
 * finally} on exit. It never touches it in between, so identity set on purpose inside a request
 * (context-aware tasks, {@code AuditableRunner}) works as before, and it never runs on scheduler or
 * executor threads.
 */
public class RequestIdentityBoundaryFilter implements Filter {

  private static final Logger LOG = LoggerFactory.getLogger(RequestIdentityBoundaryFilter.class);

  static final LongAdder REQUESTS = new LongAdder();
  static final LongAdder STALE_AT_ENTRY = new LongAdder();
  static final LongAdder CLEARED_AT_EXIT = new LongAdder();

  @Override
  public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
      throws IOException, ServletException {
    REQUESTS.increment();
    if (AuthUtils.getCurrentUser() != null) {
      // Only reachable if a thread was polluted outside any HTTP request (e.g. a WebSocket
      // handler); the exit clear below makes it impossible after an HTTP request.
      STALE_AT_ENTRY.increment();
      AuthUtils.removeCurrentUser();
      LOG.warn("Cleared a thread-bound identity left on a request thread before dispatch");
    }
    try {
      chain.doFilter(request, response);
    } finally {
      if (AuthUtils.getCurrentUser() != null) {
        CLEARED_AT_EXIT.increment();
        AuthUtils.removeCurrentUser();
        LOG.debug("Cleared a thread-bound identity left by the request processing");
      }
    }
  }
}
