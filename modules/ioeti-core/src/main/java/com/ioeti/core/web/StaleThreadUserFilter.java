package com.ioeti.core.web;

import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.User;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.container.ContainerResponseContext;
import jakarta.ws.rs.container.ContainerResponseFilter;
import jakarta.ws.rs.container.PreMatching;
import jakarta.ws.rs.ext.Provider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Security mitigation for an Axelor Open Platform 8.2.x issue found while testing IOETI.
 *
 * <p>{@code ContextAwareCallable.call()} captures the caller context (resolving the session user)
 * and afterwards calls {@code ContextState.restore(previous)}, which re-applies it with {@code
 * AuthUtils.setCurrentUser(user)}. When such a task runs inline on a Tomcat request thread (e.g.
 * the admin "restore all views" action), that pooled thread keeps a thread-bound user. {@code
 * AuthUtils.getUser()} prefers the thread-bound user over the HTTP session, so later requests of
 * other users served by that thread are evaluated as the previous user (an admin bypasses all
 * permission checks). Measured: 0 leaks on fresh threads, 10-20% of non-admin requests leaking
 * hidden records after one admin restore (scripts/record_filter_leak_probe.py).
 *
 * <p>HTTP requests must take the user from the session only, so the thread-bound user is cleared
 * before every JAX-RS request (all {@code /ws/*} endpoints, including the generic REST API) and
 * after the response. Batch jobs and async tasks are unaffected: they run on their own threads.
 */
@Provider
@PreMatching
public class StaleThreadUserFilter implements ContainerRequestFilter, ContainerResponseFilter {

  private static final Logger LOG = LoggerFactory.getLogger(StaleThreadUserFilter.class);

  @Override
  public void filter(ContainerRequestContext request) {
    User stale = AuthUtils.getCurrentUser();
    if (stale != null) {
      LOG.warn(
          "Cleared stale thread-bound user '{}' before request {} {}",
          stale.getCode(),
          request.getMethod(),
          request.getUriInfo().getPath());
      AuthUtils.removeCurrentUser();
    }
  }

  @Override
  public void filter(ContainerRequestContext request, ContainerResponseContext response) {
    AuthUtils.removeCurrentUser();
  }
}
