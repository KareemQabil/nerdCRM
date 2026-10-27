package com.ioeti.admin.service;

import com.axelor.apps.base.db.Company;
import com.axelor.apps.quality.db.QIAction;
import com.axelor.apps.quality.db.QIAnalysisMethod;
import com.axelor.apps.quality.db.QIAnalysisMethodItem;
import com.axelor.apps.quality.db.QICause;
import com.axelor.apps.quality.db.QIDefault;
import com.axelor.apps.quality.db.QIDetection;
import com.axelor.apps.quality.db.QIProcess;
import com.axelor.apps.quality.db.QIStatus;
import com.axelor.apps.quality.db.repo.QIDetectionRepository;
import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.User;
import com.axelor.db.JPA;
import com.axelor.db.Model;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.google.inject.persist.Transactional;
import com.ioeti.core.api.ApiException;
import jakarta.persistence.LockModeType;
import jakarta.persistence.PersistenceException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Objects;

/**
 * The company's quality set-up, managed from the platform (capability map, quality and corrective actions):
 * the statuses a quality issue goes through, where issues are found, the kinds of issue and the kinds of
 * corrective action, and for root-cause analysis the company's analysis methods with their branches (cause
 * categories, as on a cause-and-effect diagram), the causes under each branch and the company's processes. These are native axelor-quality records and are the company's own quality-system choices, so
 * none are shipped: until an administrator adds them, no issue can be raised and no cause recorded. A value
 * in use cannot be deleted (it is renamed instead). Every change goes to the admin audit trail.
 */
public class QualitySetup {

  public enum Kind {
    STATUS("statuses", "QI_STATUS"),
    DETECTION("detections", "QI_DETECTION"),
    ISSUE_TYPE("issue-types", "QI_ISSUE_TYPE"),
    ACTION_TYPE("action-types", "QI_ACTION_TYPE"),
    CAUSE("causes", "QI_CAUSE"),
    PROCESS("processes", "QI_PROCESS"),
    METHOD("methods", "QI_METHOD");

    public final String path;
    public final String subject;

    Kind(String path, String subject) {
      this.path = path;
      this.subject = subject;
    }

    public static Kind of(String path) {
      for (Kind kind : values()) if (kind.path.equals(path)) return kind;
      throw ApiException.notFound();
    }
  }

  /**
   * One value. Its flag is the status kind (OPEN, CLOSED, CANCELLED) or the detection origin
   * (INTERNAL, CUSTOMER, SUPPLIER); null for the other lists. Branches are an analysis method's, in order;
   * branchId/branchName are a cause's branch and ownerId/ownerName a process's owner; null for the other lists.
   */
  public record Entry(Long id, Integer version, String name, String code, String flag, Integer sequence, long uses, List<Branch> branches,
      Long branchId, String branchName, Long ownerId, String ownerName) {}

  /** One branch of an analysis method: a cause category (for example people, method, equipment). */
  public record Branch(Long id, String name, long causes) {}

  public List<Entry> list(Kind kind) {
    List<Entry> rows = new ArrayList<>();
    for (Model value : query(kind).fetch(500)) rows.add(entry(kind, value));
    rows.sort(kind == Kind.STATUS
        ? Comparator.comparing((Entry e) -> e.sequence() == null ? Integer.MAX_VALUE : e.sequence()).thenComparing(Entry::id)
        : Comparator.comparing((Entry e) -> e.name().toLowerCase(Locale.ROOT)));
    return rows;
  }

  @Transactional(rollbackOn = {Exception.class})
  public Entry add(Kind kind, String rawName, String rawFlag, Long branchId, Long ownerId) {
    String name = AdminService.text("name", rawName, 255, true);
    QIAnalysisMethodItem branch = kind == Kind.CAUSE ? branch(branchId) : null;
    User owner = kind == Kind.PROCESS ? owner(ownerId) : null;
    unique(kind, name, null);
    Model value = switch (kind) {
      case STATUS -> {
        QIStatus s = new QIStatus();
        s.setName(name);
        statusKind(s, rawFlag);
        s.setSequence(query(kind).fetch(500).stream().map(v -> ((QIStatus) v).getSequence()).filter(Objects::nonNull)
            .max(Integer::compare).orElse(0) + 10);
        yield s;
      }
      case DETECTION -> {
        QIDetection d = new QIDetection();
        d.setName(name);
        d.setCode(code(kind, "DET"));
        d.setOrigin(origin(rawFlag));
        d.setIsSystemOrigin(true);
        yield d;
      }
      case ISSUE_TYPE -> {
        QIDefault t = new QIDefault();
        t.setName(name);
        t.setCode(code(kind, "ISS"));
        t.setCompany(company());
        t.setIsSystemDefault(true);
        yield t;
      }
      case ACTION_TYPE -> {
        QIAction a = new QIAction();
        a.setName(name);
        a.setCode(code(kind, "ACT"));
        a.setCompany(company());
        a.setIsSystemAction(true);
        yield a;
      }
      case CAUSE -> {
        QICause c = new QICause();
        c.setName(name);
        c.setCode(code(kind, "CAU"));
        c.setCompany(company());
        c.setBranch(branch);
        yield c;
      }
      case PROCESS -> {
        QIProcess p = new QIProcess();
        p.setName(name);
        p.setCode(code(kind, "PRC"));
        p.setCompany(company());
        p.setManager(owner);
        yield p;
      }
      case METHOD -> {
        QIAnalysisMethod m = new QIAnalysisMethod();
        m.setName(name);
        m.setCode(code(kind, "MTH"));
        m.setCompany(company());
        m.setIsSystem(true);
        yield m;
      }
    };
    Model saved = JPA.save(value);
    Entry entry = entry(kind, saved);
    audit().audit(kind.subject + "_ADDED", kind.subject, saved.getId(), name,
        entry.flag() == null ? List.of("name") : List.of("name", "kind=" + entry.flag()));
    return entry;
  }

  /**
   * Renames a value and, for statuses and detections, changes its kind or origin; a cause can move to another
   * branch and a process to another owner.
   */
  @Transactional(rollbackOn = {Exception.class})
  public Entry update(Kind kind, Long id, Integer version, String rawName, String rawFlag, Long branchId, Long ownerId) {
    Model value = versioned(kind, id, version);
    Entry before = entry(kind, value);
    String name = AdminService.text("name", rawName, 255, true);
    unique(kind, name, id);
    switch (kind) {
      case STATUS -> { ((QIStatus) value).setName(name); if (rawFlag != null) statusKind((QIStatus) value, rawFlag); }
      case DETECTION -> { ((QIDetection) value).setName(name); if (rawFlag != null) ((QIDetection) value).setOrigin(origin(rawFlag)); }
      case ISSUE_TYPE -> ((QIDefault) value).setName(name);
      case ACTION_TYPE -> ((QIAction) value).setName(name);
      case CAUSE -> {
        ((QICause) value).setName(name);
        if (branchId != null) ((QICause) value).setBranch(branch(branchId));
      }
      case PROCESS -> {
        ((QIProcess) value).setName(name);
        if (ownerId != null) ((QIProcess) value).setManager(owner(ownerId));
      }
      case METHOD -> ((QIAnalysisMethod) value).setName(name);
    }
    Model saved = JPA.save(value);
    Entry after = entry(kind, saved);
    List<String> changes = new ArrayList<>();
    if (!before.name().equals(after.name())) changes.add("name=" + before.name() + "→" + after.name());
    if (!Objects.equals(before.flag(), after.flag())) changes.add("kind=" + before.flag() + "→" + after.flag());
    if (!Objects.equals(before.branchName(), after.branchName())) changes.add("branch=" + before.branchName() + "→" + after.branchName());
    if (!Objects.equals(before.ownerName(), after.ownerName())) changes.add("owner=" + before.ownerName() + "→" + after.ownerName());
    if (!changes.isEmpty()) audit().audit(kind.subject + "_CHANGED", kind.subject, id, name, changes);
    return after;
  }

  @Transactional(rollbackOn = {Exception.class})
  public void delete(Kind kind, Long id, Integer version) {
    Model value = versioned(kind, id, version);
    Entry entry = entry(kind, value);
    if (entry.uses() > 0) throw new ApiException(409, "IN_USE", "This value is in use; rename it instead.", null);
    try {
      JPA.remove(value);
      JPA.flush();
    } catch (PersistenceException e) {
      throw new ApiException(409, "IN_USE", "This value is in use; rename it instead.", null);
    }
    audit().audit(kind.subject + "_DELETED", kind.subject, id, entry.name(), List.of("deleted"));
  }

  /** Adds a branch (cause category) at the end of an analysis method; the method's version moves. */
  @Transactional(rollbackOn = {Exception.class})
  public Entry addBranch(Long methodId, Integer version, String rawName) {
    QIAnalysisMethod method = (QIAnalysisMethod) versioned(Kind.METHOD, methodId, version);
    String name = AdminService.text("name", rawName, 255, true);
    if (branches(method).stream().anyMatch(b -> b.getName().equalsIgnoreCase(name))) {
      throw ApiException.invalidField("name", "DUPLICATE", "This branch is already in the method.");
    }
    QIAnalysisMethodItem branch = new QIAnalysisMethodItem();
    branch.setName(name);
    branch.setCode(method.getCode() + "-" + (JPA.em().createQuery(
        "SELECT COUNT(x) FROM QIAnalysisMethodItem x WHERE x.analysisMethod = ?1", Long.class).setParameter(1, method).getSingleResult() + 1));
    while (Query.of(QIAnalysisMethodItem.class).filter("self.code = ?1", branch.getCode()).count() > 0) branch.setCode(branch.getCode() + "'");
    branch.setCompany(method.getCompany());
    method.addQiAnalysisMethodItemListItem(branch);
    JPA.em().lock(method, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    JPA.save(method);
    audit().audit("QI_METHOD_BRANCH_ADDED", Kind.METHOD.subject, methodId, method.getName(), List.of("branch=" + name));
    return entry(Kind.METHOD, method);
  }

  /** Removes a branch without causes from an analysis method (409 IN_USE otherwise); the method's version moves. */
  @Transactional(rollbackOn = {Exception.class})
  public Entry deleteBranch(Long methodId, Integer version, Long branchId) {
    QIAnalysisMethod method = (QIAnalysisMethod) versioned(Kind.METHOD, methodId, version);
    QIAnalysisMethodItem branch = branches(method).stream().filter(b -> b.getId().equals(branchId)).findFirst().orElseThrow(ApiException::notFound);
    if (count("SELECT COUNT(x) FROM QICause x WHERE x.branch = ?1", branch) > 0) {
      throw new ApiException(409, "IN_USE", "This branch has causes; move or delete them first.", null);
    }
    method.removeQiAnalysisMethodItemListItem(branch);
    JPA.remove(branch);
    JPA.em().lock(method, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    JPA.save(method);
    audit().audit("QI_METHOD_BRANCH_DELETED", Kind.METHOD.subject, methodId, method.getName(), List.of("branch=" + branch.getName()));
    return entry(Kind.METHOD, method);
  }

  /** A method's branches in the order they were added. */
  public static List<QIAnalysisMethodItem> branches(QIAnalysisMethod method) {
    return Query.of(QIAnalysisMethodItem.class).filter("self.analysisMethod = ?1", method).order("id").fetch(100);
  }

  /** A process's owner: an active person (the native process requires one). */
  private static User owner(Long ownerId) {
    if (ownerId == null) throw ApiException.invalidField("ownerId", "REQUIRED", "Choose who owns the process.");
    User owner = JPA.find(User.class, ownerId);
    if (owner == null || Boolean.TRUE.equals(owner.getBlocked())) throw ApiException.invalidField("ownerId", "UNAVAILABLE", "Choose an active person.");
    return owner;
  }

  /** A branch of one of the company's analysis methods: a cause belongs to one. */
  private static QIAnalysisMethodItem branch(Long branchId) {
    if (branchId == null) throw ApiException.invalidField("branchId", "REQUIRED", "Choose the branch (cause category) the cause belongs to.");
    QIAnalysisMethodItem branch = Query.of(QIAnalysisMethodItem.class)
        .filter("self.id = ?1 AND self.analysisMethod.isSystem = true AND self.analysisMethod.company = ?2", branchId, company()).fetchOne();
    if (branch == null) throw ApiException.invalidField("branchId", "UNAVAILABLE", "Choose a branch of one of the company's analysis methods.");
    return branch;
  }

  // --- helpers -----------------------------------------------------------------------------------

  private static AdminService audit() { return Beans.get(AdminService.class); }

  @SuppressWarnings("unchecked")
  private static Class<Model> type(Kind kind) {
    return (Class<Model>) (Class<?>) switch (kind) {
      case STATUS -> QIStatus.class;
      case DETECTION -> QIDetection.class;
      case ISSUE_TYPE -> QIDefault.class;
      case ACTION_TYPE -> QIAction.class;
      case CAUSE -> QICause.class;
      case PROCESS -> QIProcess.class;
      case METHOD -> QIAnalysisMethod.class;
    };
  }

  /**
   * Detections, issue and action types and analysis methods used for system (service) quality; statuses,
   * causes and processes are shared with product quality.
   */
  private static String scope(Kind kind) {
    return switch (kind) {
      case STATUS, CAUSE, PROCESS -> "self.id IS NOT NULL";
      case DETECTION -> "self.isSystemOrigin = true";
      case ISSUE_TYPE -> "self.isSystemDefault = true";
      case ACTION_TYPE -> "self.isSystemAction = true";
      case METHOD -> "self.isSystem = true";
    };
  }

  private static Query<Model> query(Kind kind) {
    return Query.of(type(kind)).filter(scope(kind));
  }

  private static Model versioned(Kind kind, Long id, Integer version) {
    if (version == null) throw ApiException.badRequest("Record version is required.");
    Model value = id == null ? null : Query.of(type(kind)).filter(scope(kind) + " AND self.id = ?1", id).fetchOne();
    if (value == null) throw ApiException.notFound();
    if (!Objects.equals(value.getVersion(), version)) throw ApiException.conflict();
    return value;
  }

  private static String nameOf(Model value) {
    if (value instanceof QIStatus s) return s.getName();
    if (value instanceof QIDetection d) return d.getName();
    if (value instanceof QIDefault t) return t.getName();
    if (value instanceof QICause c) return c.getName();
    if (value instanceof QIProcess p) return p.getName();
    if (value instanceof QIAnalysisMethod m) return m.getName();
    return ((QIAction) value).getName();
  }

  private static void unique(Kind kind, String name, Long except) {
    boolean taken = query(kind).fetch(500).stream()
        .anyMatch(other -> nameOf(other).equalsIgnoreCase(name) && !other.getId().equals(except));
    if (taken) throw ApiException.invalidField("name", "DUPLICATE", "This name is already in the list.");
  }

  private static void statusKind(QIStatus status, String flag) {
    switch (flag == null ? "" : flag.strip()) {
      case "OPEN" -> { status.setIsClosedStatus(false); status.setIsCancelledStatus(false); }
      case "CLOSED" -> { status.setIsClosedStatus(true); status.setIsCancelledStatus(false); }
      case "CANCELLED" -> { status.setIsClosedStatus(false); status.setIsCancelledStatus(true); }
      default -> throw ApiException.invalidField("kind", "UNAVAILABLE", "Use OPEN, CLOSED or CANCELLED.");
    }
  }

  private static int origin(String flag) {
    return switch (flag == null ? "" : flag.strip()) {
      case "INTERNAL" -> QIDetectionRepository.ORIGIN_INTERNAL;
      case "CUSTOMER" -> QIDetectionRepository.ORIGIN_CUSTOMER;
      case "SUPPLIER" -> QIDetectionRepository.ORIGIN_SUPPLIER;
      default -> throw ApiException.invalidField("kind", "UNAVAILABLE", "Use INTERNAL, CUSTOMER or SUPPLIER.");
    };
  }

  public static String statusKind(QIStatus status) {
    if (Boolean.TRUE.equals(status.getIsCancelledStatus())) return "CANCELLED";
    if (Boolean.TRUE.equals(status.getIsClosedStatus())) return "CLOSED";
    return "OPEN";
  }

  public static String origin(QIDetection detection) {
    Integer origin = detection.getOrigin();
    if (origin == null) return null;
    return origin == QIDetectionRepository.ORIGIN_CUSTOMER ? "CUSTOMER" : origin == QIDetectionRepository.ORIGIN_SUPPLIER ? "SUPPLIER" : "INTERNAL";
  }

  /** The company issue and action types, causes, processes and methods belong to: the active company, else the only one. */
  private static Company company() {
    User me = AuthUtils.getUser();
    if (me != null && me.getActiveCompany() != null) return me.getActiveCompany();
    List<Company> companies = Query.of(Company.class).fetch(2);
    if (companies.size() == 1) return companies.get(0);
    throw new ApiException(422, "COMPANY_REQUIRED", "Choose your active company first; these values belong to a company.", null);
  }

  /** A short identifier (the name is what people see): the next free PREFIX-n. */
  private static String code(Kind kind, String prefix) {
    long n = JPA.em().createQuery("SELECT COUNT(x) FROM " + type(kind).getSimpleName() + " x", Long.class).getSingleResult();
    String code;
    do { code = prefix + "-" + (++n); } while (Query.of(type(kind)).filter("self.code = ?1", code).count() > 0);
    return code;
  }

  private static long count(String jpql, Model value) {
    return JPA.em().createQuery(jpql, Long.class).setParameter(1, value).getSingleResult();
  }

  private static Entry entry(Kind kind, Model value) {
    return switch (kind) {
      case STATUS -> {
        QIStatus s = (QIStatus) value;
        yield new Entry(s.getId(), s.getVersion(), s.getName(), null, statusKind(s), s.getSequence(),
            count("SELECT COUNT(x) FROM QualityImprovement x WHERE x.qiStatus = ?1", value), null, null, null, null, null);
      }
      case DETECTION -> {
        QIDetection d = (QIDetection) value;
        yield new Entry(d.getId(), d.getVersion(), d.getName(), d.getCode(), origin(d), null,
            count("SELECT COUNT(x) FROM QualityImprovement x WHERE x.qiDetection = ?1", value), null, null, null, null, null);
      }
      case ISSUE_TYPE -> {
        QIDefault t = (QIDefault) value;
        yield new Entry(t.getId(), t.getVersion(), t.getName(), t.getCode(), null, null,
            count("SELECT COUNT(x) FROM QIResolutionDefault x WHERE x.qiDefault = ?1", value), null, null, null, null, null);
      }
      case ACTION_TYPE -> {
        QIAction a = (QIAction) value;
        yield new Entry(a.getId(), a.getVersion(), a.getName(), a.getCode(), null, null,
            count("SELECT COUNT(x) FROM CorrectiveAction x WHERE x.actionType = ?1", value)
                + count("SELECT COUNT(x) FROM QITask x WHERE x.qiAction = ?1", value), null, null, null, null, null);
      }
      case CAUSE -> {
        QICause c = (QICause) value;
        yield new Entry(c.getId(), c.getVersion(), c.getName(), c.getCode(), null, null,
            count("SELECT COUNT(x) FROM QIAnalysisCause x WHERE x.qiCause = ?1", value), null,
            c.getBranch() == null ? null : c.getBranch().getId(), c.getBranch() == null ? null : c.getBranch().getName(), null, null);
      }
      case PROCESS -> {
        QIProcess p = (QIProcess) value;
        yield new Entry(p.getId(), p.getVersion(), p.getName(), p.getCode(), null, null,
            count("SELECT COUNT(x) FROM QIAnalysisCause x WHERE x.qiProcess = ?1", value)
                + count("SELECT COUNT(x) FROM QITask x WHERE x.qiProcess = ?1", value), null, null, null,
            p.getManager() == null ? null : p.getManager().getId(), p.getManager() == null ? null : p.getManager().getName());
      }
      case METHOD -> {
        QIAnalysisMethod m = (QIAnalysisMethod) value;
        yield new Entry(m.getId(), m.getVersion(), m.getName(), m.getCode(), null, null,
            count("SELECT COUNT(x) FROM QualityImprovement x WHERE x.analysisMethod = ?1", value),
            branches(m).stream().map(b -> new Branch(b.getId(), b.getName(), count("SELECT COUNT(x) FROM QICause x WHERE x.branch = ?1", b))).toList(),
            null, null, null, null);
      }
    };
  }
}
