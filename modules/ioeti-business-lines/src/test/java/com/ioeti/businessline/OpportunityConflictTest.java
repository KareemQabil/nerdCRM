package com.ioeti.businessline;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.axelor.apps.crm.db.Opportunity;
import com.axelor.apps.crm.db.OpportunityStatus;
import com.axelor.db.JPA;
import com.axelor.db.JpaSupport;
import com.axelor.test.GuiceExtension;
import com.axelor.test.GuiceModules;
import com.axelor.apps.crm.service.OpportunityService;
import com.axelor.inject.Beans;
import com.axelor.utils.api.ConflictChecker;
import com.axelor.utils.api.HttpExceptionHandlerImpl;
import jakarta.persistence.OptimisticLockException;
import com.ioeti.core.web.OptimisticLockConflicts;
import jakarta.persistence.EntityManagerFactory;
import jakarta.ws.rs.ClientErrorException;
import jakarta.ws.rs.WebApplicationException;
import jakarta.ws.rs.core.Response;
import java.lang.reflect.AccessibleObject;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import org.aopalliance.intercept.MethodInvocation;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

/**
 * API-001 regression: a stale Opportunity write must be answered with 409 and must not be
 * persisted, whether the staleness is visible before writing or only at commit time.
 */
@ExtendWith(GuiceExtension.class)
@GuiceModules(BusinessLineTestModule.class)
class OpportunityConflictTest extends JpaSupport {

  @AfterAll
  static void closeEntityManagerFactory() {
    EntityManagerFactory factory = JPA.em().getEntityManagerFactory();
    if (factory != null) {
      factory.close();
    }
  }

  /** Status the real AOS @HttpExceptionHandler interceptor returns when the method throws. */
  private static int interceptedStatus(RuntimeException thrown) throws Throwable {
    MethodInvocation invocation =
        new MethodInvocation() {
          @Override
          public Object proceed() {
            throw thrown;
          }

          @Override
          public Method getMethod() {
            return null;
          }

          @Override
          public Object[] getArguments() {
            return new Object[0];
          }

          @Override
          public Object getThis() {
            return null;
          }

          @Override
          public AccessibleObject getStaticPart() {
            return null;
          }
        };
    return ((Response) new HttpExceptionHandlerImpl().invoke(invocation)).getStatus();
  }

  private Opportunity persisted(String name) {
    Opportunity opportunity = new Opportunity();
    opportunity.setName(name);
    // Pre-set reference: the in-memory test DB has no CRM sequence configuration, and the real
    // OpportunityManagementRepository.save only generates one when it is missing.
    opportunity.setOpportunitySeq("TEST-" + System.nanoTime());
    inTransaction(
        () -> {
          // Pre-set stage: the in-memory test DB has no AppCrm default status either.
          OpportunityStatus status = new OpportunityStatus();
          status.setName("New");
          opportunity.setOpportunityStatus(JPA.save(status));
          JPA.save(opportunity);
        });
    return opportunity;
  }

  /** Another user's committed rename, done behind the back of our managed (now stale) entity. */
  private void colleagueRenames(Long id, String name) {
    inTransaction(
        () ->
            JPA.em()
                .createNativeQuery(
                    "update crm_opportunity set name = :name, version = version + 1 where id = :id")
                .setParameter("name", name)
                .setParameter("id", id)
                .executeUpdate());
  }

  private static List<String> causeTypes(Throwable error) {
    List<String> types = new ArrayList<>();
    for (Throwable t = error; t != null; t = t.getCause() == t ? null : t.getCause()) {
      types.add(t.getClass().getName());
    }
    return types;
  }

  private static Opportunity reloaded(Long id) {
    JPA.em().clear();
    return JPA.find(Opportunity.class, id);
  }

  @Test
  void interceptorStatusForEachConflictPath() throws Throwable {
    Opportunity opportunity = persisted("Interceptor mapping");
    // Pre-check: native ConflictChecker -> ClientErrorException -> 409.
    ClientErrorException stale =
        assertThrows(
            ClientErrorException.class,
            () -> ConflictChecker.checkVersion(opportunity, opportunity.getVersion() + 1));
    assertEquals(409, interceptedStatus(stale));
    // Commit-time translation -> 409.
    assertEquals(
        409,
        interceptedStatus(
            new ClientErrorException(OptimisticLockConflicts.MESSAGE, Response.Status.CONFLICT)));
    // Why the old code and untranslated JPA failures were wrong: both are answered with 500.
    assertEquals(
        500,
        interceptedStatus(
            new WebApplicationException(OptimisticLockConflicts.MESSAGE, Response.Status.CONFLICT)));
    assertEquals(500, interceptedStatus(new OptimisticLockException("row changed")));
  }

  @Test
  void realServiceBoundaryRaisesAnOptimisticLockFailureAtCommit() {
    Opportunity opportunity = persisted("Boundary probe");
    Long id = opportunity.getId();
    int version = opportunity.getVersion();
    colleagueRenames(id, "Colleague wins");

    ConflictChecker.checkVersion(opportunity, version); // our stale view still passes the pre-check
    opportunity.setName("Lost update");
    RuntimeException raw =
        assertThrows(
            RuntimeException.class,
            () -> Beans.get(OpportunityService.class).saveOpportunity(opportunity));
    List<String> chain = causeTypes(raw);
    System.out.println("IOETI_OPTIMISTIC_LOCK_CHAIN " + chain);
    assertTrue(
        chain.contains(OptimisticLockException.class.getName()),
        "expected a JPA OptimisticLockException in " + chain);

    Opportunity stored = reloaded(id);
    assertEquals("Colleague wins", stored.getName());
    assertEquals(version + 1, stored.getVersion());
  }

  @Test
  void concurrentCommitIsAnsweredWith409AndNotPersisted() {
    Opportunity opportunity = persisted("Hotel ISO 9001 audit");
    Long id = opportunity.getId();
    int version = opportunity.getVersion();
    colleagueRenames(id, "Renamed by colleague");

    ConflictChecker.checkVersion(opportunity, version);
    opportunity.setName("Lost update");
    ClientErrorException error =
        assertThrows(
            ClientErrorException.class,
            () ->
                OptimisticLockConflicts.translate(
                    () -> Beans.get(OpportunityService.class).saveOpportunity(opportunity)));
    assertEquals(409, error.getResponse().getStatus());
    assertEquals(OptimisticLockConflicts.MESSAGE, error.getMessage());

    Opportunity stored = reloaded(id);
    assertEquals("Renamed by colleague", stored.getName());
    assertEquals(version + 1, stored.getVersion());
  }
}
