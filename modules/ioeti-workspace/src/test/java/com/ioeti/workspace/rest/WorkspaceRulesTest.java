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
    // D-11: a quotation review is decided by the tier's approver
    assertEquals("APPROVED", WorkspaceRestController.name(4, WorkspaceRestController.REVIEW_STATUSES));
    assertEquals("REJECTED", WorkspaceRestController.name(5, WorkspaceRestController.REVIEW_EVENTS));
    assertNull(WorkspaceRestController.name(6, WorkspaceRestController.REVIEW_STATUSES));
  }

  @Test
  void anUnknownReasonIsAFieldError() {
    assertEquals("reason", assertThrows(ApiException.class,
        () -> WorkspaceRestController.select("reason", "BECAUSE", WorkspaceRestController.REASONS)).fieldErrors().get(0).field());
  }

  @Test
  void acceptanceKindsAreStableApiValues() {
    assertEquals("SIGNED_QUOTE", WorkspaceRestController.acceptanceKind("SIGNED_QUOTE"));
    assertEquals("PURCHASE_ORDER", WorkspaceRestController.acceptanceKind("PURCHASE_ORDER"));
    ApiException e = assertThrows(ApiException.class, () -> WorkspaceRestController.acceptanceKind("EMAIL"));
    assertEquals("kind", e.fieldErrors().get(0).field());
  }
}
