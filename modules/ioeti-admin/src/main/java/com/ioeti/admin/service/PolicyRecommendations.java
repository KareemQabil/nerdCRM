package com.ioeti.admin.service;

import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.inject.persist.Transactional;
import com.ioeti.businessline.db.BusinessLine;
import com.ioeti.businessline.db.repo.BusinessLineRepository;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.db.PolicyVersion;
import com.ioeti.core.policy.PolicyCatalog;
import com.ioeti.core.policy.PolicyService;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * R1, owner instruction of 2026-10-27: "even the decisions use a recommended decision and we can modify it later".
 *
 * <p>A recommended starting value for every policy, with the reason it is recommended and whether it rests on a published
 * fact (a law, a standard) or on common practice. Nothing here is in force: a policy owner reviews the list and applies the
 * ones they accept, in one step. Each applied value becomes an ordinary policy version (effective-dated, with its author and
 * reason, in the admin change log) that can be changed or unset like any other. A value already in force is never
 * replaced.
 */
public class PolicyRecommendations {

  public static final String REASON = "Recommended starting value (R1), applied by a policy owner; review and change it any time.";
  /** FACT: rests on a law or standard; PRACTICE: common practice for a company like IOETI. */
  public enum Basis { FACT, PRACTICE }

  /** One recommended value for a policy and scope (null scope: company-wide or default). */
  public record Recommendation(String key, String scope, String scopeLabel, JsonNode value, Basis basis, String whyAr, String whyEn) {
    public String id() {
      return key + "|" + (scope == null ? "" : scope);
    }
  }

  /** What a recommendation looks like today: the value in force for that key and scope, if any. */
  public record Status(Recommendation recommendation, JsonNode current) {}

  private static final ObjectMapper JSON = new ObjectMapper();

  private static JsonNode json(String value) {
    try {
      return JSON.readTree(value.replace('\'', '"'));
    } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
      throw new IllegalStateException(e);
    }
  }

  static Recommendation r(String key, String scope, String label, String value, Basis basis, String whyAr, String whyEn) {
    PolicyCatalog.get(key);
    return new Recommendation(key, scope, label, json(value), basis, whyAr, whyEn);
  }

  /** Egypt's fixed-date public holidays for the coming year; the moving (Islamic, Sham El-Nessim) ones are added when announced. */
  static List<String> fixedHolidays(LocalDate today) {
    List<String> out = new ArrayList<>();
    for (int year = today.getYear(); year <= today.getYear() + 1; year++) {
      for (String md : List.of("01-07", "01-25", "04-25", "05-01", "06-30", "07-23", "10-06")) {
        LocalDate d = LocalDate.parse(year + "-" + md);
        if (!d.isBefore(today) && d.isBefore(today.plusYears(1))) out.add(d.toString());
      }
    }
    return out;
  }

  /** Every recommendation: the company-wide ones, then one per business line that exists now. */
  public List<Recommendation> all(LocalDate today) {
    List<Recommendation> out = new ArrayList<>(fixed(today));
    for (BusinessLine line : lines()) {
      out.add(r("sales.won-evidence", line.getCode(), label(line), "{'evidence':'ACCEPTED_QUOTE'}", Basis.PRACTICE,
          "عرض سعر مقبول بدليل مرفوع (عرض موقّع أو أمر شراء) هو الإثبات المعتاد للالتزام في الخدمات. لو الخط ده دايمًا بيمضي عقد، غيّرها لعقد مفعّل.",
          "An accepted quotation with uploaded evidence (signed quote or purchase order) is the usual proof of commitment for services. Switch a line that always signs a contract to an active contract."));
    }
    for (BusinessLine line : lines()) {
      if (line.getResponsibleTeam() == null) continue;
      out.add(r("leads.routing", line.getCode(), label(line), "{'rules':[{'teamId':" + line.getResponsibleTeam().getId() + "}],'workloadCap':40}", Basis.PRACTICE,
          "كل الـ leads لفريق الخط المسؤول (" + line.getResponsibleTeam().getName() + ")، بالدور، بحد أقصى 40 lead مفتوح للشخص. ضيف قواعد بالمحافظة أو المصدر بعدين.",
          "Every lead to the line's responsible team (" + line.getResponsibleTeam().getName() + "), round robin, at most 40 open leads per person; add governorate or source rules later."));
    }
    return out;
  }

  /** The recommendations that do not depend on the records in the database. */
  static List<Recommendation> fixed(LocalDate today) {
    List<Recommendation> out = new ArrayList<>();
    // --- D-06 finance
    out.add(r("finance.tax", null, null, "{'ratePercent':14,'name':'ضريبة القيمة المضافة 14%','type':'VAT'}", Basis.FACT,
        "14% هي النسبة العامة لضريبة القيمة المضافة في مصر (قانون 67 لسنة 2016). لو خط أعمال خدماته معفاة (زي بعض خدمات التعليم والتدريب) بعد تأكيد المحاسب، حط له قيمة خاصة بيه.",
        "14% is Egypt's standard VAT rate (Law 67 of 2016). If your tax adviser confirms a line's services are exempt (some education and training are), give that line its own value."));
    out.add(r("finance.fx", null, null, "{'source':'PUBLIC_API','currencies':'USD,EUR,GBP,SAR,AED','maxAgeHours':24}", Basis.PRACTICE,
        "أسعار يومية من مصدر عام للعملات اللي العملاء بيدفعوا بيها عادة، والمالية تقدر تعدّل أي سعر يدويًا.",
        "Daily rates from a public source for the currencies clients usually pay in; finance can still override any rate."));
    out.add(r("finance.payment-terms", null, null, "{'dueDays':30}", Basis.PRACTICE,
        "30 يوم من تاريخ الفاتورة هي المدة المعتادة بين الشركات في مصر.", "30 days from the invoice date is the usual business-to-business term in Egypt."));
    // --- D-11 commercial
    out.add(r("sales.quote-approval", null, null,
        "{'tiers':[{'maxDiscountPercent':5,'approver':'NONE'},{'maxDiscountPercent':10,'approver':'SALES_MANAGER'},{'maxDiscountPercent':20,'approver':'GM'}]}",
        Basis.PRACTICE,
        "خصم لحد 5% من غير موافقة، لحد 10% مدير المبيعات، لحد 20% المدير العام، وأكتر من كده بيترفض لحد ما المستويات تتعدل.",
        "Up to 5% discount without approval, up to 10% the sales manager, up to 20% the general manager; anything above is refused until the tiers change."));
    out.add(r("sales.quote-validity", null, null, "{'days':30}", Basis.PRACTICE,
        "30 يوم تكفي العميل يقرر، ومش طويلة لدرجة إن الأسعار تتغير.", "Thirty days gives the client time to decide without prices drifting."));
    out.add(r("sales.contract-signatory", null, null, "{'signatory':'GM'}", Basis.PRACTICE,
        "العقد التزام على الشركة كلها، فالمدير العام هو اللي يفعّله.", "A contract binds the whole company, so the general manager activates it."));
    // --- D-07 privacy (Law 151 of 2020 sets no fixed periods: keep data only as long as its purpose needs it)
    String why = "قانون حماية البيانات (151 لسنة 2020) بيقول تحتفظ بالبيانات بس طول ما الغرض محتاجها. ";
    String whyEn = "The data protection law (151 of 2020) says keep data only as long as its purpose needs it. ";
    out.add(r("privacy.retention", "LEADS", "LEADS", "{'months':24}", Basis.PRACTICE,
        why + "سنتين تغطي دورة بيع طويلة.", whyEn + "Two years covers a long sales cycle."));
    out.add(r("privacy.retention", "CANDIDATES", "CANDIDATES", "{'months':24}", Basis.PRACTICE,
        why + "سنتين لفرص توظيف جاية، بعدها يتجهّل.", whyEn + "Two years for future openings, then anonymized."));
    out.add(r("privacy.retention", "TRAINEES", "TRAINEES", "{'months':60}", Basis.PRACTICE,
        why + "5 سنين عشان التحقق من الشهادات.", whyEn + "Five years so certificates can be verified."));
    out.add(r("privacy.retention", "DONORS", "DONORS", "{'months':60}", Basis.PRACTICE,
        why + "5 سنين زي مدة الاحتفاظ بالدفاتر الضريبية.", whyEn + "Five years, like the tax-record keeping period."));
    out.add(r("privacy.retention", "CONTACTS", "CONTACTS", "{'months':36}", Basis.PRACTICE,
        why + "3 سنين بعد آخر تعامل.", whyEn + "Three years after the last dealing."));
    // --- D-12 leads
    out.add(r("leads.response-target", null, null, "{'firstContactHours':4,'qualificationHours':40}", Basis.PRACTICE,
        "أول تواصل خلال 4 ساعات عمل (نفس اليوم)، والتأهيل خلال أسبوع عمل.", "First contact within 4 working hours (the same day), qualified within a working week."));
    StringBuilder holidays = new StringBuilder();
    for (String d : fixedHolidays(today)) holidays.append(holidays.length() == 0 ? "" : ",").append("'").append(d).append("'");
    out.add(r("work.calendar", null, null, "{'days':['SUN','MON','TUE','WED','THU'],'start':'09:00','end':'17:00','holidays':[" + holidays + "]}", Basis.PRACTICE,
        "من الأحد للخميس، 9 الصبح لـ 5. الإجازات الثابتة متضافة؛ الإجازات المتغيرة (الأعياد الإسلامية وشم النسيم) ضيفها لما الحكومة تعلنها.",
        "Sunday to Thursday, 09:00 to 17:00. Fixed-date public holidays are included; add the moving ones (Islamic holidays, Sham El-Nessim) when the government announces them."));
    // --- D-02 certification (ISO/IEC 17021-1)
    out.add(r("cert.decision", null, null, "{'mode':'INDEPENDENT_REVIEWER'}", Basis.FACT,
        "معيار ISO/IEC 17021-1 بيشترط إن قرار المنح ياخده حد ما شاركش في التدقيق. مراجع مستقل واحد هو الأنسب لجهة بحجمنا.",
        "ISO/IEC 17021-1 requires the decision to be taken by someone not involved in the audit; one independent reviewer suits a body of our size."));
    out.add(r("cert.cycle", null, null, "{'validityMonths':36,'surveillanceMonths':12}", Basis.FACT,
        "دورة الشهادة في ISO/IEC 17021-1 تلات سنين، وتدقيق مراقبة مرة على الأقل كل سنة.",
        "ISO/IEC 17021-1 sets a three-year cycle with surveillance at least once a year."));
    // --- D-03 training
    out.add(r("training.certificate", null, null, "{'minAttendancePercent':80,'passMark':70}", Basis.PRACTICE,
        "حضور 80% على الأقل، ودرجة نجاح 70% في الكورسات اللي فيها تقييم.", "At least 80% attendance, and a 70% pass mark where the course is assessed."));
    out.add(r("training.national-id", null, null, "{'collect':'OPTIONAL'}", Basis.PRACTICE,
        "اختياري: بيتطلب بس لو الشهادة محتاجاه، وبيتخزن كبيانات محظورة.", "Optional: asked only where a certificate needs it, and stored as restricted data."));
    out.add(r("training.cancellation", null, null,
        "{'steps':[{'daysBeforeStart':14,'refundPercent':100},{'daysBeforeStart':7,'refundPercent':50},{'daysBeforeStart':0,'refundPercent':0}]}", Basis.PRACTICE,
        "استرداد كامل قبل البداية بأسبوعين، النص قبلها بأسبوع، وبعد كده مفيش.", "A full refund two weeks before the start, half one week before, nothing after."));
    // --- D-04 recruitment
    out.add(r("recruitment.agreement", null, null, "{'feePercent':15,'invoiceOn':'START_DATE','guaranteeDays':90,'replacement':'REPLACE'}", Basis.PRACTICE,
        "15% من الراتب السنوي (حوالي شهرين)، الفاتورة يوم استلام الشغل، وضمان 90 يوم ببديل مجاني. ممكن تغيّرها لكل عميل.",
        "15% of annual salary (about two months), invoiced on the start date, with a 90-day free-replacement guarantee; change it per client."));
    // --- D-10 channels: nothing goes out until its credentials exist
    out.add(r("channels.enabled", null, null, "{'channels':[]}", Basis.PRACTICE,
        "مفيش قناة خارجية تشتغل لحد ما بياناتها السرية تتسجل وتتجرب؛ فعّل كل قناة لما تجهز.",
        "No external channel runs until its credentials are set and tested; switch each on when it is ready."));
    return out;
  }

  /** Each recommendation with the value in force for its key and scope today (null when unset). */
  public List<Status> status(LocalDate today) {
    PolicyService policies = Beans.get(PolicyService.class);
    return all(today).stream().map(r -> new Status(r, inForce(policies, r, today).orElse(null))).toList();
  }

  /** Applies the chosen recommendations that are not yet in force; returns the ids applied (others are skipped). */
  @Transactional(rollbackOn = {Exception.class})
  public List<String> apply(List<String> ids, LocalDate from, LocalDate today) {
    if (ids == null || ids.isEmpty()) throw ApiException.invalidField("ids", "REQUIRED", "Choose at least one recommendation.");
    Set<String> wanted = new LinkedHashSet<>(ids);
    Map<String, Recommendation> byId = new java.util.LinkedHashMap<>();
    all(today).forEach(r -> byId.put(r.id(), r));
    for (String id : wanted) {
      if (!byId.containsKey(id)) throw ApiException.invalidField("ids", "UNAVAILABLE", "Unknown recommendation: " + id);
    }
    PolicyService policies = Beans.get(PolicyService.class);
    PolicyAdmin admin = Beans.get(PolicyAdmin.class);
    List<String> applied = new ArrayList<>();
    for (String id : wanted) {
      Recommendation r = byId.get(id);
      // never replace a value someone set; a default does not count as set for a scoped recommendation
      if (inForce(policies, r, from == null ? today : from).isPresent()) continue;
      PolicyVersion v = admin.set(r.key(), r.scope(), r.value(), from, REASON, today);
      applied.add(r.id() + "#" + v.getId());
    }
    Beans.get(AdminService.class).auditChange("POLICY_RECOMMENDED_APPLIED", "POLICY", null, applied.size() + " recommended values",
        List.of("applied=" + applied, "asked=" + wanted.size()));
    return applied.stream().map(a -> a.substring(0, a.indexOf('#'))).toList();
  }

  /** The value in force exactly for the recommendation's key and scope (not a fallback to the default). */
  private static Optional<JsonNode> inForce(PolicyService policies, Recommendation r, LocalDate on) {
    return policies.current(r.key(), r.scope(), on).filter(a -> java.util.Objects.equals(a.scope(), r.scope())).map(PolicyService.Applied::value);
  }

  private static List<BusinessLine> lines() {
    return Query.of(BusinessLine.class).filter("self.statusSelect IN (?1, ?2)", BusinessLineRepository.STATUS_IN_SETUP, BusinessLineRepository.STATUS_ACTIVE)
        .order("sequence").order("code").fetch(200);
  }

  private static String label(BusinessLine line) {
    return line.getCode() + " · " + line.getNameAr();
  }
}
