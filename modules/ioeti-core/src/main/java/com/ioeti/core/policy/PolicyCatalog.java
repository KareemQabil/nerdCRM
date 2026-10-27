package com.ioeti.core.policy;

import static com.ioeti.core.policy.PolicyDefinition.Field.choice;
import static com.ioeti.core.policy.PolicyDefinition.Field.integer;
import static com.ioeti.core.policy.PolicyDefinition.Field.list;
import static com.ioeti.core.policy.PolicyDefinition.Field.multi;
import static com.ioeti.core.policy.PolicyDefinition.Field.of;
import static com.ioeti.core.policy.PolicyDefinition.Field.text;

import com.ioeti.core.api.ApiException;
import com.ioeti.core.policy.PolicyDefinition.Field;
import com.ioeti.core.policy.PolicyDefinition.Kind;
import com.ioeti.core.policy.PolicyDefinition.Scope;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Every business rule the owners decided to keep configurable (decisions D-01..D-12, signed 2026-10-25).
 * Only the shape of each rule lives here; every value is set by a policy owner and none is shipped.
 */
public final class PolicyCatalog {

  /** The role templates approvers and assignees are chosen from (D-07). */
  public static final List<String> APPROVER_ROLES = List.of("SALES_MANAGER", "GM", "FINANCE");
  public static final List<String> WEEKDAYS = List.of("SAT", "SUN", "MON", "TUE", "WED", "THU", "FRI");
  public static final List<String> DATA_TYPES = List.of("LEADS", "CANDIDATES", "TRAINEES", "DONORS", "CONTACTS");

  private static final Map<String, PolicyDefinition> ALL = new LinkedHashMap<>();

  private static void add(PolicyDefinition definition) {
    ALL.put(definition.key(), definition);
  }

  static {
    // --- D-06 finance ---------------------------------------------------------------------------------------
    add(new PolicyDefinition("finance.tax", "D-06", "FINANCE", Scope.BUSINESS_LINE, true,
        List.of(of("ratePercent", Kind.PERCENT, true, "نسبة الضريبة", "Tax rate"), text("name", true, 60, "اسم الضريبة", "Tax name"),
            choice("type", true, List.of("VAT", "OTHER"), "نوع الضريبة", "Tax type")),
        "ضريبة الخدمات", "Tax on services",
        "النسبة اللي بتتحسب على سطور عروض الأسعار والفواتير. ممكن قيمة لكل خط أعمال، أو قيمة عامة.",
        "The rate applied to quotation and invoice lines; per business line, or one default value."));
    add(new PolicyDefinition("finance.fx", "D-06", "FINANCE", Scope.NONE, false,
        List.of(choice("source", true, List.of("PUBLIC_API", "MANUAL_ONLY"), "مصدر أسعار الصرف", "Exchange-rate source"),
            text("currencies", true, 60, "العملات (مثال: USD,EUR)", "Currencies (e.g. USD,EUR)"),
            integer("maxAgeHours", true, 1, 720, "أقصى عمر للسعر بالساعات", "Oldest acceptable rate (hours)")),
        "تحويل العملات للجنيه", "Conversion to EGP",
        "منين بتيجي أسعار الصرف، وإمتى السعر يعتبر قديم. المالية تقدر تعدّل السعر يدويًا دايمًا.",
        "Where exchange rates come from and when a rate is too old; finance can always override a rate by hand."));
    add(new PolicyDefinition("finance.payment-terms", "D-06", "FINANCE", Scope.BUSINESS_LINE, true,
        List.of(integer("dueDays", true, 0, 365, "مدة السداد بالأيام", "Days to pay")),
        "شروط السداد", "Payment terms", "عدد الأيام من تاريخ الفاتورة لحد ميعاد السداد.", "Days from the invoice date to its due date."));

    // --- D-11 commercial approvals --------------------------------------------------------------------------
    add(new PolicyDefinition("sales.quote-approval", "D-11", "SALES", Scope.BUSINESS_LINE, true,
        List.of(list("tiers", true, 5, List.of(
            new Field("maxDiscountPercent", Kind.PERCENT, true, List.of(), null, null, List.of(), "حتى خصم %", "Up to discount %"),
            new Field("maxAmount", Kind.DECIMAL, false, List.of(), 0, null, List.of(), "حتى قيمة (بالجنيه، اختياري)", "Up to value (EGP, optional)"),
            choice("approver", true, List.of("NONE", "SALES_MANAGER", "GM"), "مين يوافق", "Approved by")),
            "مستويات الموافقة (من الأصغر للأكبر)", "Approval tiers (smallest first)")),
        "موافقة عروض الأسعار", "Quotation approval",
        "أول مستوى العرض يقع فيه هو اللي بيحدد مين يوافق. لو العرض أكبر من كل المستويات، بيترفض لحد ما المستويات تتعدل.",
        "The first tier a quotation fits decides who approves it; above every tier it is refused until the tiers change."));
    add(new PolicyDefinition("sales.quote-validity", "D-11", "SALES", Scope.BUSINESS_LINE, true,
        List.of(integer("days", true, 1, 365, "مدة الصلاحية بالأيام", "Valid for (days)")),
        "صلاحية عرض السعر", "Quotation validity", "عدد الأيام اللي العرض النهائي بيفضل ساري فيها.", "How long a finalized quotation stays valid."));
    add(new PolicyDefinition("sales.won-evidence", "D-11", "SALES", Scope.BUSINESS_LINE, false,
        List.of(choice("evidence", true, List.of("ACTIVE_CONTRACT", "ACCEPTED_QUOTE"), "دليل الالتزام", "Evidence of commitment")),
        "متى تُكسب الفرصة", "When an opportunity is won",
        "عقد مفعّل، أو عرض سعر مقبول بدليل مرفوع (عرض موقّع أو أمر شراء). خط الأعمال اللي مالوش القيمة دي ما ينفعش يسجّل كسب.",
        "An active contract, or an accepted quotation with uploaded evidence (signed quote or purchase order); a line without this cannot mark Won."));

    // --- D-07 privacy -----------------------------------------------------------------------------------------
    add(new PolicyDefinition("privacy.retention", "D-07", "PRIVACY", Scope.DATA_TYPE, false,
        List.of(integer("months", true, 1, 600, "مدة الاحتفاظ بالشهور", "Keep for (months)")),
        "مدة الاحتفاظ بالبيانات", "Data retention",
        "بعد المدة دي السجل بيظهر للمراجعة (تجهيل أو إبقاء بسبب). مفيش حذف تلقائي.",
        "After this period a record is listed for review (anonymize, or keep with a reason); nothing is removed automatically."));

    // --- D-12 leads -------------------------------------------------------------------------------------------
    add(new PolicyDefinition("leads.routing", "D-12", "LEADS", Scope.BUSINESS_LINE, false,
        List.of(list("rules", true, 50, List.of(
            text("governorate", false, 60, "المحافظة (اختياري)", "Governorate (optional)"),
            text("source", false, 60, "المصدر (اختياري)", "Source (optional)"),
            of("teamId", Kind.INTEGER, true, "الفريق", "Team")),
            "قواعد التوجيه (أول قاعدة مطابقة)", "Routing rules (first match)"),
            integer("workloadCap", true, 1, 1000, "أقصى عدد leads مفتوحة للشخص", "Most open leads per person")),
        "توزيع الـ leads", "Lead routing",
        "أول قاعدة مطابقة بتحدد الفريق، وجوه الفريق التوزيع بالدور مع تخطي اللي في إجازة أو وصل للحد.",
        "The first matching rule picks the team; inside it leads go round-robin, skipping people on leave or at their cap."));
    add(new PolicyDefinition("leads.response-target", "D-12", "LEADS", Scope.BUSINESS_LINE, true,
        List.of(integer("firstContactHours", true, 1, 720, "أول تواصل خلال (ساعات عمل)", "First contact within (working hours)"),
            integer("qualificationHours", false, 1, 2000, "التأهيل خلال (ساعات عمل)", "Qualified within (working hours)")),
        "مواعيد الرد على الـ leads", "Lead response targets",
        "لو الميعاد فات، الـ lead بيتعلّم متأخر ومدير الخط بيوصله إشعار داخلي. مفيش إعادة توزيع تلقائي.",
        "When missed, the lead is flagged overdue and the line's manager gets an in-app notice; nothing is reassigned automatically."));
    add(new PolicyDefinition("work.calendar", "D-12", "LEADS", Scope.NONE, false,
        List.of(multi("days", true, WEEKDAYS, "أيام العمل", "Working days"),
            of("start", Kind.TIME, true, "بداية اليوم", "Day starts"), of("end", Kind.TIME, true, "نهاية اليوم", "Day ends"),
            of("holidays", Kind.DATE_LIST, false, "الإجازات الرسمية", "Public holidays")),
        "مواعيد العمل", "Working hours", "بتتحسب عليها مواعيد الرد.", "Response targets are counted in these hours."));

    // --- D-02 certification -----------------------------------------------------------------------------------
    add(new PolicyDefinition("cert.decision", "D-02", "CERTIFICATION", Scope.SCHEME, false,
        List.of(choice("mode", true, List.of("INDEPENDENT_REVIEWER", "COMMITTEE"), "مين ياخد القرار", "Who decides"),
            integer("committeeSize", false, 2, 9, "عدد أعضاء اللجنة", "Committee members")),
        "قرار منح الشهادة", "Certification decision",
        "مراجع مستقل أو لجنة. صاحب القرار عمره ما يكون من فريق تدقيق نفس العميل.",
        "An independent reviewer or a committee; whoever decides was never on that client's audit team."));
    add(new PolicyDefinition("cert.cycle", "D-02", "CERTIFICATION", Scope.SCHEME, false,
        List.of(integer("validityMonths", true, 1, 120, "مدة صلاحية الشهادة بالشهور", "Certificate valid for (months)"),
            integer("surveillanceMonths", true, 1, 60, "تدقيق المراقبة كل (شهور)", "Surveillance every (months)")),
        "دورة الشهادة", "Certification cycle", "صلاحية الشهادة وإيقاع تدقيقات المراقبة.", "Certificate validity and the surveillance rhythm."));

    // --- D-03 training ----------------------------------------------------------------------------------------
    add(new PolicyDefinition("training.certificate", "D-03", "TRAINING", Scope.COURSE, true,
        List.of(of("minAttendancePercent", Kind.PERCENT, true, "أقل نسبة حضور", "Minimum attendance"),
            of("passMark", Kind.PERCENT, false, "درجة النجاح (لو فيه تقييم)", "Pass mark (if assessed)")),
        "شروط شهادة التدريب", "Training certificate criteria",
        "منسق التدريب بيراجع اللي مستوفي الشروط وهو اللي بيصدر الشهادات.",
        "The training coordinator reviews who meets the criteria and issues the certificates."));
    add(new PolicyDefinition("training.national-id", "D-03", "TRAINING", Scope.COURSE, true,
        List.of(choice("collect", true, List.of("NOT_ASKED", "OPTIONAL", "REQUIRED"), "الرقم القومي", "National ID")),
        "جمع الرقم القومي", "National ID collection", "بيتخزن كبيانات محظورة لو اتجمع.", "Stored as restricted data when collected."));
    add(new PolicyDefinition("training.cancellation", "D-03", "TRAINING", Scope.BUSINESS_LINE, true,
        List.of(list("steps", true, 10, List.of(
            integer("daysBeforeStart", true, 0, 365, "قبل البداية بـ (أيام) أو أكتر", "At least (days) before start"),
            of("refundPercent", Kind.PERCENT, true, "نسبة الاسترداد", "Refund")),
            "خطوات الاسترداد", "Refund steps")),
        "إلغاء التدريب والاسترداد", "Training cancellation and refunds",
        "المبلغ بيتحسب من هنا، والمالية بتوافق، وبيطلع إشعار دائن.", "The amount comes from here; finance approves it and a credit note is issued."));

    // --- D-04 recruitment -------------------------------------------------------------------------------------
    add(new PolicyDefinition("recruitment.agreement", "D-04", "RECRUITMENT", Scope.CLIENT_AGREEMENT, true,
        List.of(of("feePercent", Kind.PERCENT, true, "نسبة الأتعاب من الراتب السنوي", "Fee (% of annual salary)"),
            choice("invoiceOn", true, List.of("START_DATE", "OFFER_ACCEPTED"), "الفاتورة عند", "Invoice on"),
            integer("guaranteeDays", true, 0, 365, "فترة الضمان بالأيام", "Guarantee (days)"),
            choice("replacement", true, List.of("REPLACE", "PARTIAL_REFUND", "NONE"), "لو المرشح مشي في الضمان", "If the candidate leaves in the guarantee"),
            of("refundPercent", Kind.PERCENT, false, "نسبة الاسترداد (لو استرداد جزئي)", "Refund (if partial refund)")),
        "اتفاقية التوظيف", "Recruitment agreement", "قيمة عامة، أو قيمة لكل عميل.", "A default, or one per client."));

    // --- D-10 external channels -------------------------------------------------------------------------------
    add(new PolicyDefinition("channels.enabled", "D-10", "CHANNELS", Scope.NONE, false,
        List.of(multi("channels", false, List.of("LEAD_FORMS", "CERTIFICATE_CHECK", "CLIENT_PORTAL", "COURSE_SIGNUP", "EMAIL", "WHATSAPP", "E_SIGNATURE",
            "PAYMENTS"), "القنوات المفعّلة", "Channels switched on")),
        "القنوات الخارجية", "External channels",
        "كل قناة بتشتغل بس لو مفعّلة هنا وبياناتها السرية متسجّلة في بيئة التشغيل.",
        "A channel works only when switched on here and its credentials are set in the environment."));
  }

  private PolicyCatalog() {}

  public static List<PolicyDefinition> all() {
    return List.copyOf(ALL.values());
  }

  public static PolicyDefinition get(String key) {
    PolicyDefinition definition = key == null ? null : ALL.get(key);
    if (definition == null) throw ApiException.notFound();
    return definition;
  }
}
