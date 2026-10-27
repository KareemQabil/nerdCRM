package com.ioeti.core.api;

import com.axelor.db.JPA;
import com.axelor.db.Model;
import jakarta.persistence.LockModeType;

/**
 * Row locks for commands that change a record and, through it, its parent.
 *
 * <p>A command carries the version of the record it changes (an enrolment, an application, an
 * installment). Its service also locks the parent (the cohort, the job order, the commitment) so that
 * writers on the same parent take turns. Locking the parent instance loaded at the start of the request
 * would compare its version too: two users changing different children at the same moment would get a
 * 409 for a version neither of them sent. {@link #parent} reloads the parent under the lock instead, so
 * only a stale version of the record the caller actually sent answers 409.
 */
public final class Locks {

  private Locks() {}

  /** Waits for the parent row, reloads it and bumps its version (writers on one parent take turns). */
  public static <T extends Model> T parent(T record) {
    JPA.em().refresh(record, LockModeType.PESSIMISTIC_WRITE);
    JPA.em().lock(record, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    return record;
  }

  /**
   * Holds a PostgreSQL transaction lock on a business key (for example a bank reference) until commit, so
   * a duplicate check on that key sees the other writer's row instead of failing on the unique index.
   */
  public static void key(String namespace, String value) {
    // the function returns void, which has no JDBC mapping: select a constant beside it
    JPA.em().createNativeQuery("SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(?1))) AS held")
        .setParameter(1, namespace + ":" + value)
        .getSingleResult();
  }
}
