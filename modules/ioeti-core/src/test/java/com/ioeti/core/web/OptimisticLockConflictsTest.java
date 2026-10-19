package com.ioeti.core.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import jakarta.persistence.EntityExistsException;
import jakarta.persistence.OptimisticLockException;
import jakarta.persistence.PersistenceException;
import jakarta.persistence.RollbackException;
import jakarta.ws.rs.ClientErrorException;
import org.hibernate.StaleObjectStateException;
import org.hibernate.exception.ConstraintViolationException;
import org.junit.jupiter.api.Test;

class OptimisticLockConflictsTest {

  private static RuntimeException thrownBy(RuntimeException failure) {
    return assertThrows(
        RuntimeException.class,
        () ->
            OptimisticLockConflicts.translate(
                () -> {
                  throw failure;
                }));
  }

  @Test
  void commitTimeOptimisticLockFailureIsAConflictWithAFixedMessage() {
    RuntimeException failure =
        new RollbackException(
            "Error while committing the transaction",
            new OptimisticLockException(
                "Row was updated or deleted by another transaction [crm_opportunity#42]"));
    RuntimeException error = thrownBy(failure);
    assertTrue(error instanceof ClientErrorException);
    assertEquals(409, ((ClientErrorException) error).getResponse().getStatus());
    // The internal Hibernate message (table, id) is never echoed to the client.
    assertEquals(OptimisticLockConflicts.MESSAGE, error.getMessage());
  }

  @Test
  void hibernateStaleObjectStateIsRecognisedWhenNested() {
    assertTrue(
        OptimisticLockConflicts.isOptimisticLockFailure(
            new PersistenceException(new StaleObjectStateException("Opportunity", 42L))));
  }

  @Test
  void otherPersistenceFailuresAreNotConflicts() {
    RuntimeException constraint =
        new PersistenceException(
            new ConstraintViolationException("duplicate key", null, "uk_code"));
    assertSame(constraint, thrownBy(constraint));

    RuntimeException rollback =
        new RollbackException("commit failed", new EntityExistsException("exists"));
    assertSame(rollback, thrownBy(rollback));

    IllegalStateException plain = new IllegalStateException("validation");
    assertSame(plain, thrownBy(plain));
    assertFalse(OptimisticLockConflicts.isOptimisticLockFailure(plain));
  }

  @Test
  void successfulWriteIsUntouched() {
    int[] calls = {0};
    OptimisticLockConflicts.translate(() -> calls[0]++);
    assertEquals(1, calls[0]);
  }
}
