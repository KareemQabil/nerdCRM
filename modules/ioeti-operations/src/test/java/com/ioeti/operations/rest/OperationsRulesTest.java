package com.ioeti.operations.rest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.axelor.apps.project.db.ProjectTask;
import com.axelor.apps.project.db.TaskStatus;
import com.ioeti.core.api.ApiException;
import com.ioeti.operations.db.repo.HandoverRequestRepository;
import com.ioeti.operations.service.OperationsService;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

class OperationsRulesTest {

  @Test
  void onlySubmittedAndReworkHandoversAreOpen() {
    assertTrue(OperationsService.isOpen(HandoverRequestRepository.STATUS_SUBMITTED));
    assertTrue(OperationsService.isOpen(HandoverRequestRepository.STATUS_REWORK_REQUESTED));
    assertFalse(OperationsService.isOpen(HandoverRequestRepository.STATUS_ACCEPTED));
    assertFalse(OperationsService.isOpen(HandoverRequestRepository.STATUS_REJECTED));
  }

  @Test
  void aTaskIsDoneByCompletedStatusOrFullProgress() {
    ProjectTask task = new ProjectTask();
    assertFalse(OperationsService.isDone(task));
    task.setProgress(new BigDecimal("100"));
    assertTrue(OperationsService.isDone(task));
    ProjectTask other = new ProjectTask();
    TaskStatus done = new TaskStatus();
    done.setIsCompleted(true);
    other.setStatus(done);
    assertTrue(OperationsService.isDone(other));
  }

  @Test
  void reasonsAndStatusesUseStableNames() {
    assertEquals(2, OperationsRestController.select("reason", "MISSING_DOCUMENTS", OperationsRestController.REASONS));
    assertEquals("REWORK_REQUESTED", OperationsRestController.name(2, OperationsRestController.STATUSES));
    assertEquals("OWNER_CHANGED", OperationsRestController.name(8, OperationsRestController.EVENTS));
    assertNull(OperationsRestController.name(9, OperationsRestController.EVENTS));
    assertEquals("reason", assertThrows(ApiException.class,
        () -> OperationsRestController.select("reason", "BORED", OperationsRestController.REASONS)).fieldErrors().get(0).field());
  }
}
