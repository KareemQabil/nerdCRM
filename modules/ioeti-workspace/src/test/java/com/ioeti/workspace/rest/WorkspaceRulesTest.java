package com.ioeti.workspace.rest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.ioeti.core.api.ApiException;
import org.junit.jupiter.api.Test;

class WorkspaceRulesTest {

  @Test
  void reviewReasonsAndStatusesUseStableNames() {
    assertEquals(1, WorkspaceRestController.select("reason", "PRICING", WorkspaceRestController.REASONS));
    assertEquals("CHANGES_REQUESTED", WorkspaceRestController.name(2, WorkspaceRestController.REVIEW_STATUSES));
    assertEquals("WITHDRAWN", WorkspaceRestController.name(3, WorkspaceRestController.REVIEW_EVENTS));
    assertNull(WorkspaceRestController.name(4, WorkspaceRestController.REVIEW_STATUSES));
  }

  @Test
  void anUnknownReasonIsAFieldError() {
    assertEquals("reason", assertThrows(ApiException.class,
        () -> WorkspaceRestController.select("reason", "BECAUSE", WorkspaceRestController.REASONS)).fieldErrors().get(0).field());
  }
}
