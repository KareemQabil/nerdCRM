package com.ioeti.businessline.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** D-12: response targets in working hours (an Egyptian week here: Sunday to Thursday, 09:00 to 17:00). */
class WorkCalendarTest {

  static final WorkCalendar WEEK = new WorkCalendar(
      Set.of(DayOfWeek.SUNDAY, DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY),
      LocalTime.of(9, 0), LocalTime.of(17, 0), Set.of(LocalDate.of(2026, 11, 3)));

  private static LocalDateTime at(int month, int day, int hour, int minute) {
    return LocalDateTime.of(2026, month, day, hour, minute);
  }

  @Test
  void withinOneWorkingDay() {
    // Monday 2 November 2026, 10:30 + 4 h
    assertEquals(at(11, 2, 14, 30), WEEK.plusWorkingHours(at(11, 2, 10, 30), 4));
  }

  @Test
  void theRestCarriesToTheNextWorkingDaySkippingAHoliday() {
    // Monday 15:00 + 4 h: 2 h on Monday, Tuesday 3 Nov is a holiday, 2 h on Wednesday
    assertEquals(at(11, 4, 11, 0), WEEK.plusWorkingHours(at(11, 2, 15, 0), 4));
  }

  @Test
  void aLeadReceivedOutsideWorkingHoursStartsCountingWhenTheDayStarts() {
    // Thursday 29 October after hours: Friday and Saturday are off, Sunday 09:00 + 2 h
    assertEquals(at(11, 1, 11, 0), WEEK.plusWorkingHours(at(10, 29, 20, 15), 2));
    // the same day, before it starts
    assertEquals(at(11, 1, 10, 0), WEEK.plusWorkingHours(at(11, 1, 7, 45), 1));
  }

  @Test
  void aTargetEndingExactlyAtTheEndOfTheDayStaysOnThatDay() {
    assertEquals(at(11, 1, 17, 0), WEEK.plusWorkingHours(at(11, 1, 9, 0), 8));
    assertEquals(at(11, 2, 10, 0), WEEK.plusWorkingHours(at(11, 1, 9, 0), 9));
  }

  @Test
  void longTargetsSpanWeeks() {
    // 40 working hours from Sunday 09:00 is the end of Thursday; a holiday that week pushes it to the next Sunday
    assertEquals(at(10, 29, 17, 0), WEEK.plusWorkingHours(at(10, 25, 9, 0), 40));
    assertEquals(at(11, 8, 17, 0), WEEK.plusWorkingHours(at(11, 1, 9, 0), 40));
  }

  @Test
  void workingDaysAndHolidays() {
    assertTrue(WEEK.isWorkingDay(LocalDate.of(2026, 11, 1)));
    assertFalse(WEEK.isWorkingDay(LocalDate.of(2026, 10, 30)));
    assertFalse(WEEK.isWorkingDay(LocalDate.of(2026, 11, 3)));
  }

  @Test
  void readsThePolicyValue() throws Exception {
    WorkCalendar c = WorkCalendar.of(new ObjectMapper().readTree(
        "{\"days\":[\"SUN\",\"MON\",\"TUE\",\"WED\",\"THU\"],\"start\":\"09:00\",\"end\":\"17:00\",\"holidays\":[\"2026-11-03\"]}"));
    assertEquals(WEEK, c);
    WorkCalendar noHolidays = WorkCalendar.of(new ObjectMapper().readTree("{\"days\":[\"SAT\"],\"start\":\"08:30\",\"end\":\"12:00\"}"));
    assertEquals(Set.of(), noHolidays.holidays());
  }

  @Test
  void anImpossibleCalendarIsRefused() {
    assertThrows(IllegalArgumentException.class, () -> new WorkCalendar(Set.of(), LocalTime.of(9, 0), LocalTime.of(17, 0), Set.of()));
    assertThrows(IllegalArgumentException.class, () -> new WorkCalendar(Set.of(DayOfWeek.MONDAY), LocalTime.of(17, 0), LocalTime.of(9, 0), Set.of()));
  }
}
