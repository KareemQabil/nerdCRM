package com.ioeti.core.security;

import com.axelor.app.AppSettings;
import com.ioeti.core.api.ApiErrors;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.DispatcherType;
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.FilterRegistration;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletContext;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * SEC-004 / G-005: brute-force protection for the login callback. Neither AOP 8.2.5 nor AOS
 * 9.1.10 throttles failed logins.
 *
 * <p>Counts failed logins (the response status after the pac4j callback ran) in a sliding window,
 * per client IP and per username + IP. While a key is over its limit, further login attempts are
 * answered with 429 and {@code Retry-After} before credentials are checked. A per-username limit
 * across all IPs is deliberately absent: it would let anyone lock out a known user.
 *
 * <p>Settings (environment-mappable as {@code AXELOR_CONFIG_IOETI_SECURITY_LOGIN_*}):
 * {@code ioeti.security.login.window} minutes (15), {@code ioeti.security.login.ip.max} (20),
 * {@code ioeti.security.login.user.max} (5), {@code ioeti.security.trusted.proxies} (none; the
 * comma-separated proxy addresses whose {@code X-Forwarded-For} is believed). Counters are per JVM.
 */
public class LoginThrottleFilter implements Filter {

  public static final String FILTER_NAME = "ioetiLoginThrottle";
  private static final Logger LOG = LoggerFactory.getLogger(LoginThrottleFilter.class);
  private static final int MAX_BODY = 8192;
  private static final ObjectMapper JSON = new ObjectMapper();

  private final SlidingWindowCounter counter;
  private final int ipMax;
  private final int userMax;
  private final Set<String> trustedProxies;

  public LoginThrottleFilter() {
    this(
        new SlidingWindowCounter(minutes(setting("ioeti.security.login.window", 15)) , 50_000),
        setting("ioeti.security.login.ip.max", 20),
        setting("ioeti.security.login.user.max", 5),
        Arrays.stream(AppSettings.get().get("ioeti.security.trusted.proxies", "").split(","))
            .map(String::trim)
            .filter(s -> !s.isEmpty())
            .collect(Collectors.toSet()));
  }

  LoginThrottleFilter(
      SlidingWindowCounter counter, int ipMax, int userMax, Set<String> trustedProxies) {
    this.counter = counter;
    this.ipMax = ipMax;
    this.userMax = userMax;
    this.trustedProxies = trustedProxies;
  }

  private static int setting(String key, int fallback) {
    try {
      return Integer.parseInt(AppSettings.get().get(key, String.valueOf(fallback)).trim());
    } catch (RuntimeException e) {
      return fallback;
    }
  }

  private static long minutes(int value) {
    return Math.max(1, value) * 60_000L;
  }

  public static void register(ServletContext context) {
    if (context == null || context.getFilterRegistration(FILTER_NAME) != null) {
      return;
    }
    FilterRegistration.Dynamic registration = context.addFilter(FILTER_NAME, new LoginThrottleFilter());
    if (registration == null) {
      throw new IllegalStateException("SEC-004: cannot install the login throttle; refusing to start");
    }
    registration.addMappingForUrlPatterns(
        EnumSet.of(DispatcherType.REQUEST), false, "/callback", "/callback/*");
  }

  @Override
  public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
      throws IOException, ServletException {
    HttpServletRequest request = (HttpServletRequest) req;
    HttpServletResponse response = (HttpServletResponse) res;
    if (!"POST".equalsIgnoreCase(request.getMethod())) {
      chain.doFilter(req, res);
      return;
    }
    CachedBodyRequest cached = new CachedBodyRequest(request);
    String ip = clientIp(request);
    String user = username(cached);
    String ipKey = "ip:" + ip;
    String userKey = user == null ? null : "user:" + user + "@" + ip;

    long now = System.currentTimeMillis();
    long retryAfter =
        Math.max(
            counter.retryAfterMillis(ipKey, ipMax, now),
            userKey == null ? 0 : counter.retryAfterMillis(userKey, userMax, now));
    if (retryAfter > 0) {
      LOG.warn("Login attempt throttled for a client over its failure limit");
      response.setStatus(429);
      response.setHeader("Retry-After", String.valueOf(Math.max(1, retryAfter / 1000)));
      response.setContentType("application/json");
      response.getWriter()
          .write(JSON.writeValueAsString(
              ApiErrors.body(429, "RATE_LIMITED", ApiErrors.message(429), List.of())));
      return;
    }

    chain.doFilter(cached, res);

    int status = response.getStatus();
    if (status == 401 || status == 403) {
      counter.record(ipKey, now);
      if (userKey != null) {
        counter.record(userKey, now);
      }
    } else if (status >= 200 && status < 400 && userKey != null) {
      counter.reset(userKey); // a successful login clears that user's count, never the IP's
    }
  }

  String clientIp(HttpServletRequest request) {
    String remote = request.getRemoteAddr();
    String forwarded = request.getHeader("X-Forwarded-For");
    if (forwarded != null && trustedProxies.contains(remote)) {
      String first = forwarded.split(",")[0].trim();
      if (!first.isEmpty()) {
        return first;
      }
    }
    return remote;
  }

  static String username(CachedBodyRequest request) {
    String fromParam = request.getParameterIfForm("username");
    if (fromParam != null) {
      return normalize(fromParam);
    }
    String type = request.getContentType();
    if (type != null && type.toLowerCase(Locale.ROOT).contains("json")) {
      try {
        Object value = JSON.readValue(request.body(), Map.class).get("username");
        return value instanceof String s ? normalize(s) : null;
      } catch (IOException | RuntimeException e) {
        return null;
      }
    }
    return null;
  }

  private static String normalize(String username) {
    String value = username.trim().toLowerCase(Locale.ROOT);
    return value.isEmpty() ? null : value.substring(0, Math.min(value.length(), 150));
  }

  /** Buffers a small login body so it can be read here and again by pac4j. */
  static final class CachedBodyRequest extends HttpServletRequestWrapper {
    private final byte[] body;

    CachedBodyRequest(HttpServletRequest request) throws IOException {
      super(request);
      String type = request.getContentType();
      boolean form = type != null && type.toLowerCase(Locale.ROOT).startsWith("application/x-www-form-urlencoded");
      // form bodies are parsed by the container (getParameter); only buffer other small bodies
      body = form ? new byte[0] : request.getInputStream().readNBytes(MAX_BODY + 1);
    }

    byte[] body() {
      return body.length > MAX_BODY ? new byte[0] : body;
    }

    String getParameterIfForm(String name) {
      String type = getContentType();
      return type != null && type.toLowerCase(Locale.ROOT).startsWith("application/x-www-form-urlencoded")
          ? getParameter(name)
          : null;
    }

    @Override
    public ServletInputStream getInputStream() {
      ByteArrayInputStream in = new ByteArrayInputStream(body);
      return new ServletInputStream() {
        @Override
        public boolean isFinished() {
          return in.available() == 0;
        }

        @Override
        public boolean isReady() {
          return true;
        }

        @Override
        public void setReadListener(ReadListener listener) {
          throw new UnsupportedOperationException();
        }

        @Override
        public int read() {
          return in.read();
        }

        @Override
        public int read(byte[] b, int off, int len) {
          return in.read(b, off, len);
        }
      };
    }

    @Override
    public BufferedReader getReader() {
      return new BufferedReader(new InputStreamReader(getInputStream(), StandardCharsets.UTF_8));
    }
  }
}
