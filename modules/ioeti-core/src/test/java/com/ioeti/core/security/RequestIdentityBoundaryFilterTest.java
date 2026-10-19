package com.ioeti.core.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.User;
import jakarta.servlet.DispatcherType;
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.FilterRegistration;
import jakarta.servlet.ServletContext;
import jakarta.servlet.ServletException;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class RequestIdentityBoundaryFilterTest {

  private final RequestIdentityBoundaryFilter filter = new RequestIdentityBoundaryFilter();

  private static User user(String code) {
    User user = new User();
    user.setCode(code);
    return user;
  }

  @AfterEach
  void clean() {
    AuthUtils.removeCurrentUser();
  }

  @Test
  void identityLeftOnTheThreadIsNotInheritedByTheNextRequest() throws Exception {
    AuthUtils.setCurrentUser(user("admin"));
    long stale = RequestIdentityBoundaryFilter.STALE_AT_ENTRY.sum();
    AtomicReference<User> seen = new AtomicReference<>(user("sentinel"));

    filter.doFilter(null, null, (req, res) -> seen.set(AuthUtils.getCurrentUser()));

    assertNull(seen.get(), "the request must start without a thread-bound user");
    assertEquals(stale + 1, RequestIdentityBoundaryFilter.STALE_AT_ENTRY.sum());
    assertNull(AuthUtils.getCurrentUser());
  }

  @Test
  void identityPinnedDuringTheRequestIsClearedAtExit() throws Exception {
    long cleared = RequestIdentityBoundaryFilter.CLEARED_AT_EXIT.sum();
    // what ContextState.restore does when a context-aware task runs inline on the request thread
    filter.doFilter(null, null, (req, res) -> AuthUtils.setCurrentUser(user("admin")));

    assertNull(AuthUtils.getCurrentUser());
    assertEquals(cleared + 1, RequestIdentityBoundaryFilter.CLEARED_AT_EXIT.sum());
  }

  @Test
  void identityIsClearedWhenTheRequestFails() {
    FilterChain failing =
        (req, res) -> {
          AuthUtils.setCurrentUser(user("admin"));
          throw new ServletException("boom");
        };
    assertThrows(ServletException.class, () -> filter.doFilter(null, null, failing));
    assertNull(AuthUtils.getCurrentUser());

    FilterChain crashing =
        (req, res) -> {
          AuthUtils.setCurrentUser(user("admin"));
          throw new IllegalStateException("unchecked");
        };
    assertThrows(IllegalStateException.class, () -> filter.doFilter(null, null, crashing));
    assertNull(AuthUtils.getCurrentUser());
  }

  @Test
  void identitySetOnPurposeInsideTheRequestStaysVisibleUntilTheRequestEnds() throws Exception {
    User batchUser = user("batch");
    List<User> observed = new ArrayList<>();
    filter.doFilter(
        null,
        null,
        (req, res) -> {
          AuthUtils.setCurrentUser(batchUser);
          observed.add(AuthUtils.getCurrentUser());
          observed.add(AuthUtils.getCurrentUser());
          AuthUtils.removeCurrentUser();
        });
    assertSame(batchUser, observed.get(0));
    assertSame(batchUser, observed.get(1));
  }

  @Test
  void identityOfJobThreadsIsNeverTouched() throws Exception {
    User jobUser = user("job");
    CountDownLatch jobReady = new CountDownLatch(1);
    CountDownLatch requestDone = new CountDownLatch(1);
    AtomicReference<User> jobSeesAfterRequest = new AtomicReference<>();
    Thread job =
        new Thread(
            () -> {
              AuthUtils.setCurrentUser(jobUser);
              jobReady.countDown();
              try {
                requestDone.await();
              } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
              }
              jobSeesAfterRequest.set(AuthUtils.getCurrentUser());
              AuthUtils.removeCurrentUser();
            });
    job.start();
    jobReady.await();
    filter.doFilter(null, null, (req, res) -> AuthUtils.setCurrentUser(user("admin")));
    requestDone.countDown();
    job.join();
    assertSame(jobUser, jobSeesAfterRequest.get());
  }

  // --- registration ------------------------------------------------------------------------

  private record Registration(String name, Filter filter, List<Object[]> mappings) {}

  private static ServletContext context(List<Registration> added, boolean refuse) {
    return (ServletContext)
        Proxy.newProxyInstance(
            ServletContext.class.getClassLoader(),
            new Class<?>[] {ServletContext.class},
            (proxy, method, args) ->
                switch (method.getName()) {
                  case "getFilterRegistration" ->
                      added.stream().anyMatch(r -> r.name().equals(args[0]))
                          ? dynamic(new ArrayList<>())
                          : null;
                  case "addFilter" -> {
                    if (refuse) {
                      yield null;
                    }
                    Registration r =
                        new Registration((String) args[0], (Filter) args[1], new ArrayList<>());
                    added.add(r);
                    yield dynamic(r.mappings());
                  }
                  default -> null;
                });
  }

  private static FilterRegistration.Dynamic dynamic(List<Object[]> mappings) {
    return (FilterRegistration.Dynamic)
        Proxy.newProxyInstance(
            FilterRegistration.Dynamic.class.getClassLoader(),
            new Class<?>[] {FilterRegistration.Dynamic.class},
            (proxy, method, args) -> {
              if (method.getName().equals("addMappingForUrlPatterns")) {
                mappings.add(args);
              }
              return null;
            });
  }

  @Test
  @SuppressWarnings("unchecked")
  void registersOneFilterForAllUrlsBeforeTheDeclaredFilters() {
    List<Registration> added = new ArrayList<>();
    ServletContext context = context(added, false);

    RequestIdentityBoundary.register(context);
    RequestIdentityBoundary.register(context); // idempotent

    assertEquals(1, added.size());
    Registration registration = added.get(0);
    assertEquals(RequestIdentityBoundary.FILTER_NAME, registration.name());
    assertTrue(registration.filter() instanceof RequestIdentityBoundaryFilter);
    Object[] mapping = registration.mappings().get(0);
    assertEquals(
        EnumSet.of(DispatcherType.REQUEST, DispatcherType.ASYNC, DispatcherType.ERROR),
        (EnumSet<DispatcherType>) mapping[0]);
    assertEquals(false, mapping[1], "isMatchAfter=false puts it before GuiceFilter");
    assertEquals("/*", ((String[]) mapping[2])[0]);
    assertTrue(RequestIdentityBoundary.isRegistered());
  }

  @Test
  void refusesToStartWhenTheFilterCannotBeInstalled() {
    assertThrows(
        IllegalStateException.class,
        () -> RequestIdentityBoundary.register(context(new ArrayList<>(), true)));
  }

  @Test
  void withoutAServletContextThereIsNothingToRegister() {
    RequestIdentityBoundary.register(null);
  }
}
