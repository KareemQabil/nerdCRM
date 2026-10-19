package com.ioeti.businessline;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.User;
import com.axelor.concurrent.ContextAware;
import com.axelor.db.JPA;
import com.axelor.db.JpaSupport;
import com.axelor.test.GuiceExtension;
import com.axelor.test.GuiceModules;
import com.ioeti.core.security.RequestIdentityBoundaryFilter;
import jakarta.persistence.EntityManagerFactory;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.apache.shiro.mgt.DefaultSecurityManager;
import org.apache.shiro.subject.SimplePrincipalCollection;
import org.apache.shiro.subject.Subject;
import org.apache.shiro.util.ThreadContext;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

/**
 * SEC-001 against the real AOP 8.2.5 classes (ContextAware, ContextState, AuthUtils, JPA): a
 * request thread whose Shiro subject is user A runs an inline context-aware task, as {@code
 * ModuleManager.installModules} does during "restore all views".
 *
 * <p>The first test pins the upstream behaviour: if it fails after an AOP upgrade, upstream changed
 * and SEC-001 must be re-assessed (the boundary stays as defence in depth).
 */
@ExtendWith(GuiceExtension.class)
@GuiceModules(BusinessLineTestModule.class)
class RequestIdentityBoundaryIntegrationTest extends JpaSupport {

  @AfterAll
  static void closeEntityManagerFactory() {
    EntityManagerFactory factory = JPA.em().getEntityManagerFactory();
    if (factory != null) {
      factory.close();
    }
  }

  @AfterEach
  void unbind() {
    AuthUtils.removeCurrentUser();
    ThreadContext.remove();
  }

  private User persistedUser(String code) {
    User user = new User();
    user.setCode(code + System.nanoTime());
    user.setName(code);
    user.setPassword("not-used");
    inTransaction(() -> JPA.save(user));
    return user;
  }

  /** Binds an authenticated Shiro subject for {@code user}, like the Shiro filter on a request. */
  private static void sessionOf(User user) {
    Subject subject =
        new Subject.Builder(new DefaultSecurityManager())
            .principals(new SimplePrincipalCollection(List.of(user.getCode(), user.getId()), "t"))
            .authenticated(true)
            .buildSubject();
    ThreadContext.bind(subject);
  }

  private static void inlineContextAwareTask(User runAs) {
    ContextAware.of().withTransaction(false).withUser(runAs).build(() -> {}).run();
  }

  @Test
  void upstreamInlineContextAwareTaskPinsTheSessionUserOnTheThread() {
    User sessionUser = persistedUser("session");
    User taskUser = persistedUser("task");
    sessionOf(sessionUser);
    assertNull(AuthUtils.getCurrentUser(), "request thread starts without a thread-bound user");

    inlineContextAwareTask(taskUser);

    User pinned = AuthUtils.getCurrentUser();
    assertNotNull(pinned, "AOP 8.2.5 leaves the resolved session user bound to the thread");
    assertEquals(sessionUser.getId(), pinned.getId());

    // The next request served by this pooled thread belongs to someone else (or nobody):
    ThreadContext.remove();
    assertEquals(sessionUser.getId(), AuthUtils.getUser().getId(), "inherited without boundary");
  }

  @Test
  void boundaryEndsTheRequestWithoutAThreadBoundUser() throws Exception {
    User sessionUser = persistedUser("session");
    User taskUser = persistedUser("task");

    new RequestIdentityBoundaryFilter()
        .doFilter(
            null,
            null,
            (req, res) -> {
              sessionOf(sessionUser);
              inlineContextAwareTask(taskUser);
              ThreadContext.remove();
            });

    assertNull(AuthUtils.getCurrentUser());
    assertNull(AuthUtils.getUser(), "next request on this thread inherits nobody");
  }

  @Test
  void identityInsideTheInlineTaskIsTheRequestedOneWithTheBoundary() throws Exception {
    User sessionUser = persistedUser("session");
    User taskUser = persistedUser("task");
    AtomicReference<Long> inside = new AtomicReference<>();

    new RequestIdentityBoundaryFilter()
        .doFilter(
            null,
            null,
            (req, res) -> {
              sessionOf(sessionUser);
              ContextAware.of()
                  .withTransaction(false)
                  .withUser(taskUser)
                  .build(() -> inside.set(AuthUtils.getUser().getId()))
                  .run();
              ThreadContext.remove();
            });

    assertEquals(taskUser.getId(), inside.get(), "boundary does not interfere inside a request");
  }
}
