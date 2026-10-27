package com.ioeti.certification.rest;

import com.axelor.app.AppSettings;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.axelor.utils.api.ResponseConstructor;
import com.ioeti.certification.db.ClientCertificate;
import com.ioeti.certification.service.CertificationDecisionService;
import com.ioeti.certification.service.DecisionRules;
import com.ioeti.core.api.ApiErrors;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.IoetiEndpoint;
import com.ioeti.core.policy.PolicyService;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.time.LocalDate;
import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * D-02 / D-10: the public certificate check. Anyone, without signing in, can confirm one certificate by its exact
 * number: number, standard, client company name, status and expiry, nothing else.
 *
 * <ul>
 *   <li>Open only while the {@code channels.enabled} policy contains CERTIFICATE_CHECK. Otherwise every number answers the
 *       same 404 as an unknown one, so the switch is no existence oracle.
 *   <li>No listing and no search: an exact number or 404. A client that is a person (not a company) is not named.
 *   <li>Rate limited per client address (default 30 checks a minute, {@code ioeti.certificate-check.per-minute}; the
 *       {@code X-Forwarded-For} of {@code ioeti.security.trusted.proxies} is believed, as for sign-in): 429 with
 *       Retry-After.
 * </ul>
 *
 * <p>It lives under {@code /ws/public/}, which the platform's own security configuration already leaves open to anonymous
 * callers (as for {@code /ws/public/app/info}); no security setting changes.
 */
@Path("/public/ioeti/certificates")
@Produces(MediaType.APPLICATION_JSON)
public class CertificateCheckController {

  static final String CHANNEL = "CERTIFICATE_CHECK";
  static final long WINDOW_MILLIS = 60_000;
  static final int MAX_KEYS = 10_000;
  private static final Map<String, Deque<Long>> RECENT = new ConcurrentHashMap<>();

  @GET
  @Path("/{number}")
  @Operation(summary = "Public certificate check by exact number (only while the CERTIFICATE_CHECK channel is on)", tags = {"IOETI certification"})
  @IoetiEndpoint
  public Response check(@PathParam("number") String number, @Context HttpServletRequest request) {
    long retry = admit(clientAddress(request), perMinute(), System.currentTimeMillis());
    if (retry > 0) {
      return Response.fromResponse(ApiErrors.response(429, "RATE_LIMITED", ApiErrors.message(429), List.of()))
          .header("Retry-After", String.valueOf((retry + 999) / 1000)).build();
    }
    LocalDate today = CertificationDecisionService.today();
    if (!channelOn(Beans.get(PolicyService.class), today)) throw ApiException.notFound();
    String normalised = DecisionRules.normaliseNumber(number);
    ClientCertificate certificate = normalised == null ? null
        : Query.of(ClientCertificate.class).filter("self.number = :n").bind("n", normalised).fetchOne();
    if (certificate == null) throw ApiException.notFound();
    return ResponseConstructor.build(Response.Status.OK, "Certificate", DecisionViews.publicView(certificate, today));
  }

  static boolean channelOn(PolicyService policies, LocalDate today) {
    return policies.current("channels.enabled", null, today)
        .map(p -> {
          for (var c : p.value().path("channels")) if (CHANNEL.equals(c.asText())) return true;
          return false;
        }).orElse(false);
  }

  static int perMinute() {
    try {
      return Math.max(1, Integer.parseInt(AppSettings.get().get("ioeti.certificate-check.per-minute", "30").trim()));
    } catch (NumberFormatException e) {
      return 30;
    }
  }

  static String clientAddress(HttpServletRequest request) {
    if (request == null) return "unknown";
    String remote = request.getRemoteAddr();
    String forwarded = request.getHeader("X-Forwarded-For");
    Set<String> trusted = Arrays.stream(AppSettings.get().get("ioeti.security.trusted.proxies", "").split(","))
        .map(String::trim).filter(s -> !s.isEmpty()).collect(Collectors.toSet());
    if (forwarded != null && trusted.contains(remote)) {
      String first = forwarded.split(",")[0].trim();
      if (!first.isEmpty()) return first;
    }
    return remote;
  }

  /** 0 when the address may check now (and counts it), else the milliseconds until it may. */
  static long admit(String key, int max, long now) {
    if (RECENT.size() >= MAX_KEYS) {
      RECENT.entrySet().removeIf(e -> {
        synchronized (e.getValue()) {
          prune(e.getValue(), now);
          return e.getValue().isEmpty();
        }
      });
      if (RECENT.size() >= MAX_KEYS && !RECENT.containsKey(key)) return WINDOW_MILLIS; // never grow without bound
    }
    Deque<Long> times = RECENT.computeIfAbsent(key, k -> new ArrayDeque<>());
    synchronized (times) {
      prune(times, now);
      if (times.size() >= max) return Math.max(1, times.peekFirst() + WINDOW_MILLIS - now);
      times.addLast(now);
      return 0;
    }
  }

  private static void prune(Deque<Long> times, long now) {
    while (!times.isEmpty() && times.peekFirst() <= now - WINDOW_MILLIS) times.pollFirst();
  }

  static void resetForTests() {
    RECENT.clear();
  }
}
