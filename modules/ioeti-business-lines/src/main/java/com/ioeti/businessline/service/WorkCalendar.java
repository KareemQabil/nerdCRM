package com.ioeti.businessline.service;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * D-12 (signed 2026-10-25): response targets are counted in working hours. The working days, the hours of a working day and
 * the public holidays are the owners' {@code work.calendar} policy; this only does the arithmetic. Times are the server's
 * wall-clock times, as everywhere else in the platform.
 */
public record WorkCalendar(Set<DayOfWeek> days, LocalTime start, LocalTime end, Set<LocalDate> holidays) {

  static final Map<String, DayOfWeek> DAYS = Map.of("SAT", DayOfWeek.SATURDAY, "SUN", DayOfWeek.SUNDAY, "MON", DayOfWeek.MONDAY,
      "TUE", DayOfWeek.TUESDAY, "WED", DayOfWeek.WEDNESDAY, "THU", DayOfWeek.THURSDAY, "FRI", DayOfWeek.FRIDAY);
  /** No calendar the policy validator accepts needs more than ten years to place a target; past that, something is wrong. */
  static final int MAX_DAYS = 3660;

  public WorkCalendar {
    if (days == null || days.isEmpty()) throw new IllegalArgumentException("A calendar needs at least one working day.");
    if (start == null || end == null || !end.isAfter(start)) throw new IllegalArgumentException("A working day must end after it starts.");
    days = Set.copyOf(days);
    holidays = holidays == null ? Set.of() : Set.copyOf(holidays);
  }

  /** The calendar a {@code work.calendar} policy value describes. */
  public static WorkCalendar of(JsonNode value) {
    Set<DayOfWeek> days = EnumSet.noneOf(DayOfWeek.class);
    value.path("days").forEach(d -> days.add(DAYS.get(d.asText())));
    days.remove(null);
    Set<LocalDate> holidays = new HashSet<>();
    value.path("holidays").forEach(d -> holidays.add(LocalDate.parse(d.asText())));
    return new WorkCalendar(days, LocalTime.parse(value.path("start").asText()), LocalTime.parse(value.path("end").asText()), holidays);
  }

  public boolean isWorkingDay(LocalDate date) {
    return days.contains(date.getDayOfWeek()) && !holidays.contains(date);
  }

  /** The moment {@code hours} working hours after {@code from}; time outside working hours does not count. */
  public LocalDateTime plusWorkingHours(LocalDateTime from, int hours) {
    if (hours < 0) throw new IllegalArgumentException("hours");
    long remaining = hours * 60L;
    LocalDateTime cursor = from;
    for (int i = 0; i <= MAX_DAYS; i++) {
      LocalDate date = cursor.toLocalDate();
      LocalTime time = cursor.toLocalTime();
      if (!isWorkingDay(date) || !time.isBefore(end)) {
        cursor = date.plusDays(1).atTime(start);
        continue;
      }
      if (time.isBefore(start)) cursor = date.atTime(start);
      long available = Duration.between(cursor, date.atTime(end)).toMinutes();
      if (remaining <= available) return cursor.plusMinutes(remaining);
      remaining -= available;
      cursor = date.plusDays(1).atTime(start);
    }
    throw new IllegalStateException("The calendar has no working time within ten years.");
  }
}
