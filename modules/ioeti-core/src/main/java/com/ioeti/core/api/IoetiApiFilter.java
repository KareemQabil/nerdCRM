package com.ioeti.core.api;

import jakarta.annotation.Priority;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.container.ContainerResponseContext;
import jakarta.ws.rs.container.ContainerResponseFilter;
import jakarta.ws.rs.container.PreMatching;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.ext.Provider;
import java.util.List;

/**
 * Correlation id for every {@code /ws} request, and the error contract for every {@code
 * /ws/ioeti/*} response, including failures that never reach an endpoint method (malformed JSON,
 * unknown path, wrong method or content type).
 */
@Provider
@PreMatching
@Priority(Priorities.AUTHENTICATION - 100)
public class IoetiApiFilter implements ContainerRequestFilter, ContainerResponseFilter {

  static final String IOETI_PREFIX = "ioeti";

  @Override
  public void filter(ContainerRequestContext request) {
    CorrelationId.begin(request.getHeaderString(CorrelationId.HEADER));
  }

  @Override
  public void filter(ContainerRequestContext request, ContainerResponseContext response) {
    try {
      response.getHeaders().putSingle(CorrelationId.HEADER, CorrelationId.current());
      int status = response.getStatus();
      if (status >= 400
          && isIoetiPath(request.getUriInfo().getPath())
          && !ApiErrors.isContractBody(response.getEntity())) {
        response.setEntity(
            ApiErrors.body(status, ApiErrors.code(status), ApiErrors.message(status), List.of()),
            null,
            MediaType.APPLICATION_JSON_TYPE);
      }
    } finally {
      CorrelationId.end();
    }
  }

  static String normalize(String path) {
    String p = path == null ? "" : path;
    while (p.startsWith("/")) {
      p = p.substring(1);
    }
    return p;
  }

  static boolean isIoetiPath(String path) {
    String p = normalize(path);
    return p.equals(IOETI_PREFIX) || p.startsWith(IOETI_PREFIX + "/");
  }
}
