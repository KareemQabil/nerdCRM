package com.ioeti.operations.service;

import com.axelor.apps.base.AxelorException;
import com.axelor.apps.base.db.Company;
import com.axelor.apps.base.db.Partner;
import com.axelor.apps.base.db.repo.TraceBackRepository;
import com.axelor.apps.project.db.Project;
import com.axelor.apps.quality.db.QIAction;
import com.axelor.apps.quality.db.QIAnalysis;
import com.axelor.apps.quality.db.QIDefault;
import com.axelor.apps.quality.db.QIDetection;
import com.axelor.apps.quality.db.QIIdentification;
import com.axelor.apps.quality.db.QIResolution;
import com.axelor.apps.quality.db.QIResolutionDefault;
import com.axelor.apps.quality.db.QIStatus;
import com.axelor.apps.quality.db.QualityImprovement;
import com.axelor.apps.quality.db.repo.QIAnalysisRepository;
import com.axelor.apps.quality.db.repo.QIDetectionRepository;
import com.axelor.apps.quality.db.repo.QualityImprovementRepository;
import com.axelor.apps.quality.service.QualityImprovementCheckValuesService;
import com.axelor.apps.quality.service.QualityImprovementService;
import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.User;
import com.axelor.db.JPA;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.google.inject.persist.Transactional;
import com.ioeti.core.api.ApiException;
import com.ioeti.operations.db.CorrectiveAction;
import com.ioeti.operations.db.repo.CorrectiveActionRepository;
import jakarta.persistence.LockModeType;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/**
 * Quality issues and their corrective actions (capability map). An issue is the native system-type
 * QualityImprovement: where it was found, how grave it is, what happened (its first native defect line),
 * who owns the plan, its objective and how its effectiveness will be judged, and the company's own
 * statuses. Corrective actions are assigned to people with a due date; the native analysis progress
 * follows the share of actions done. Nothing is sent to a client or supplier (D-10).
 */
public class QualityService {

  public static final int CRITICAL = QualityImprovementRepository.GRAVITY_TYPE_SELECT_CRITICAL,
      MAJOR = QualityImprovementRepository.GRAVITY_TYPE_SELECT_MAJOR, MINOR = QualityImprovementRepository.GRAVITY_TYPE_SELECT_MINOR;

  public static String gravity(QualityImprovement qi) {
    Integer g = qi.getGravityTypeSelect();
    if (g == null) return null;
    return g == CRITICAL ? "CRITICAL" : g == MAJOR ? "MAJOR" : "MINOR";
  }

  public static String effectiveness(QIAnalysis analysis) {
    Integer e = analysis == null ? null : analysis.getEfficiencySelect();
    if (e == null || e == QIAnalysisRepository.EFFICIENCY_NO_CHECKED) return "NOT_CHECKED";
    return e == QIAnalysisRepository.EFFICIENCY_YES ? "EFFECTIVE" : "NOT_EFFECTIVE";
  }

  /** The issue's first native defect line: what happened. */
  public static QIResolutionDefault issue(QualityImprovement qi) {
    QIResolution resolution = qi.getQiResolution();
    if (resolution == null || resolution.getQiResolutionDefaultsList() == null || resolution.getQiResolutionDefaultsList().isEmpty()) return null;
    return resolution.getQiResolutionDefaultsList().get(0);
  }

  @Transactional(rollbackOn = {Exception.class})
  public QualityImprovement raise(Company company, QIDetection detection, QIDefault issueType, int gravity, String title, String details,
      Partner account, Project project, LocalDateTime now) {
    User me = AuthUtils.getUser();
    QualityImprovement qi = new QualityImprovement();
    qi.setType(QualityImprovementRepository.TYPE_SYSTEM);
    qi.setGravityTypeSelect(gravity);
    qi.setQiDetection(detection);

    QIIdentification identification = new QIIdentification();
    identification.setWrittenBy(me);
    identification.setWrittenOn(now);
    if (account != null) {
      if (detection.getOrigin() == QIDetectionRepository.ORIGIN_SUPPLIER) identification.setSupplierPartner(account);
      else identification.setCustomerPartner(account);
    }
    identification.setProject(project);

    QIResolution resolution = new QIResolution();
    resolution.setDefaultWrittenBy(me);
    resolution.setDefaultWrittenOn(now);
    QIResolutionDefault line = new QIResolutionDefault();
    line.setName(title);
    line.setDescription(details);
    line.setQiDefault(issueType);
    resolution.addQiResolutionDefaultsListItem(line);

    QIAnalysis analysis = new QIAnalysis();
    analysis.setQi(qi);
    analysis.setPlanOwner(me);
    analysis.setEfficiencySelect(QIAnalysisRepository.EFFICIENCY_NO_CHECKED);
    analysis.setAdvancement(0);
    qi.setQiAnalysis(analysis);
    // the native creation steps (QualityImprovementCreateService), with the company chosen by the caller's
    // context rather than only the active company, which an administrator may not have set
    identification.setQi(qi);
    resolution.setQi(qi);
    qi.setQiIdentification(identification);
    qi.setQiResolution(resolution);
    qi.setCompany(company);
    try {
      qi.setQiStatus(Beans.get(QualityImprovementService.class).getDefaultQIStatus());
      Beans.get(QualityImprovementCheckValuesService.class).checkQualityImprovementValues(qi);
      return Beans.get(QualityImprovementRepository.class).save(qi);
    } catch (AxelorException e) {
      ApiException refusal = nativeRefusal(e);
      throw refusal != null ? refusal : new IllegalStateException(e);
    }
  }

  @Transactional(rollbackOn = {Exception.class})
  public QualityImprovement plan(QualityImprovement qi, User owner, String objective, String criteria, LocalDate earliest, LocalDate latest) {
    QIAnalysis analysis = analysis(qi);
    analysis.setPlanOwner(owner);
    analysis.setObjective(objective);
    analysis.setEfficiencyCriteria(criteria);
    analysis.setEarliestDate(earliest);
    analysis.setLatestDate(latest);
    touched(qi);
    return Beans.get(QualityImprovementRepository.class).save(qi);
  }

  @Transactional(rollbackOn = {Exception.class})
  public QualityImprovement move(QualityImprovement qi, QIStatus status) {
    qi.setQiStatus(status);
    return Beans.get(QualityImprovementRepository.class).save(qi);
  }

  @Transactional(rollbackOn = {Exception.class})
  public QualityImprovement checkEffectiveness(QualityImprovement qi, boolean effective, String check, LocalDateTime now) {
    QIAnalysis analysis = analysis(qi);
    analysis.setEfficiencySelect(effective ? QIAnalysisRepository.EFFICIENCY_YES : QIAnalysisRepository.EFFICIENCY_NO);
    analysis.setAnalysisCheck(check);
    analysis.setEfficiencyCheckedBy(AuthUtils.getUser());
    analysis.setEfficiencyCheckedOn(now);
    touched(qi);
    return Beans.get(QualityImprovementRepository.class).save(qi);
  }

  @Transactional(rollbackOn = {Exception.class})
  public CorrectiveAction addAction(QualityImprovement qi, String title, User owner, LocalDate due, QIAction type) {
    CorrectiveAction action = new CorrectiveAction();
    action.setImprovement(qi);
    action.setTitle(title);
    action.setOwner(owner);
    action.setDueDate(due);
    action.setActionType(type);
    action.setStatusSelect(CorrectiveActionRepository.STATUS_OPEN);
    action.setCreatedByUser(AuthUtils.getUser());
    CorrectiveAction saved = JPA.save(action);
    progress(qi);
    return saved;
  }

  /** done, reopen or cancel an action; the issue's version moves so two people see each other's change. */
  @Transactional(rollbackOn = {Exception.class})
  public CorrectiveAction actOn(CorrectiveAction action, String command, String outcome, LocalDateTime now) {
    int status = action.getStatusSelect() == null ? CorrectiveActionRepository.STATUS_OPEN : action.getStatusSelect();
    switch (command) {
      case "done" -> {
        if (status != CorrectiveActionRepository.STATUS_OPEN) throw notAllowed(action, command);
        action.setStatusSelect(CorrectiveActionRepository.STATUS_DONE);
        action.setDoneAt(now);
        action.setDoneNote(outcome);
      }
      case "reopen" -> {
        if (status == CorrectiveActionRepository.STATUS_OPEN) throw notAllowed(action, command);
        action.setStatusSelect(CorrectiveActionRepository.STATUS_OPEN);
        action.setDoneAt(null);
      }
      default -> {
        if (status != CorrectiveActionRepository.STATUS_OPEN) throw notAllowed(action, command);
        action.setStatusSelect(CorrectiveActionRepository.STATUS_CANCELLED);
      }
    }
    CorrectiveAction saved = JPA.save(action);
    progress(action.getImprovement());
    return saved;
  }

  public static String status(CorrectiveAction action) {
    int s = action.getStatusSelect() == null ? CorrectiveActionRepository.STATUS_OPEN : action.getStatusSelect();
    return s == CorrectiveActionRepository.STATUS_DONE ? "DONE" : s == CorrectiveActionRepository.STATUS_CANCELLED ? "CANCELLED" : "OPEN";
  }

  public static List<CorrectiveAction> actions(QualityImprovement qi) {
    return Query.of(CorrectiveAction.class).filter("self.improvement = ?1", qi).order("dueDate").order("id").fetch(300);
  }

  // --- helpers -----------------------------------------------------------------------------------

  private static ApiException notAllowed(CorrectiveAction action, String command) {
    return new ApiException(422, "STATUS_NOT_ALLOWED", "A " + status(action).toLowerCase() + " action cannot be " + command + ".", null);
  }

  private static QIAnalysis analysis(QualityImprovement qi) {
    QIAnalysis analysis = qi.getQiAnalysis();
    if (analysis == null) {
      analysis = new QIAnalysis();
      analysis.setQi(qi);
      analysis.setPlanOwner(AuthUtils.getUser());
      qi.setQiAnalysis(analysis);
    }
    return analysis;
  }

  /** The plan and effectiveness live on the native analysis: the issue's version moves so a stale edit is refused. */
  private static void touched(QualityImprovement qi) {
    if (qi.getId() != null) JPA.em().lock(qi, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
  }

  /** The native progress is the share of actions done (cancelled ones do not count); the issue's version moves. */
  private static void progress(QualityImprovement qi) {
    JPA.em().lock(qi, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    List<CorrectiveAction> all = actions(qi).stream().filter(a -> a.getStatusSelect() != CorrectiveActionRepository.STATUS_CANCELLED).toList();
    long done = all.stream().filter(a -> a.getStatusSelect() == CorrectiveActionRepository.STATUS_DONE).count();
    analysis(qi).setAdvancement(all.isEmpty() ? 0 : (int) (done * 100 / all.size()));
    JPA.save(qi);
  }

  /** A native refusal while raising (no status, numbering missing, origin data that does not match); null if none. */
  public static ApiException nativeRefusal(Throwable e) {
    for (Throwable t = e; t != null; t = t.getCause()) {
      if (t instanceof AxelorException axelor) {
        int category = axelor.getCategory();
        if (category == TraceBackRepository.CATEGORY_CONFIGURATION_ERROR) {
          return new ApiException(422, "NUMBERING_REQUIRED", "Quality issue numbering is not set up; an administrator sets it under Numbering.", null);
        }
        if (category == TraceBackRepository.CATEGORY_NO_VALUE) {
          return new ApiException(422, "SETUP_REQUIRED", "No open quality status is set up; an administrator adds it under Quality set-up.", null);
        }
        return new ApiException(422, "NOT_CONSISTENT", "The issue's details do not match where it was found.", null);
      }
    }
    return null;
  }
}
