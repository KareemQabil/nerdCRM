package com.ioeti.admin.service;

import com.axelor.apps.base.db.Sequence;
import com.axelor.apps.base.db.SequenceLettersTypeSelect;
import com.axelor.apps.base.db.SequenceTypeSelect;
import com.axelor.apps.base.db.SequenceVersion;
import com.axelor.apps.base.service.app.AppBaseService;
import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.User;
import com.axelor.db.JPA;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.google.inject.persist.Transactional;
import com.ioeti.core.api.ApiException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * How the records people create are numbered (native {@code Sequence}), for the record types the
 * platform creates. Some come with the native app data; field visits do not (their sequence ships only in
 * the native demo data), so an administrator sets the prefix here. No format is chosen for the company.
 */
public class Numbering {

  /** The record types the platform creates, by native sequence code. */
  public static final String[][] KINDS = {
    {"partner", "Accounts"}, {"opportunity", "Opportunities"}, {"saleOrder", "Quotations"}, {"customerContract", "Contracts"},
    {"project", "Engagements"}, {"intervention", "Field visits"}, {"qualityImprovement", "Quality improvements"},
  };
  static final Pattern PREFIX = Pattern.compile("[A-Za-z0-9][A-Za-z0-9_/%-]{0,11}");

  public record Entry(String code, String name, boolean configured, Long sequenceId, Integer version, String prefix, Integer padding,
      Long nextNumber, String example) {}

  public List<Entry> list() {
    List<Entry> rows = new ArrayList<>();
    for (String[] kind : KINDS) rows.add(entry(kind[0], kind[1], current(kind[0])));
    return rows;
  }

  /** Sets up numbering for a record type that has none, or changes the prefix and padding of the current one. */
  @Transactional(rollbackOn = {Exception.class})
  public Entry set(String code, Integer version, String rawPrefix, Integer padding) {
    String name = nameOf(code);
    String prefix = rawPrefix == null ? "" : rawPrefix.strip();
    if (!PREFIX.matcher(prefix).matches()) {
      throw ApiException.invalidField("prefix", "FORMAT", "Use 1 to 12 letters, digits or - _ / (and %YY for the year).");
    }
    int digits = padding == null ? 4 : padding;
    if (digits < 1 || digits > 10) throw ApiException.invalidField("padding", "RANGE", "Use 1 to 10 digits.");
    Sequence sequence = current(code);
    List<String> changes = new ArrayList<>();
    if (sequence == null) {
      sequence = new Sequence();
      sequence.setCodeSelect(code);
      sequence.setName(name);
      sequence.setSequenceTypeSelect(SequenceTypeSelect.NUMBERS);
      sequence.setSequenceLettersTypeSelect(SequenceLettersTypeSelect.UPPERCASE);
      sequence.setToBeAdded(1);
      SequenceVersion first = new SequenceVersion();
      User me = AuthUtils.getUser();
      LocalDate today = Beans.get(AppBaseService.class).getTodayDate(me == null ? null : me.getActiveCompany());
      first.setStartDate(today.withDayOfYear(1));
      first.setNextNum(1L);
      sequence.addSequenceVersionListItem(first);
      changes.add("created");
    } else {
      if (version == null || !Objects.equals(sequence.getVersion(), version)) throw ApiException.conflict();
      if (!Objects.equals(sequence.getPrefixe(), prefix)) changes.add("prefix=" + sequence.getPrefixe() + "→" + prefix);
      if (!Objects.equals(sequence.getPadding(), digits)) changes.add("padding=" + sequence.getPadding() + "→" + digits);
    }
    sequence.setPrefixe(prefix);
    sequence.setPadding(digits);
    sequence.setFullName(prefix + " " + name);
    Sequence saved = JPA.save(sequence);
    if (!changes.isEmpty()) Beans.get(AdminService.class).audit("NUMBERING_SET", "NUMBERING", saved.getId(), name, changes);
    return entry(code, name, saved);
  }

  private static String nameOf(String code) {
    for (String[] kind : KINDS) if (kind[0].equals(code)) return kind[1];
    throw ApiException.notFound();
  }

  /** The sequence used for new records: the caller's company's own, else the shared one. */
  private static Sequence current(String code) {
    User me = AuthUtils.getUser();
    if (me != null && me.getActiveCompany() != null) {
      Sequence own = Query.of(Sequence.class).filter("self.codeSelect = ?1 AND self.company = ?2", code, me.getActiveCompany()).fetchOne();
      if (own != null) return own;
    }
    return Query.of(Sequence.class).filter("self.codeSelect = ?1 AND self.company IS NULL", code).order("id").fetchOne();
  }

  private static Entry entry(String code, String name, Sequence s) {
    if (s == null) return new Entry(code, name, false, null, null, null, null, null, null);
    Long next = s.getSequenceVersionList() == null ? 1L : s.getSequenceVersionList().stream()
        .map(SequenceVersion::getNextNum).filter(Objects::nonNull).max(Long::compare).orElse(1L);
    int digits = s.getPadding() == null ? 4 : s.getPadding();
    String prefix = s.getPrefixe() == null ? "" : s.getPrefixe();
    String year = String.valueOf(LocalDate.now().getYear() % 100);
    String example = prefix.replace("%YY", year).replace("%YYYY", String.valueOf(LocalDate.now().getYear()))
        + String.format("%0" + digits + "d", next);
    return new Entry(code, name, true, s.getId(), s.getVersion(), s.getPrefixe(), s.getPadding(), next, example);
  }
}
