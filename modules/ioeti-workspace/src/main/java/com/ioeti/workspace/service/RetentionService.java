package com.ioeti.workspace.service;

import com.axelor.auth.db.User;
import com.axelor.db.JPA;
import com.google.inject.Inject;
import com.google.inject.persist.Transactional;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.db.PolicyVersion;
import com.ioeti.core.policy.PolicyCatalog;
import com.ioeti.core.policy.PolicyService;
import com.ioeti.workspace.db.RetentionDecision;
import jakarta.persistence.Query;
import java.sql.Date;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * D-07 (signed 2026-10-25): how long personal data is kept is a policy per data type ({@code privacy.retention}, in months).
 * When the period has run out since a record's last activity, the record is listed for review; <b>nothing is removed or
 * changed automatically</b>. A policy owner then decides, one record at a time:
 *
 * <ul>
 *   <li><b>keep</b> it, with a reason and the date to review it again (at most one more period away); or
 *   <li><b>anonymize</b> it: the person's details are overwritten in place, the record and its business history stay.
 *       Offered for leads and candidates only. Trainees, donors and contacts are shared partner records that invoices,
 *       receipts and certificates point to; what accounting must keep about them is not decided, so they can only be kept.
 * </ul>
 *
 * <p>A data type without the policy is never shown as having nothing due: it is reported as not set, and its queue is
 * refused with {@code 422 POLICY_NOT_SET}. Every decision is an append-only row with the policy version it was made under.
 * The queue reads every record whatever its owner or line, so only policy owners see it (checked by the API).
 */
public class RetentionService {

  public static final String KEY = "privacy.retention";
  public static final int PAGE = 200;
  public static final String KEEP = "KEEP";
  public static final String ANONYMIZED = "ANONYMIZED";
  static final String ANONYMIZED_TEXT = "Anonymized";
  static final String LEAD_MODEL = "com.axelor.apps.crm.db.Lead";
  static final String EVENT_MODEL = "com.axelor.apps.crm.db.Event";
  static final String CANDIDATE_MODEL = "com.ioeti.recruitment.db.RecruitmentCandidate";

  /**
   * Each data type as one SQL row source: the record id, its display name and the date of its last activity. The last
   * activity is the latest change of the record itself or of the records that show the relationship is still going on.
   */
  static final Map<String, String> SOURCES = Map.of(
      "LEADS", """
          SELECT l.id AS id, COALESCE(NULLIF(l.full_name, ''), l.name) AS label,
            CAST(GREATEST(COALESCE(l.updated_on, l.created_on),
              (SELECT MAX(COALESCE(e.updated_on, e.created_on)) FROM ical_event e WHERE e.event_lead = l.id)) AS date) AS last
          FROM crm_lead l""",
      "CANDIDATES", """
          SELECT c.id AS id, c.display_name AS label,
            CAST(GREATEST(COALESCE(c.updated_on, c.created_on),
              (SELECT MAX(COALESCE(a.updated_on, a.created_on)) FROM ioeti_rec_application a WHERE a.candidate = c.id),
              (SELECT MAX(COALESCE(p.updated_on, p.created_on)) FROM ioeti_rec_candidate_private p WHERE p.candidate = c.id)) AS date) AS last
          FROM ioeti_rec_candidate c""",
      "TRAINEES", """
          SELECT p.id AS id, COALESCE(NULLIF(p.full_name, ''), p.name) AS label,
            CAST(GREATEST(MAX(COALESCE(p.updated_on, p.created_on)), MAX(COALESCE(e.updated_on, e.created_on)), MAX(h.end_date)) AS date) AS last
          FROM ioeti_training_enrollment e JOIN base_partner p ON p.id = e.trainee JOIN ioeti_training_cohort h ON h.id = e.cohort
          GROUP BY p.id, p.full_name, p.name""",
      "DONORS", """
          SELECT d.id AS id, COALESCE(NULLIF(p.full_name, ''), p.name) AS label,
            CAST(GREATEST(COALESCE(d.updated_on, d.created_on), COALESCE(p.updated_on, p.created_on),
              (SELECT MAX(COALESCE(o.updated_on, o.created_on)) FROM ioeti_fund_opportunity o WHERE o.donor = d.id),
              (SELECT MAX(COALESCE(s.updated_on, s.created_on)) FROM ioeti_fund_stewardship s WHERE s.donor = d.id),
              (SELECT MAX(c.received_on) FROM ioeti_fund_collection c JOIN ioeti_fund_installment i ON i.id = c.installment
                 JOIN ioeti_fund_commitment m ON m.id = i.commitment JOIN ioeti_fund_opportunity o ON o.id = m.opportunity
               WHERE o.donor = d.id)) AS date) AS last
          FROM ioeti_fund_donor d JOIN base_partner p ON p.id = d.partner""",
      "CONTACTS", """
          SELECT p.id AS id, COALESCE(NULLIF(p.full_name, ''), p.name) AS label,
            CAST(GREATEST(COALESCE(p.updated_on, p.created_on),
              (SELECT MAX(COALESCE(e.updated_on, e.created_on)) FROM ical_event e WHERE e.contact_partner = p.id)) AS date) AS last
          FROM base_partner p WHERE p.is_contact = true""");

  /** The data types whose records may be anonymized here. */
  public static final List<String> ANONYMIZABLE = List.of("LEADS", "CANDIDATES");

  /** The row source of each type, locked for one record (two reviewers cannot decide the same record at once). */
  static final Map<String, String> LOCKS = Map.of(
      "LEADS", "SELECT id FROM crm_lead WHERE id = ?1 FOR UPDATE",
      "CANDIDATES", "SELECT id FROM ioeti_rec_candidate WHERE id = ?1 FOR UPDATE",
      "TRAINEES", "SELECT id FROM base_partner WHERE id = ?1 FOR UPDATE",
      "DONORS", "SELECT id FROM ioeti_fund_donor WHERE id = ?1 FOR UPDATE",
      "CONTACTS", "SELECT id FROM base_partner WHERE id = ?1 FOR UPDATE");

  /** The policy for one type: its version, period in months, and the cut-off (records last active on or before it are due). */
  public record Period(PolicyVersion version, int months, LocalDate cutoff) {}

  /** One record due for review. */
  public record Due(long id, String label, LocalDate lastActivityOn, LocalDate dueSince) {}

  private final PolicyService policies;

  @Inject
  public RetentionService(PolicyService policies) {
    this.policies = policies;
  }

  public static String type(String raw) {
    if (raw == null || !PolicyCatalog.DATA_TYPES.contains(raw)) throw ApiException.notFound();
    return raw;
  }

  public Optional<Period> period(String type, LocalDate today) {
    return policies.current(KEY, type, today).map(applied -> {
      int months = applied.value().path("months").asInt();
      return new Period(JPA.find(PolicyVersion.class, applied.versionId()), months, today.minusMonths(months));
    });
  }

  /** The period in force, or 422 POLICY_NOT_SET. */
  public Period require(String type, LocalDate today) {
    policies.require(KEY, type, today);
    return period(type, today).orElseThrow();
  }

  /** How many records of a type are due today. */
  public long count(String type, Period period, LocalDate today) {
    Query q = JPA.em().createNativeQuery("SELECT COUNT(*) FROM (" + due(type) + ") n");
    bind(q, type, period, today);
    return ((Number) q.getSingleResult()).longValue();
  }

  /** The records due today, the longest overdue first. */
  public List<Due> list(String type, Period period, LocalDate today, int limit) {
    Query q = JPA.em().createNativeQuery(due(type) + " ORDER BY x.last, x.id LIMIT " + Math.max(1, Math.min(limit, PAGE)));
    bind(q, type, period, today);
    return rows(q.getResultList(), period);
  }

  /** One record, if it is due today. */
  Optional<Due> one(String type, Period period, LocalDate today, long id) {
    Query q = JPA.em().createNativeQuery(due(type) + " AND x.id = ?5");
    bind(q, type, period, today);
    q.setParameter(5, id);
    return rows(q.getResultList(), period).stream().findFirst();
  }

  private static String due(String type) {
    return "SELECT x.id, x.label, x.last FROM (" + SOURCES.get(type) + ") x WHERE x.last <= ?1 AND NOT EXISTS ("
        + "SELECT 1 FROM ioeti_privacy_decision r WHERE r.data_type = ?2 AND r.record_id = x.id"
        + " AND (r.decision = ?3 OR r.review_again_on > ?4))";
  }

  private static void bind(Query q, String type, Period period, LocalDate today) {
    q.setParameter(1, Date.valueOf(period.cutoff()));
    q.setParameter(2, type);
    q.setParameter(3, ANONYMIZED);
    q.setParameter(4, Date.valueOf(today));
  }

  private static List<Due> rows(List<?> result, Period period) {
    List<Due> out = new ArrayList<>();
    for (Object row : result) {
      Object[] r = (Object[]) row;
      LocalDate last = r[2] instanceof Date d ? d.toLocalDate() : (LocalDate) r[2];
      out.add(new Due(((Number) r[0]).longValue(), (String) r[1], last, last.plusMonths(period.months())));
    }
    return out;
  }

  // --- decisions ------------------------------------------------------------------------------------------------

  /** Keeps a due record until a date (at most one more period away), with a reason. */
  @Transactional(rollbackOn = {Exception.class})
  public RetentionDecision keep(String type, long id, String rawReason, LocalDate reviewAgainOn, User me, LocalDate today) {
    String reason = reason(rawReason);
    Period period = require(type, today);
    checkReviewAgainOn(reviewAgainOn, today, period.months());
    Due due = lockDue(type, period, today, id);
    return record(type, due, KEEP, reason, reviewAgainOn, period, me);
  }

  /**
   * Anonymizes a due lead or candidate in place: the person's details and every copy of them on the record's history
   * (tracking messages, activities, drafted messages, notices) are overwritten. Refused while documents are filed on it,
   * because a document's content cannot be anonymized here and revisions are never deleted.
   */
  @Transactional(rollbackOn = {Exception.class})
  public RetentionDecision anonymize(String type, long id, String rawReason, User me, LocalDate today) {
    String reason = reason(rawReason);
    if (!ANONYMIZABLE.contains(type)) {
      throw new ApiException(422, "ANONYMIZE_NOT_AVAILABLE",
          "These records are shared with accounting and certificates; they can only be kept until that is decided.", null);
    }
    Period period = require(type, today);
    Due due = lockDue(type, period, today, id);
    long files = "LEADS".equals(type)
        ? count("SELECT COUNT(*) FROM ioeti_doc_document WHERE subject_select = 1 AND subject_id = ?1", id) + files(LEAD_MODEL, id)
        : files(CANDIDATE_MODEL, id);
    if (files > 0) {
      throw new ApiException(422, "FILES_FILED", "Documents are filed on this record; it can be kept, not anonymized.", null);
    }
    if ("LEADS".equals(type)) anonymizeLead(id, me);
    else anonymizeCandidate(id, me);
    return record(type, due, ANONYMIZED, reason, null, period, me);
  }

  private Due lockDue(String type, Period period, LocalDate today, long id) {
    List<?> found = JPA.em().createNativeQuery(LOCKS.get(type)).setParameter(1, id).getResultList();
    if (found.isEmpty()) throw ApiException.notFound();
    return one(type, period, today, id).orElseThrow(() ->
        new ApiException(422, "NOT_DUE", "This record is not due for review (still within its period, kept, or anonymized).", null));
  }

  private static RetentionDecision record(String type, Due due, String decision, String reason, LocalDate again, Period period, User me) {
    RetentionDecision d = new RetentionDecision();
    d.setDataType(type);
    d.setRecordId(due.id());
    d.setDecision(decision);
    d.setReason(reason);
    d.setReviewAgainOn(again);
    d.setLastActivityOn(due.lastActivityOn());
    d.setPolicyVersion(period.version());
    d.setDecidedBy(me);
    d.setDecidedAt(LocalDateTime.now());
    return JPA.save(d);
  }

  /** A kept record is reviewed again after today, and at most one more period away. */
  static void checkReviewAgainOn(LocalDate reviewAgainOn, LocalDate today, int months) {
    if (reviewAgainOn == null) throw ApiException.invalidField("reviewAgainOn", "REQUIRED", "Choose when to review it again.");
    if (!reviewAgainOn.isAfter(today)) throw ApiException.invalidField("reviewAgainOn", "PAST", "Choose a date after today.");
    if (reviewAgainOn.isAfter(today.plusMonths(months))) {
      throw ApiException.invalidField("reviewAgainOn", "RANGE", "A record is kept for at most one more retention period.");
    }
  }

  static String reason(String raw) {
    String text = raw == null ? "" : raw.strip();
    if (text.isEmpty()) throw ApiException.invalidField("reason", "REQUIRED", "Say why.");
    if (text.length() > 500) throw ApiException.invalidField("reason", "TOO_LONG", "At most 500 characters.");
    return text;
  }

  // --- anonymization ---------------------------------------------------------------------------------------------
  // Written as SQL on purpose: saving through the ORM would make the native change tracking write a new message holding
  // the old name, after the messages were scrubbed.

  private static void anonymizeLead(long id, User me) {
    Long email = (Long) single("SELECT email_address FROM crm_lead WHERE id = ?1", id);
    Long address = (Long) single("SELECT address FROM crm_lead WHERE id = ?1", id);
    update("""
        UPDATE crm_lead SET name = ?2, full_name = ?2, simple_full_name = ?2, first_name = NULL, title_select = NULL,
          enterprise_name = NULL, office_name = NULL, department = NULL, mobile_phone = NULL, fixed_phone = NULL, web_site = NULL,
          address = NULL, picture = NULL, description = NULL, status_description = NULL, source_description = NULL,
          lost_reason_str = NULL, ioeti_search_key = NULL, version = version + 1, updated_on = ?3, updated_by = ?4
        WHERE id = ?1""", id, ANONYMIZED_TEXT, LocalDateTime.now(), me.getId());
    // the e-mail and the address are cleared only when nothing else uses them (a converted lead's contact may share them);
    // otherwise the lead only lets go of them
    if (email != null && count("SELECT COUNT(*) FROM base_partner WHERE email_address = ?1", email) == 0) {
      update("UPDATE message_email_address SET address = ?2, name = ?2, version = version + 1 WHERE id = ?1",
          email, "anonymized-lead-" + id + "@invalid");
    } else if (email != null) {
      update("UPDATE crm_lead SET email_address = NULL WHERE id = ?1", id);
    }
    if (address != null && count("SELECT COUNT(*) FROM base_partner_address WHERE address = ?1", address)
        + count("SELECT COUNT(*) FROM crm_lead WHERE address = ?1", address) == 0) {
      update("""
          UPDATE base_address SET addressl2 = NULL, addressl3 = NULL, addressl4 = NULL, addressl5 = NULL, addressl6 = NULL,
            building_name = NULL, building_number = NULL, floor = NULL, room = NULL, post_box = NULL, street_name = NULL,
            full_name = ?2, formatted_full_name = ?2, latit = NULL, longit = NULL, street = NULL, version = version + 1
          WHERE id = ?1""", address, ANONYMIZED_TEXT);
    }
    scrubMessages(LEAD_MODEL, id);
    update("""
        UPDATE mail_message SET body = ?2, subject = NULL, summary = NULL, related_name = ?3
        WHERE related_model = ?4 AND related_id IN (SELECT id FROM ical_event WHERE event_lead = ?1)""",
        id, "{\"title\":\"" + ANONYMIZED_TEXT + "\",\"tracks\":[],\"tags\":[]}", ANONYMIZED_TEXT, EVENT_MODEL);
    update("UPDATE ical_event SET subject = ?2, description = NULL, location = NULL, version = version + 1 WHERE event_lead = ?1",
        id, ANONYMIZED_TEXT);
    update("UPDATE ioeti_auto_outbound SET subject_line = ?2, body = NULL, version = version + 1 WHERE lead = ?1", id, ANONYMIZED_TEXT);
    update("UPDATE ioeti_auto_notification SET title = ?2, version = version + 1 WHERE subject = 'LEAD' AND subject_id = ?1", id, ANONYMIZED_TEXT);
  }

  private static void anonymizeCandidate(long id, User me) {
    update("""
        UPDATE ioeti_rec_candidate SET display_name = ?2, headline = NULL, years_experience = NULL, version = version + 1,
          updated_on = ?3, updated_by = ?4
        WHERE id = ?1""", id, ANONYMIZED_TEXT, LocalDateTime.now(), me.getId());
    update("""
        UPDATE ioeti_rec_candidate_private SET email = NULL, phone = NULL, expected_salary = NULL, cv_reference = NULL,
          version = version + 1
        WHERE candidate = ?1""", id);
    // the offered salary is restricted personal money: kept as zero (the column is required), any fee already requested keeps its amount
    update("""
        UPDATE ioeti_rec_offer_private SET annual_salary = 0, version = version + 1
        WHERE application IN (SELECT a.id FROM ioeti_rec_application a WHERE a.candidate = ?1)""", id);
    scrubMessages(CANDIDATE_MODEL, id);
    update("UPDATE ioeti_auto_notification SET title = ?2, version = version + 1 WHERE subject = 'CANDIDATE' AND subject_id = ?1",
        id, ANONYMIZED_TEXT);
  }

  /** Tracking messages and comments on the record keep their dates and authors; their text is replaced. */
  private static void scrubMessages(String model, long id) {
    update("""
        UPDATE mail_message SET body = CASE WHEN type = 'notification' THEN ?3 ELSE ?4 END, subject = NULL, summary = NULL,
          related_name = ?4
        WHERE related_model = ?2 AND related_id = ?1""",
        id, model, "{\"title\":\"" + ANONYMIZED_TEXT + "\",\"tracks\":[],\"tags\":[]}", ANONYMIZED_TEXT);
  }

  private static long files(String model, long id) {
    return count("SELECT COUNT(*) FROM dms_file WHERE related_model = ?1 AND related_id = ?2 AND (is_directory IS NULL OR is_directory = false)",
        model, id);
  }

  private static Object single(String sql, Object... params) {
    Query q = JPA.em().createNativeQuery(sql);
    for (int i = 0; i < params.length; i++) q.setParameter(i + 1, params[i]);
    List<?> rows = q.getResultList();
    Object v = rows.isEmpty() ? null : rows.get(0);
    return v instanceof Number n ? n.longValue() : v;
  }

  private static long count(String sql, Object... params) {
    Object v = single(sql, params);
    return v == null ? 0 : (Long) v;
  }

  private static void update(String sql, Object... params) {
    Query q = JPA.em().createNativeQuery(sql);
    for (int i = 0; i < params.length; i++) q.setParameter(i + 1, params[i]);
    q.executeUpdate();
  }
}
