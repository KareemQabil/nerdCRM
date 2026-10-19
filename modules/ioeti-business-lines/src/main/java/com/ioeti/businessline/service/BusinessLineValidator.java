package com.ioeti.businessline.service;

import com.ioeti.businessline.db.BusinessLine;
import com.ioeti.businessline.db.repo.BusinessLineRepository;
import com.ioeti.core.text.ArabicTextNormalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Domain rules for {@link BusinessLine}. Pure Java (no database access) so it can be unit tested
 * and reused by the repository, imports and APIs.
 */
public final class BusinessLineValidator {

  public static final Pattern CODE_PATTERN = Pattern.compile("^[A-Z][A-Z0-9_]{1,19}$");

  private static final Set<Integer> STATUSES =
      Set.of(
          BusinessLineRepository.STATUS_IN_SETUP,
          BusinessLineRepository.STATUS_ACTIVE,
          BusinessLineRepository.STATUS_SUSPENDED);

  private BusinessLineValidator() {}

  /** Trims names and upper-cases the code. Call before {@link #validate}. */
  public static void normalize(BusinessLine line) {
    if (line.getCode() != null) {
      line.setCode(line.getCode().trim().toUpperCase(Locale.ROOT));
    }
    if (line.getNameEn() != null) {
      line.setNameEn(line.getNameEn().trim());
    }
    if (line.getNameAr() != null) {
      line.setNameAr(line.getNameAr().trim());
    }
  }

  /** Returns the list of rule violations; empty when the business line is valid. */
  public static List<String> validate(BusinessLine line) {
    List<String> errors = new ArrayList<>();
    if (line.getCode() == null || !CODE_PATTERN.matcher(line.getCode()).matches()) {
      errors.add(
          "Code must be 2-20 characters: an upper-case letter followed by letters, digits or '_'.");
    }
    if (isBlank(line.getNameEn())) {
      errors.add("English name is required.");
    }
    if (isBlank(line.getNameAr())) {
      errors.add("Arabic name is required.");
    } else if (!ArabicTextNormalizer.containsArabic(line.getNameAr())) {
      errors.add("Arabic name must contain Arabic letters.");
    }
    if (line.getStatusSelect() == null || !STATUSES.contains(line.getStatusSelect())) {
      errors.add("Status must be In setup, Active or Suspended.");
    }
    return errors;
  }

  /** Only active business lines can receive new commercial records (opportunities, quotes...). */
  public static boolean acceptsNewRecords(BusinessLine line) {
    return line != null
        && Integer.valueOf(BusinessLineRepository.STATUS_ACTIVE).equals(line.getStatusSelect());
  }

  private static boolean isBlank(String value) {
    return value == null || value.isBlank();
  }
}
