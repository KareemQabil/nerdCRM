package com.ioeti.businessline.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.ioeti.businessline.db.BusinessLine;
import com.ioeti.businessline.db.repo.BusinessLineRepository;
import java.util.List;
import org.junit.jupiter.api.Test;

class BusinessLineValidatorTest {

  private static BusinessLine line(String code, String en, String ar, Integer status) {
    BusinessLine line = new BusinessLine();
    line.setCode(code);
    line.setNameEn(en);
    line.setNameAr(ar);
    line.setStatusSelect(status);
    return line;
  }

  @Test
  void acceptsAValidLineAfterNormalisation() {
    BusinessLine line = line("  iso9001 ", " ISO 9001 ", "أيزو 9001", 2);
    BusinessLineValidator.normalize(line);
    assertEquals("ISO9001", line.getCode());
    assertEquals("ISO 9001", line.getNameEn());
    assertTrue(BusinessLineValidator.validate(line).isEmpty());
  }

  @Test
  void rejectsBadCodeMissingNamesAndUnknownStatus() {
    List<String> errors = BusinessLineValidator.validate(line("9-bad code", " ", null, 7));
    assertEquals(4, errors.size(), errors.toString());
  }

  @Test
  void requiresArabicLettersInArabicName() {
    List<String> errors = BusinessLineValidator.validate(line("TRAINING", "Training", "Training", 2));
    assertEquals(List.of("Arabic name must contain Arabic letters."), errors);
  }

  @Test
  void onlyActiveLinesAcceptNewRecords() {
    assertTrue(
        BusinessLineValidator.acceptsNewRecords(
            line("A1", "A", "أ", BusinessLineRepository.STATUS_ACTIVE)));
    assertFalse(
        BusinessLineValidator.acceptsNewRecords(
            line("A1", "A", "أ", BusinessLineRepository.STATUS_SUSPENDED)));
    assertFalse(
        BusinessLineValidator.acceptsNewRecords(
            line("A1", "A", "أ", BusinessLineRepository.STATUS_IN_SETUP)));
    assertFalse(BusinessLineValidator.acceptsNewRecords(null));
  }
}
