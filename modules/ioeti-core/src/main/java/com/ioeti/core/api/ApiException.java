package com.ioeti.core.api;

import java.util.List;

/**
 * An expected, client-facing failure of an IOETI endpoint. Its message is shown to the user, so it
 * must be written for the user and never carry internal details (class names, SQL, ids of records
 * the caller may not see).
 */
public class ApiException extends RuntimeException {

  private final int status;
  private final String code;
  private final List<FieldError> fieldErrors;

  public ApiException(int status, String code, String message, List<FieldError> fieldErrors) {
    super(message);
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors == null ? List.of() : List.copyOf(fieldErrors);
  }

  public int status() {
    return status;
  }

  public String code() {
    return code;
  }

  public List<FieldError> fieldErrors() {
    return fieldErrors;
  }

  /** One invalid input field: {@code field} is the request property, never a database column. */
  public record FieldError(String field, String code, String message) {}

  public static ApiException badRequest(String message) {
    return new ApiException(400, "INVALID_REQUEST", message, null);
  }

  public static ApiException invalidField(String field, String code, String message) {
    return new ApiException(
        422, "VALIDATION_FAILED", message, List.of(new FieldError(field, code, message)));
  }

  /** Used for records that do not exist and for records the caller may not see, identically. */
  public static ApiException notFound() {
    return new ApiException(404, "NOT_FOUND", ApiErrors.message(404), null);
  }

  public static ApiException forbidden() {
    return new ApiException(403, "FORBIDDEN", ApiErrors.message(403), null);
  }

  public static ApiException conflict() {
    return new ApiException(409, "CONFLICT", ApiErrors.message(409), null);
  }

  /** A command whose business policy has not been approved by IOETI (see OPEN_IOETI_POLICY_DECISIONS). */
  public static ApiException policyBlocked(String decisionId) {
    return new ApiException(
        422,
        "BLOCKED_BY_POLICY",
        "This action is not available until IOETI approves policy " + decisionId + ".",
        null);
  }
}
