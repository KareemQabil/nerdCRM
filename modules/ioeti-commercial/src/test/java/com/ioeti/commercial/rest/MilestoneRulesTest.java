package com.ioeti.commercial.rest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.ioeti.core.api.ApiException;
import java.math.BigDecimal;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

class MilestoneRulesTest {

  @Test
  void percentageIsAboveZeroAtMostHundredWithTwoDecimals() {
    assertEquals(new BigDecimal("30"), MilestoneRestController.checkedPercentage(new BigDecimal("30")));
    assertEquals(new BigDecimal("100.00"), MilestoneRestController.checkedPercentage(new BigDecimal("100.00")));
    assertEquals(new BigDecimal("33.33"), MilestoneRestController.checkedPercentage(new BigDecimal("33.33")));
    for (String bad : new String[] {"0", "-5", "100.01", "33.333"}) {
      ApiException e = assertThrows(ApiException.class,
          () -> MilestoneRestController.checkedPercentage(new BigDecimal(bad)), bad);
      assertEquals("percentage", e.fieldErrors().get(0).field());
    }
    assertThrows(ApiException.class, () -> MilestoneRestController.checkedPercentage(null));
  }

  @Test
  void dueDateIsAnIsoDateInARealisticRange() {
    assertEquals(LocalDate.of(2027, 3, 31), MilestoneRestController.checkedDueDate("2027-03-31"));
    for (String bad : new String[] {null, "", "31/03/2027", "2027-02-30", "1999-12-31", "2101-01-01"}) {
      ApiException e = assertThrows(ApiException.class, () -> MilestoneRestController.checkedDueDate(bad), String.valueOf(bad));
      assertEquals("dueDate", e.fieldErrors().get(0).field());
    }
  }

  @Test
  void titleIsTrimmedAndBounded() {
    assertEquals("Signature", MilestoneRestController.checkedTitle("  Signature "));
    assertThrows(ApiException.class, () -> MilestoneRestController.checkedTitle("ab"));
    assertThrows(ApiException.class, () -> MilestoneRestController.checkedTitle("x".repeat(121)));
  }
}
