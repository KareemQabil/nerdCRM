package com.ioeti.admin.service;

import com.axelor.auth.db.Group;
import com.axelor.auth.db.Permission;
import com.axelor.auth.db.Role;
import com.axelor.db.JPA;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.google.inject.persist.Transactional;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.policy.PolicyService;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * D-07 (signed 2026-10-25): editable role templates, deny by default.
 *
 * <ul>
 *   <li>A <b>template</b> names a job (sales rep, sales manager, GM, …) and the role the platform's policies refer to
 *       ({@code ioeti-sales-manager}, {@code ioeti-gm}, …). A profile created from it starts with <b>no rights</b>.
 *   <li>Rights are native Axelor permissions on the profile (group): read, write, create, remove per record type, with a
 *       scope from SEC-003 (own, team, business line, all) where the record type carries that field. The platform's
 *       endpoints already enforce them; this class only writes them.
 *   <li>The <b>policy owner</b> is not a template here: owners are appointed by owners under Policies (P1), so an
 *       administrator cannot grant themselves the right to change business rules.
 *   <li>The administrators' profile is fixed. A right on a profile that is managed elsewhere (a permission this class did
 *       not write, for the same record type) is shown but not edited, because Axelor adds rights up and a second
 *       permission would widen it.
 * </ul>
 */
public class RoleAdmin {

  public record Template(String code, String role, String nameAr, String nameEn) {}

  /** The jobs named in D-07, policy owner aside. Each grants its role and no rights. */
  public static final List<Template> TEMPLATES = List.of(
      new Template("SALES_REP", "ioeti-sales-rep", "مندوب مبيعات", "Sales rep"),
      new Template("SALES_MANAGER", "ioeti-sales-manager", "مدير مبيعات", "Sales manager"),
      new Template("GM", "ioeti-gm", "المدير العام", "General manager"),
      new Template("MARKETING", "ioeti-marketing", "تسويق", "Marketing"),
      new Template("OPERATIONS", "ioeti-operations", "تشغيل", "Operations"),
      new Template("AUDITOR_TRAINER", "ioeti-auditor-trainer", "مراجع / مدرب", "Auditor / trainer"),
      new Template("FINANCE", "ioeti-finance", "مالية", "Finance"),
      new Template("FUNDRAISING", "ioeti-fundraising", "تنمية موارد", "Fundraising"),
      new Template("READ_ONLY", "ioeti-read-only", "اطلاع فقط", "Read only"));

  public static final String OWN = "OWN", TEAM = "TEAM", LINE = "LINE", ALL = "ALL";
  static final Map<String, String> PARAMS = Map.of(OWN, "__user__", TEAM, "__user__.teamSet", LINE, "__user__.ioetiBusinessLines");

  /** A record type the platform's screens check, with the scopes its fields allow (condition per scope; ALL has none). */
  public record RecordType(String key, String model, String area, String nameAr, String nameEn, boolean restricted,
      Map<String, String> scopes) {}

  private static RecordType type(String key, String model, String area, String ar, String en, String... scopeConditions) {
    Map<String, String> scopes = new LinkedHashMap<>();
    for (int i = 0; i + 1 < scopeConditions.length; i += 2) scopes.put(scopeConditions[i], scopeConditions[i + 1]);
    return new RecordType(key, model, area, ar, en, false, scopes);
  }

  private static RecordType restricted(String key, String model, String area, String ar, String en) {
    return new RecordType(key, model, area, ar, en, true, Map.of());
  }

  public static final List<RecordType> TYPES = List.of(
      type("Lead", "com.axelor.apps.crm.db.Lead", "SALES", "العملاء المحتملون", "Leads",
          OWN, "self.user = ?", TEAM, "self.team in (?)", LINE, "self.ioetiBusinessLine in (?)"),
      type("Partner", "com.axelor.apps.base.db.Partner", "SALES", "الحسابات وجهات الاتصال", "Accounts and contacts",
          OWN, "self.user = ?", TEAM, "self.team in (?)"),
      type("Opportunity", "com.axelor.apps.crm.db.Opportunity", "SALES", "الفرص", "Opportunities",
          OWN, "self.user = ?", TEAM, "self.team in (?)", LINE, "self.ioetiBusinessLine in (?)"),
      type("Event", "com.axelor.apps.crm.db.Event", "SALES", "الأنشطة", "Activities", OWN, "self.user = ?"),
      type("SaleOrder", "com.axelor.apps.sale.db.SaleOrder", "SALES", "عروض الأسعار", "Quotations",
          OWN, "self.salespersonUser = ?", TEAM, "self.team in (?)", LINE, "self.opportunity.ioetiBusinessLine in (?)"),
      type("SaleOrderLine", "com.axelor.apps.sale.db.SaleOrderLine", "SALES", "بنود عروض الأسعار", "Quotation lines",
          OWN, "self.saleOrder.salespersonUser = ?", LINE, "self.saleOrder.opportunity.ioetiBusinessLine in (?)"),
      type("Timetable", "com.axelor.apps.supplychain.db.Timetable", "SALES", "دفعات السداد", "Payment milestones",
          OWN, "self.saleOrder.salespersonUser = ?"),
      type("Contract", "com.axelor.apps.contract.db.Contract", "SALES", "العقود", "Contracts",
          OWN, "self.opportunity.user = ?", LINE, "self.opportunity.ioetiBusinessLine in (?)"),
      type("ContractLine", "com.axelor.apps.contract.db.ContractLine", "SALES", "بنود العقود", "Contract lines"),
      type("Product", "com.axelor.apps.base.db.Product", "SALES", "كتالوج الخدمات", "Service catalogue"),
      type("Campaign", "com.axelor.apps.marketing.db.Campaign", "SALES", "الحملات", "Campaigns"),
      type("Source", "com.axelor.apps.base.db.Source", "SALES", "مصادر العملاء", "Lead sources"),
      type("ReviewRequest", "com.ioeti.workspace.db.ReviewRequest", "SALES", "طلبات المراجعة", "Review requests"),
      type("InvoiceRequest", "com.ioeti.workspace.db.InvoiceRequest", "FINANCE", "طلبات الفوترة", "Invoice requests"),
      type("Invoice", "com.axelor.apps.account.db.Invoice", "FINANCE", "الفواتير", "Invoices"),
      type("InvoicePayment", "com.axelor.apps.account.db.InvoicePayment", "FINANCE", "التحصيلات", "Collections"),
      type("CurrencyConversionLine", "com.axelor.apps.base.db.CurrencyConversionLine", "FINANCE", "أسعار الصرف", "Exchange rates"),
      type("HandoverRequest", "com.ioeti.operations.db.HandoverRequest", "DELIVERY", "طلبات التسليم", "Handover requests"),
      type("HandoverRequirement", "com.ioeti.operations.db.HandoverRequirement", "DELIVERY", "متطلبات التسليم", "Handover requirements"),
      type("HandoverEvent", "com.ioeti.operations.db.HandoverEvent", "DELIVERY", "سجل التسليم", "Handover history"),
      type("Project", "com.axelor.apps.project.db.Project", "DELIVERY", "المشروعات", "Engagements"),
      type("ProjectTask", "com.axelor.apps.project.db.ProjectTask", "DELIVERY", "مهام المشروعات", "Engagement tasks"),
      type("Intervention", "com.axelor.apps.intervention.db.Intervention", "DELIVERY", "الزيارات الميدانية", "Field visits"),
      type("QualityImprovement", "com.axelor.apps.quality.db.QualityImprovement", "DELIVERY", "مشاكل الجودة", "Quality issues"),
      type("CertificationCycle", "com.ioeti.certification.db.CertificationCycle", "CERTIFICATION", "دورات الاعتماد", "Certification cycles"),
      type("CertificationAudit", "com.ioeti.certification.db.CertificationAudit", "CERTIFICATION", "التدقيقات", "Audits"),
      type("Nonconformity", "com.ioeti.certification.db.Nonconformity", "CERTIFICATION", "حالات عدم المطابقة", "Nonconformities"),
      type("AuditorQualification", "com.ioeti.certification.db.AuditorQualification", "CERTIFICATION", "مؤهلات المراجعين", "Auditor qualifications"),
      type("TrainingCourse", "com.ioeti.training.db.TrainingCourse", "TRAINING", "الدورات", "Courses"),
      type("TrainingCohort", "com.ioeti.training.db.TrainingCohort", "TRAINING", "الدفعات", "Cohorts"),
      type("CohortSession", "com.ioeti.training.db.CohortSession", "TRAINING", "الجلسات", "Sessions"),
      type("TrainingEnrollment", "com.ioeti.training.db.TrainingEnrollment", "TRAINING", "التسجيلات", "Enrolments"),
      type("TrainingAttendance", "com.ioeti.training.db.TrainingAttendance", "TRAINING", "الحضور", "Attendance"),
      type("ClientJobOrder", "com.ioeti.recruitment.db.ClientJobOrder", "RECRUITMENT", "طلبات التوظيف", "Job orders"),
      type("RecruitmentCandidate", "com.ioeti.recruitment.db.RecruitmentCandidate", "RECRUITMENT", "المرشحون", "Candidates"),
      restricted("CandidatePrivateProfile", "com.ioeti.recruitment.db.CandidatePrivateProfile", "RECRUITMENT", "بيانات المرشح الخاصة", "Candidate private data"),
      type("CandidateConsent", "com.ioeti.recruitment.db.CandidateConsent", "RECRUITMENT", "موافقات المرشحين", "Candidate consents"),
      type("CandidateApplication", "com.ioeti.recruitment.db.CandidateApplication", "RECRUITMENT", "طلبات المرشحين", "Applications"),
      type("ClientInterview", "com.ioeti.recruitment.db.ClientInterview", "RECRUITMENT", "المقابلات", "Interviews"),
      type("Placement", "com.ioeti.recruitment.db.Placement", "RECRUITMENT", "التعيينات", "Placements"),
      type("DonorProfile", "com.ioeti.fundraising.db.DonorProfile", "FUNDRAISING", "المانحون", "Donors"),
      restricted("DonorSensitiveProfile", "com.ioeti.fundraising.db.DonorSensitiveProfile", "FUNDRAISING", "بيانات المانح الخاصة", "Donor private data"),
      type("FundingOpportunity", "com.ioeti.fundraising.db.FundingOpportunity", "FUNDRAISING", "فرص التمويل", "Funding opportunities"),
      type("FundingCommitment", "com.ioeti.fundraising.db.FundingCommitment", "FUNDRAISING", "التعهدات", "Pledges and grants"),
      type("PledgeInstallment", "com.ioeti.fundraising.db.PledgeInstallment", "FUNDRAISING", "أقساط التعهدات", "Pledge instalments"),
      type("DonationCollection", "com.ioeti.fundraising.db.DonationCollection", "FUNDRAISING", "التبرعات المحصلة", "Collected donations"),
      type("GrantDeliverable", "com.ioeti.fundraising.db.GrantDeliverable", "FUNDRAISING", "مخرجات المنح", "Grant deliverables"),
      type("StewardshipActivity", "com.ioeti.fundraising.db.StewardshipActivity", "FUNDRAISING", "متابعة المانحين", "Stewardship"),
      type("KnowledgeArticle", "com.ioeti.content.db.KnowledgeArticle", "CONTENT", "مقالات المعرفة", "Knowledge articles"),
      type("KnowledgeCategory", "com.ioeti.content.db.KnowledgeCategory", "CONTENT", "تصنيفات المعرفة", "Knowledge categories"),
      type("BusinessLine", "com.ioeti.businessline.db.BusinessLine", "ADMIN", "خطوط الأعمال", "Business lines",
          LINE, "self in (?)"));

  static final Pattern PROFILE_CODE = Pattern.compile("[a-z][a-z0-9-]{2,39}");

  public static Template template(String code) {
    if (code == null || code.isBlank()) throw ApiException.invalidField("template", "REQUIRED", "Choose a template.");
    return TEMPLATES.stream().filter(t -> t.code().equals(code)).findFirst()
        .orElseThrow(() -> ApiException.invalidField("template", "UNKNOWN", "This template does not exist."));
  }

  public static RecordType recordType(String key) {
    return TYPES.stream().filter(t -> t.key().equals(key)).findFirst()
        .orElseThrow(() -> ApiException.invalidField("object", "UNKNOWN", "This record type cannot be granted here."));
  }

  public static String profileCode(String value) {
    String code = AdminService.text("code", value, 40, true).toLowerCase(Locale.ROOT);
    if (!PROFILE_CODE.matcher(code).matches()) {
      throw ApiException.invalidField("code", "FORMAT", "Use 3 to 40 lower-case letters, digits or dashes, starting with a letter.");
    }
    if (AdminService.ADMIN_GROUP.equals(code)) throw ApiException.invalidField("code", "TAKEN", "This code is already used.");
    return code;
  }

  /** The permission this class manages for a profile and record type. */
  static String permissionName(Group group, RecordType type) {
    return "ioeti." + group.getCode() + "." + type.key();
  }

  /** The scope a managed permission grants, read back from its condition. */
  public static String scopeOf(RecordType type, Permission permission) {
    String condition = permission.getCondition();
    if (condition == null || condition.isBlank()) return ALL;
    return type.scopes().entrySet().stream().filter(e -> e.getValue().equals(condition)).map(Map.Entry::getKey).findFirst().orElse(null);
  }

  // --- commands --------------------------------------------------------------------------------------

  @Transactional(rollbackOn = {Exception.class})
  public Group createProfile(String code, String name, Template template) {
    String clean = profileCode(code);
    String label = AdminService.text("name", name, 100, true);
    if (Query.of(Group.class).filter("self.code = ?1", clean).count() > 0) {
      throw ApiException.invalidField("code", "TAKEN", "This code is already used.");
    }
    if (Query.of(Group.class).filter("LOWER(self.name) = ?1", label.toLowerCase(Locale.ROOT)).count() > 0) {
      throw ApiException.invalidField("name", "TAKEN", "This name is already used.");
    }
    Group group = new Group(clean, label);
    group.setRoles(new HashSet<>(List.of(role(template.role()))));
    group.setPermissions(new HashSet<>());
    group.setTechnicalStaff(false);
    JPA.save(group);
    Beans.get(AdminService.class).audit("PROFILE_CREATED", "PROFILE", group.getId(), clean,
        List.of("template=" + template.code(), "role=" + template.role(), "rights=none"));
    return group;
  }

  /**
   * Sets what a profile may do with one record type. All four actions off removes the right. A scope the record type
   * does not carry is refused; a right managed elsewhere on the same record type is refused rather than widened.
   */
  @Transactional(rollbackOn = {Exception.class})
  public void setRight(Group group, RecordType type, boolean read, boolean write, boolean create, boolean remove, String scope) {
    if (AdminService.isAdminProfile(group)) {
      throw new ApiException(422, "ADMIN_PROFILE_FIXED", "The administrators' profile is not edited here.", null);
    }
    boolean any = read || write || create || remove;
    if ((write || create || remove) && !read) {
      throw ApiException.invalidField("read", "REQUIRED", "A profile that changes records must be able to read them.");
    }
    String chosen = scope == null || scope.isBlank() ? ALL : scope;
    if (any && !ALL.equals(chosen) && !type.scopes().containsKey(chosen)) {
      throw ApiException.invalidField("scope", "UNAVAILABLE", "This record type has no such scope.");
    }
    String name = permissionName(group, type);
    Permission mine = null;
    for (Permission p : group.getPermissions() == null ? List.<Permission>of() : group.getPermissions()) {
      if (!type.model().equals(p.getObject())) continue;
      if (name.equals(p.getName())) mine = p;
      else throw new ApiException(422, "RIGHT_MANAGED_ELSEWHERE", "This profile already has a right on this record type that is managed elsewhere.", null);
    }
    String before = mine == null ? "none" : describe(type, mine);
    if (!any) {
      if (mine == null) return;
      group.removePermission(mine);
      JPA.remove(mine);
    } else {
      if (mine == null) {
        mine = new Permission(name);
        mine.setObject(type.model());
        group.addPermission(mine);
      }
      mine.setCanRead(read);
      mine.setCanWrite(write);
      mine.setCanCreate(create);
      mine.setCanRemove(remove);
      mine.setCanExport(false);
      mine.setCanImport(false);
      mine.setCondition(ALL.equals(chosen) ? null : type.scopes().get(chosen));
      mine.setConditionParams(ALL.equals(chosen) ? null : PARAMS.get(chosen));
      JPA.save(mine);
    }
    // the profile's version moves with its rights, so concurrent editors are told
    JPA.em().lock(group, jakarta.persistence.LockModeType.OPTIMISTIC_FORCE_INCREMENT);
    String after = any ? describe(type, mine) : "none";
    if (!Objects.equals(before, after)) {
      Beans.get(AdminService.class).audit("PROFILE_RIGHT_SET", "PROFILE", group.getId(), group.getCode(),
          List.of(type.key() + ": " + before + "→" + after));
    }
  }

  static String describe(RecordType type, Permission p) {
    List<String> actions = new ArrayList<>();
    if (Boolean.TRUE.equals(p.getCanRead())) actions.add("read");
    if (Boolean.TRUE.equals(p.getCanWrite())) actions.add("write");
    if (Boolean.TRUE.equals(p.getCanCreate())) actions.add("create");
    if (Boolean.TRUE.equals(p.getCanRemove())) actions.add("remove");
    return String.join("+", actions) + "@" + Optional.ofNullable(scopeOf(type, p)).orElse("CUSTOM");
  }

  /** The role a template grants; created once, without rights of its own (rights live on profiles). */
  static Role role(String name) {
    Role role = Query.of(Role.class).filter("self.name = ?1", name).fetchOne();
    if (role != null) return role;
    if (PolicyService.OWNER_ROLE.equals(name)) throw new IllegalArgumentException("The policy owner is appointed under Policies.");
    role = new Role(name);
    return JPA.save(role);
  }
}
