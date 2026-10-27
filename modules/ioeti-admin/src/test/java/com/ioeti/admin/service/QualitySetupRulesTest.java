package com.ioeti.admin.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.axelor.apps.quality.db.QIDetection;
import com.axelor.apps.quality.db.QIStatus;
import com.axelor.apps.quality.db.repo.QIDetectionRepository;
import com.ioeti.core.api.ApiException;
import java.util.Arrays;
import org.junit.jupiter.api.Test;

/** The quality set-up (A8, A11) and record numbering (A7) rules, without a database. */
class QualitySetupRulesTest {

  @Test
  void setUpListsAreAddressedByStablePaths() {
    assertEquals(QualitySetup.Kind.METHOD, QualitySetup.Kind.of("methods"));
    assertEquals(QualitySetup.Kind.CAUSE, QualitySetup.Kind.of("causes"));
    assertEquals("QI_PROCESS", QualitySetup.Kind.of("processes").subject);
    assertEquals(404, assertThrows(ApiException.class, () -> QualitySetup.Kind.of("branches")).status());
  }

  @Test
  void aStatusKindFollowsTheNativeFlags() {
    QIStatus status = new QIStatus();
    assertEquals("OPEN", QualitySetup.statusKind(status));
    status.setIsClosedStatus(true);
    assertEquals("CLOSED", QualitySetup.statusKind(status));
    status.setIsCancelledStatus(true);
    assertEquals("CANCELLED", QualitySetup.statusKind(status)); // cancelled wins over closed
  }

  @Test
  void aDetectionOriginFollowsTheNativeOrigin() {
    QIDetection detection = new QIDetection();
    assertEquals("INTERNAL", QualitySetup.origin(detection)); // the native default
    detection.setOrigin(null);
    assertEquals("INTERNAL", QualitySetup.origin(detection)); // the generated getter falls back to the default
    detection.setOrigin(QIDetectionRepository.ORIGIN_SUPPLIER);
    assertEquals("SUPPLIER", QualitySetup.origin(detection));
    detection.setOrigin(QIDetectionRepository.ORIGIN_INTERNAL);
    assertEquals("INTERNAL", QualitySetup.origin(detection));
  }

  @Test
  void numberingPrefixesAreShortAndPlain() {
    assertTrue(Numbering.PREFIX.matcher("VIS-").matches());
    assertTrue(Numbering.PREFIX.matcher("Q%YY/").matches());
    assertFalse(Numbering.PREFIX.matcher("-VIS").matches());
    assertFalse(Numbering.PREFIX.matcher("زيارة").matches());
    assertFalse(Numbering.PREFIX.matcher("ABCDEFGHIJKLM").matches());
    assertFalse(Numbering.PREFIX.matcher("").matches());
  }

  @Test
  void onlyQualityNumberingIsPerCompanyAndEveryKindIsListed() {
    assertEquals(java.util.Set.of("qualityImprovement"), Numbering.PER_COMPANY);
    assertTrue(Arrays.stream(Numbering.KINDS).anyMatch(k -> k[0].equals("intervention")));
    assertTrue(Numbering.PER_COMPANY.stream().allMatch(code -> Arrays.stream(Numbering.KINDS).anyMatch(k -> k[0].equals(code))));
  }
}
