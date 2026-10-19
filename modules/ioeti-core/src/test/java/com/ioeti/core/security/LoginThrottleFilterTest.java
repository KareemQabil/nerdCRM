package com.ioeti.core.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.ByteArrayInputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class LoginThrottleFilterTest {

  private static HttpServletRequest login(String remote, String forwardedFor, String json) {
    byte[] body = json.getBytes(StandardCharsets.UTF_8);
    ByteArrayInputStream in = new ByteArrayInputStream(body);
    ServletInputStream stream =
        new ServletInputStream() {
          @Override
          public boolean isFinished() {
            return in.available() == 0;
          }

          @Override
          public boolean isReady() {
            return true;
          }

          @Override
          public void setReadListener(jakarta.servlet.ReadListener l) {}

          @Override
          public int read() {
            return in.read();
          }
        };
    return (HttpServletRequest)
        Proxy.newProxyInstance(
            HttpServletRequest.class.getClassLoader(),
            new Class<?>[] {HttpServletRequest.class},
            (p, m, a) ->
                switch (m.getName()) {
                  case "getMethod" -> "POST";
                  case "getContentType" -> "application/json";
                  case "getRemoteAddr" -> remote;
                  case "getHeader" -> "X-Forwarded-For".equals(a[0]) ? forwardedFor : null;
                  case "getInputStream" -> stream;
                  default -> null;
                });
  }

  /** Response whose status the chain sets, like pac4j answering 401 or 200. */
  private static HttpServletResponse response(Map<String, Object> state) {
    StringWriter out = new StringWriter();
    return (HttpServletResponse)
        Proxy.newProxyInstance(
            HttpServletResponse.class.getClassLoader(),
            new Class<?>[] {HttpServletResponse.class},
            (p, m, a) -> {
              switch (m.getName()) {
                case "setStatus" -> state.put("status", a[0]);
                case "getStatus" -> {
                  return state.getOrDefault("status", 200);
                }
                case "setHeader" -> state.put(a[0].toString(), a[1]);
                case "getWriter" -> {
                  state.put("body", out);
                  return new PrintWriter(out);
                }
                default -> {}
              }
              return null;
            });
  }

  private static LoginThrottleFilter filter(int ipMax, int userMax, Set<String> proxies) {
    return new LoginThrottleFilter(new SlidingWindowCounter(60_000, 1000), ipMax, userMax, proxies);
  }

  private static int attempt(LoginThrottleFilter filter, String ip, String user, int chainStatus, AtomicInteger chainCalls)
      throws Exception {
    Map<String, Object> state = new HashMap<>();
    HttpServletResponse response = response(state);
    FilterChain chain =
        (req, res) -> {
          chainCalls.incrementAndGet();
          // pac4j must still be able to read the body after the throttle looked at it
          String body = new String(req.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
          assertTrue(body.contains("\"username\""));
          ((HttpServletResponse) res).setStatus(chainStatus);
        };
    filter.doFilter(login(ip, null, "{\"username\":\"" + user + "\",\"password\":\"x\"}"), response, chain);
    return (int) state.getOrDefault("status", 200);
  }

  @Test
  void repeatedFailuresForOneUserFromOneAddressAreThrottledBeforeCredentialsAreChecked() throws Exception {
    LoginThrottleFilter filter = filter(100, 3, Set.of());
    AtomicInteger calls = new AtomicInteger();
    for (int i = 0; i < 3; i++) {
      assertEquals(401, attempt(filter, "10.0.0.1", "Sales.A", 401, calls));
    }
    assertEquals(429, attempt(filter, "10.0.0.1", "sales.a", 200, calls), "username is case-insensitive");
    assertEquals(3, calls.get(), "the throttled attempt never reached authentication");
    // the same user from another address and another user from this address are unaffected
    assertEquals(200, attempt(filter, "10.0.0.2", "sales.a", 200, calls));
    assertEquals(200, attempt(filter, "10.0.0.1", "sales.b", 200, calls));
  }

  @Test
  void manyFailuresFromOneAddressThrottleThatAddressForEveryUser() throws Exception {
    LoginThrottleFilter filter = filter(4, 100, Set.of());
    AtomicInteger calls = new AtomicInteger();
    for (int i = 0; i < 4; i++) {
      attempt(filter, "10.0.0.9", "user" + i, 401, calls);
    }
    assertEquals(429, attempt(filter, "10.0.0.9", "someone.else", 200, calls));
  }

  @Test
  void successfulLoginClearsTheUserCountButNotTheAddressCount() throws Exception {
    LoginThrottleFilter filter = filter(3, 2, Set.of());
    AtomicInteger calls = new AtomicInteger();
    attempt(filter, "10.0.0.5", "a", 401, calls);
    assertEquals(200, attempt(filter, "10.0.0.5", "a", 200, calls));
    attempt(filter, "10.0.0.5", "a", 401, calls);
    assertEquals(401, attempt(filter, "10.0.0.5", "a", 401, calls), "user count restarted after success");
    assertEquals(429, attempt(filter, "10.0.0.5", "b", 200, calls), "address count kept: 3 failures");
  }

  @Test
  void forwardedForIsTrustedOnlyFromConfiguredProxies() {
    LoginThrottleFilter direct = filter(1, 1, Set.of());
    LoginThrottleFilter behindProxy = filter(1, 1, Set.of("10.1.1.1"));
    assertEquals("203.0.113.7", direct.clientIp(login("203.0.113.7", "1.2.3.4", "{}")));
    assertEquals("1.2.3.4", behindProxy.clientIp(login("10.1.1.1", "1.2.3.4, 10.1.1.1", "{}")));
    assertEquals("203.0.113.7", behindProxy.clientIp(login("203.0.113.7", "1.2.3.4", "{}")));
  }

  @Test
  void usernameIsReadFromJsonAndMissingOrMalformedBodiesAreTolerated() throws Exception {
    assertEquals(
        "sales.a",
        LoginThrottleFilter.username(new LoginThrottleFilter.CachedBodyRequest(
            login("1.1.1.1", null, "{\"username\":\"  Sales.A \",\"password\":\"x\"}"))));
    assertNull(LoginThrottleFilter.username(new LoginThrottleFilter.CachedBodyRequest(login("1.1.1.1", null, "{oops"))));
    assertNull(LoginThrottleFilter.username(new LoginThrottleFilter.CachedBodyRequest(login("1.1.1.1", null, "{}"))));
  }

  @Test
  void windowExpiryReleasesTheThrottle() {
    SlidingWindowCounter counter = new SlidingWindowCounter(1_000, 10);
    counter.record("k", 0);
    counter.record("k", 100);
    assertTrue(counter.retryAfterMillis("k", 2, 500) > 0);
    assertEquals(0, counter.retryAfterMillis("k", 2, 1_101));
  }
}
