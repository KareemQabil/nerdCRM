package com.ioeti.training.rest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.ioeti.core.api.ApiException;
import com.ioeti.training.db.TrainingEnrollment;
import com.ioeti.training.db.repo.TrainingEnrollmentRepository;
import com.ioeti.training.service.TrainingService.Placement;
import com.ioeti.training.service.TrainingService;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

class TrainingRulesTest {

  @Test
  void confirmedWhileSeatsAreLeftThenWaitlistedInOrder() {
    assertEquals(new Placement(TrainingEnrollmentRepository.STATUS_CONFIRMED, null), TrainingService.place(0, 2, 0));
    assertEquals(new Placement(TrainingEnrollmentRepository.STATUS_CONFIRMED, null), TrainingService.place(1, 2, 0));
    assertEquals(new Placement(TrainingEnrollmentRepository.STATUS_WAITLISTED, 1), TrainingService.place(2, 2, 0));
    assertEquals(new Placement(TrainingEnrollmentRepository.STATUS_WAITLISTED, 4), TrainingService.place(2, 2, 3));
  }

  @Test
  void codesAreNormalizedAndBounded() {
    assertEquals("ISO-9001-C1", TrainingRestController.checkedCode(" iso-9001-c1 "));
    for (String bad : new String[] {null, "", "A", "-AB", "AB CD", "X".repeat(31)}) {
      ApiException e = assertThrows(ApiException.class, () -> TrainingRestController.checkedCode(bad), String.valueOf(bad));
      assertEquals("code", e.fieldErrors().get(0).field());
    }
  }

  @Test
  void datesAndTextAreValidatedAsFieldErrors() {
    assertEquals(LocalDate.of(2026, 11, 1), TrainingRestController.checkedDate("startDate", "2026-11-01"));
    assertNull(TrainingRestController.checkedDate("startDate", " "));
    assertEquals("startDate", assertThrows(ApiException.class,
        () -> TrainingRestController.checkedDate("startDate", "01/11/2026")).fieldErrors().get(0).field());
    assertNull(TrainingRestController.checkedText("location", "  ", 255, false));
    assertEquals("name", assertThrows(ApiException.class,
        () -> TrainingRestController.checkedText("name", "", 255, true)).fieldErrors().get(0).field());
    assertEquals("TOO_LONG", assertThrows(ApiException.class,
        () -> TrainingRestController.checkedText("name", "x".repeat(256), 255, true)).fieldErrors().get(0).code());
  }

  @Test
  void statusesAreStableApiValues() {
    assertEquals("WAITLISTED", TrainingRestController.status(2, "CONFIRMED", "WAITLISTED", "CANCELLED"));
    assertNull(TrainingRestController.status(null, "A"));
    assertNull(TrainingRestController.status(9, "A"));
  }
}
