package com.ioeti.core.api;

import java.util.UUID;
import java.util.regex.Pattern;
import org.slf4j.MDC;

/**
 * Per-request correlation id: taken from a well-formed {@code X-Correlation-Id} request header or
 * generated, stored in the SLF4J MDC for server logs and returned in the response header and error
 * body, so a user-visible error can be matched to its server log entry.
 */
public final class CorrelationId {

  public static final String HEADER = "X-Correlation-Id";
  public static final String MDC_KEY = "correlationId";
  private static final Pattern SAFE = Pattern.compile("[A-Za-z0-9-]{8,64}");

  private CorrelationId() {}

  /** Starts a request: accepts the caller's id only if it is safe to log and echo. */
  public static String begin(String requested) {
    String id =
        requested != null && SAFE.matcher(requested).matches()
            ? requested
            : UUID.randomUUID().toString();
    MDC.put(MDC_KEY, id);
    return id;
  }

  public static String current() {
    String id = MDC.get(MDC_KEY);
    return id == null ? "unavailable" : id;
  }

  public static void end() {
    MDC.remove(MDC_KEY);
  }
}
