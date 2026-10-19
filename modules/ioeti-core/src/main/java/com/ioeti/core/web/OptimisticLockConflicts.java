package com.ioeti.core.web;

import jakarta.persistence.OptimisticLockException;
import jakarta.ws.rs.ClientErrorException;
import jakarta.ws.rs.core.Response;
import org.hibernate.StaleObjectStateException;

/**
 * Turns a genuine simultaneous-write conflict, detected by Hibernate's versioned UPDATE when a
 * write commits, into HTTP 409.
 *
 * <p>Stale client versions known before writing are a different case and are rejected with the
 * native {@code com.axelor.utils.api.ConflictChecker#checkVersion} (also 409). This class covers
 * the remaining window: another transaction commits between that check and our commit. The AOS
 * {@code @HttpExceptionHandler} interceptor only answers {@link ClientErrorException} with 409; it
 * would answer the raw JPA exception with 500 and its internal message.
 *
 * <p>Only optimistic-lock failures are translated. Every other persistence error propagates
 * unchanged.
 */
public final class OptimisticLockConflicts {

  public static final String MESSAGE = "Record has changed; refresh and retry.";

  private OptimisticLockConflicts() {}

  /**
   * Runs a write that commits inside {@code write} (for example a {@code @Transactional} service
   * call made outside any enclosing transaction) and answers an optimistic-lock failure with 409.
   */
  public static void translate(Runnable write) {
    try {
      write.run();
    } catch (RuntimeException e) {
      if (isOptimisticLockFailure(e)) {
        throw new ClientErrorException(MESSAGE, Response.Status.CONFLICT);
      }
      throw e;
    }
  }

  /**
   * True when the cause chain holds a JPA {@link OptimisticLockException} (how Hibernate reports a
   * failed version check through JPA, possibly wrapped in a {@code RollbackException} at commit)
   * or Hibernate's own {@link StaleObjectStateException}.
   */
  static boolean isOptimisticLockFailure(Throwable error) {
    for (Throwable t = error; t != null; t = t.getCause() == t ? null : t.getCause()) {
      if (t instanceof OptimisticLockException || t instanceof StaleObjectStateException) {
        return true;
      }
    }
    return false;
  }
}
