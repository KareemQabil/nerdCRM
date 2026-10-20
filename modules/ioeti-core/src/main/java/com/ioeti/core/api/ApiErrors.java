package com.ioeti.core.api;

import jakarta.ws.rs.ClientErrorException;
import jakarta.ws.rs.ForbiddenException;
import jakarta.ws.rs.NotAuthorizedException;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.WebApplicationException;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The single error contract of {@code /ws/ioeti/*} (G-006).
 *
 * <pre>{"codeStatus": 404, "messageStatus": "Not found.",
 *  "error": {"code": "NOT_FOUND", "message": "Not found.", "correlationId": "…", "fields": []}}</pre>
 *
 * {@code codeStatus}/{@code messageStatus} keep the shape the custom UI already reads from AOS
 * responses; {@code error} is the typed part. Messages are fixed per status unless the endpoint
 * threw an {@link ApiException}, whose message is written for users. Unexpected failures are
 * logged with the correlation id and answered with a generic 500.
 */
public final class ApiErrors {

  private static final Logger LOG = LoggerFactory.getLogger(ApiErrors.class);

  private ApiErrors() {}

  public static String message(int status) {
    return switch (status) {
      case 400 -> "The request is invalid.";
      case 401 -> "Sign in again.";
      case 403 -> "You do not have access to this action.";
      case 404 -> "Not found.";
      case 405 -> "This method is not allowed here.";
      case 409 -> "Record has changed; refresh and retry.";
      case 415 -> "Unsupported content type.";
      case 422 -> "The request could not be processed.";
      case 429 -> "Too many requests; try again later.";
      default -> status >= 500 ? "Unexpected error; try again later." : "The request failed.";
    };
  }

  public static String code(int status) {
    return switch (status) {
      case 400 -> "INVALID_REQUEST";
      case 401 -> "UNAUTHENTICATED";
      case 403 -> "FORBIDDEN";
      case 404 -> "NOT_FOUND";
      case 405 -> "METHOD_NOT_ALLOWED";
      case 409 -> "CONFLICT";
      case 415 -> "UNSUPPORTED_MEDIA_TYPE";
      case 422 -> "VALIDATION_FAILED";
      case 429 -> "RATE_LIMITED";
      default -> status >= 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED";
    };
  }

  /** Maps anything thrown by an IOETI endpoint to the contract; never echoes internal messages. */
  public static Response from(Throwable error) {
    if (error instanceof ApiException api) {
      return response(api.status(), api.code(), api.getMessage(), api.fieldErrors());
    }
    int status;
    if (error instanceof NotAuthorizedException) {
      status = 401;
    } else if (error instanceof ForbiddenException
        || error.getClass().getName().equals("com.axelor.auth.AuthSecurityException")) {
      status = 403;
    } else if (error instanceof NotFoundException) {
      status = 404;
    } else if (error instanceof ClientErrorException client) {
      status = client.getResponse().getStatus();
    } else if (error instanceof WebApplicationException web
        && web.getResponse().getStatus() < 500) {
      status = web.getResponse().getStatus();
    } else {
      status = 500;
    }
    if (status >= 500) {
      LOG.error(
          "Unexpected error in IOETI endpoint [correlationId={}]", CorrelationId.current(), error);
    }
    return response(status, code(status), message(status), List.of());
  }

  public static Response response(
      int status, String code, String message, List<ApiException.FieldError> fields) {
    return Response.status(status)
        .type(MediaType.APPLICATION_JSON_TYPE)
        .entity(body(status, code, message, fields))
        .build();
  }

  public static Map<String, Object> body(
      int status, String code, String message, List<ApiException.FieldError> fields) {
    Map<String, Object> error = new LinkedHashMap<>();
    error.put("code", code);
    error.put("message", message);
    error.put("correlationId", CorrelationId.current());
    error.put("fields", fields == null ? List.of() : fields);
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("codeStatus", status);
    body.put("messageStatus", message);
    body.put("error", error);
    return body;
  }

  /** True if {@code entity} already follows this contract. */
  static boolean isContractBody(Object entity) {
    return entity instanceof Map<?, ?> map && map.get("error") instanceof Map<?, ?>;
  }
}
