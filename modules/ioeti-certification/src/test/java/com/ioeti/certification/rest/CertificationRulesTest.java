package com.ioeti.certification.rest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.ioeti.businessline.db.BusinessLine;
import com.ioeti.certification.db.AuditorQualification;
import com.ioeti.certification.service.CertificationService;
import com.ioeti.core.api.ApiException;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

class CertificationRulesTest {

  private static BusinessLine line(long id, String code) {
    BusinessLine line = new BusinessLine();
    line.setId(id);
    line.setCode(code);
    return line;
  }

  private static AuditorQualification qualification(BusinessLine line, String from, String until) {
    AuditorQualification q = new AuditorQualification();
    q.setBusinessLine(line);
    q.setValidFrom(LocalDate.parse(from));
    q.setValidUntil(LocalDate.parse(until));
    return q;
  }

  @Test
  void auditorMustBeQualifiedForTheStandardOnThePlannedDate() {
    BusinessLine iso9001 = line(1, "ISO9001");
    BusinessLine iso22000 = line(2, "ISO22000");
    List<AuditorQualification> qualifications = List.of(qualification(iso9001, "2026-01-01", "2026-12-31"));
    assertTrue(CertificationService.qualified(qualifications, iso9001, LocalDate.parse("2026-01-01")));
    assertTrue(CertificationService.qualified(qualifications, iso9001, LocalDate.parse("2026-12-31")));
    assertFalse(CertificationService.qualified(qualifications, iso9001, LocalDate.parse("2027-01-01")));
    assertFalse(CertificationService.qualified(qualifications, iso22000, LocalDate.parse("2026-06-01")));
    assertFalse(CertificationService.qualified(List.of(), iso9001, LocalDate.parse("2026-06-01")));
  }

  @Test
  void datesAndTextAreFieldErrors() {
    assertEquals(LocalDate.of(2026, 11, 1), CertificationRestController.requiredDate("plannedDate", "2026-11-01"));
    for (String bad : new String[] {null, "", "11/01/2026"}) {
      ApiException e = assertThrows(ApiException.class,
          () -> CertificationRestController.requiredDate("plannedDate", bad), String.valueOf(bad));
      assertEquals("plannedDate", e.fieldErrors().get(0).field());
    }
    assertEquals("TOO_LONG", assertThrows(ApiException.class,
        () -> CertificationRestController.checkedText("statement", "x".repeat(4001), 4000, true)).fieldErrors().get(0).code());
    assertNull(CertificationRestController.checkedText("clause", " ", 20, false));
  }

  @Test
  void stableApiNames() {
    assertEquals("STAGE2", CertificationRestController.name(2, "STAGE1", "STAGE2"));
    assertEquals("OBSERVATION", CertificationRestController.name(3, "MAJOR", "MINOR", "OBSERVATION"));
    assertNull(CertificationRestController.name(0, "A"));
  }
}
