package com.ioeti.core.policy;

import java.util.List;

/**
 * What can be set for one business rule: its key, the owner decision it comes from, what it applies to
 * (scope), and the fields of its value. A definition describes the knob only; the value is the owners'
 * and is never shipped.
 *
 * @param allowsDefault whether a value without a scope applies where no scoped value is set
 */
public record PolicyDefinition(String key, String decision, String area, Scope scope, boolean allowsDefault, List<Field> fields,
    String titleAr, String titleEn, String helpAr, String helpEn) {

  /** What a policy can be set for. */
  public enum Scope {
    /** One value for the whole company. */
    NONE,
    /** A business line code, e.g. ISO9001. */
    BUSINESS_LINE,
    /** A certification scheme (standard) code, e.g. ISO 9001:2015. */
    SCHEME,
    /** A training course id. */
    COURSE,
    /** A client account id (its agreement with IOETI). */
    CLIENT_AGREEMENT,
    /** A lead source name. */
    LEAD_SOURCE,
    /** A kind of personal data with a retention period. */
    DATA_TYPE
  }

  /** The kinds of value a field can hold. */
  public enum Kind { PERCENT, DECIMAL, INTEGER, BOOLEAN, CHOICE, MULTI_CHOICE, TEXT, TIME, DATE_LIST, LIST }

  /**
   * One field of a policy value.
   *
   * @param options the allowed values of a CHOICE / MULTI_CHOICE field
   * @param min the lowest INTEGER / DECIMAL value (null: none)
   * @param max the highest INTEGER / DECIMAL value, or the most items of a LIST / characters of a TEXT
   * @param items the fields of each item of a LIST field
   */
  public record Field(String name, Kind kind, boolean required, List<String> options, Integer min, Integer max, List<Field> items,
      String titleAr, String titleEn) {

    static Field of(String name, Kind kind, boolean required, String titleAr, String titleEn) {
      return new Field(name, kind, required, List.of(), null, null, List.of(), titleAr, titleEn);
    }

    static Field integer(String name, boolean required, int min, int max, String titleAr, String titleEn) {
      return new Field(name, Kind.INTEGER, required, List.of(), min, max, List.of(), titleAr, titleEn);
    }

    static Field choice(String name, boolean required, List<String> options, String titleAr, String titleEn) {
      return new Field(name, Kind.CHOICE, required, options, null, null, List.of(), titleAr, titleEn);
    }

    static Field multi(String name, boolean required, List<String> options, String titleAr, String titleEn) {
      return new Field(name, Kind.MULTI_CHOICE, required, options, null, null, List.of(), titleAr, titleEn);
    }

    static Field text(String name, boolean required, int max, String titleAr, String titleEn) {
      return new Field(name, Kind.TEXT, required, List.of(), null, max, List.of(), titleAr, titleEn);
    }

    static Field list(String name, boolean required, int maxItems, List<Field> items, String titleAr, String titleEn) {
      return new Field(name, Kind.LIST, required, List.of(), null, maxItems, items, titleAr, titleEn);
    }
  }
}
