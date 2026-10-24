package com.ioeti.operations.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.axelor.apps.base.AxelorException;
import com.axelor.apps.base.db.Company;
import com.axelor.apps.base.db.Partner;
import com.axelor.apps.base.db.repo.TraceBackRepository;
import com.axelor.apps.intervention.db.AnswerValue;
import com.axelor.apps.intervention.db.Intervention;
import com.axelor.apps.intervention.db.InterventionQuestion;
import com.axelor.apps.intervention.db.InterventionType;
import com.axelor.apps.intervention.db.OrderedRange;
import com.axelor.apps.quality.db.QIAnalysis;
import com.axelor.apps.quality.db.QIAnalysisCause;
import com.axelor.apps.quality.db.QIIdentification;
import com.axelor.apps.quality.db.QualityImprovement;
import com.axelor.apps.quality.db.repo.QIAnalysisCauseRepository;
import com.axelor.apps.quality.db.repo.QIAnalysisRepository;
import com.ioeti.core.api.ApiException;
import com.ioeti.operations.db.CorrectiveAction;
import com.ioeti.operations.db.repo.CorrectiveActionRepository;
import com.ioeti.operations.service.QualityService.Responsible;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** The rules of field visits (A7), their checklists (A10), quality issues (A8) and root-cause analysis (A11), without a database. */
class FieldAndQualityRulesTest {

  private static Intervention visit(Integer status) {
    Intervention visit = new Intervention();
    visit.setStatusSelect(status);
    return visit;
  }

  @Test
  void aVisitMovesOnlyAlongTheNativeLifecycle() {
    assertEquals("TO_PLAN", VisitService.status(visit(null)));
    assertEquals("SUSPENDED", VisitService.status(visit(VisitService.SUSPENDED)));
    assertTrue(VisitService.FROM.get("start").containsAll(Set.of(VisitService.PLANNED, VisitService.SUSPENDED)));
    assertFalse(VisitService.FROM.get("start").contains(VisitService.TO_PLAN));
    assertFalse(VisitService.FROM.get("finish").contains(VisitService.PLANNED));
    // a visit that has started cannot be cancelled, only paused or finished
    assertFalse(VisitService.FROM.get("cancel").contains(VisitService.STARTED));
    assertFalse(VisitService.FROM.values().stream().anyMatch(from -> from.contains(VisitService.FINISHED) || from.contains(VisitService.CANCELLED)));
  }

  @Test
  void aChecklistExistsOnlyWhenTheVisitTypeHasRanges() {
    Intervention visit = visit(VisitService.STARTED);
    assertFalse(VisitChecklistService.hasTemplate(visit));
    InterventionType type = new InterventionType();
    visit.setInterventionType(type);
    assertFalse(VisitChecklistService.hasTemplate(visit));
    type.setHeaderRangeList(List.of(new OrderedRange()));
    assertTrue(VisitChecklistService.hasTemplate(visit));
  }

  @Test
  void checklistAnswersAreGivenOnSiteToActiveAnswerableItems() {
    InterventionQuestion text = new InterventionQuestion();
    text.setAnswerTypeSelect("text");
    assertEquals("STATUS_NOT_ALLOWED", assertThrows(ApiException.class,
        () -> VisitChecklistService.checkAnswerable(visit(VisitService.PLANNED), text)).code());
    assertEquals("STATUS_NOT_ALLOWED", assertThrows(ApiException.class,
        () -> VisitChecklistService.checkAnswerable(visit(VisitService.FINISHED), text)).code());
    VisitChecklistService.checkAnswerable(visit(VisitService.STARTED), text);
    VisitChecklistService.checkAnswerable(visit(VisitService.SUSPENDED), text);

    InterventionQuestion indication = new InterventionQuestion();
    indication.setAnswerTypeSelect("indication");
    assertEquals("NOT_ANSWERABLE", assertThrows(ApiException.class,
        () -> VisitChecklistService.checkAnswerable(visit(VisitService.STARTED), indication)).code());
    assertFalse(VisitChecklistService.ANSWERABLE.contains("advancedMonitoring"));

    // a conditional question applies only once the answer it depends on is given
    AnswerValue nonConforming = new AnswerValue();
    InterventionQuestion first = new InterventionQuestion();
    first.setAnswerTypeSelect("list");
    InterventionQuestion why = new InterventionQuestion();
    why.setAnswerTypeSelect("text");
    why.setIsConditional(true);
    why.setConditionalInterventionQuestion(first);
    why.setConditionalAnswerValueSet(Set.of(nonConforming));
    assertEquals("NOT_ACTIVE", assertThrows(ApiException.class,
        () -> VisitChecklistService.checkAnswerable(visit(VisitService.STARTED), why)).code());
    first.setListAnswer(nonConforming);
    VisitChecklistService.checkAnswerable(visit(VisitService.STARTED), why);
  }

  @Test
  void qualityIssueLabelsAreStable() {
    QualityImprovement qi = new QualityImprovement();
    assertEquals("MINOR", QualityService.gravity(qi)); // the native default; the generated getter never returns null
    qi.setGravityTypeSelect(QualityService.CRITICAL);
    assertEquals("CRITICAL", QualityService.gravity(qi));
    assertEquals("NOT_CHECKED", QualityService.effectiveness(null));
    QIAnalysis analysis = new QIAnalysis();
    assertEquals("NOT_CHECKED", QualityService.effectiveness(analysis));
    analysis.setEfficiencySelect(QIAnalysisRepository.EFFICIENCY_NO);
    assertEquals("NOT_EFFECTIVE", QualityService.effectiveness(analysis));
    CorrectiveAction action = new CorrectiveAction();
    assertEquals("OPEN", QualityService.status(action));
    action.setStatusSelect(CorrectiveActionRepository.STATUS_CANCELLED);
    assertEquals("CANCELLED", QualityService.status(action));
    assertNull(QualityService.issue(qi));
  }

  @Test
  void nativeRefusalsBecomeClearSetUpAnswers() {
    assertEquals("NUMBERING_REQUIRED", QualityService.nativeRefusal(
        new RuntimeException(new AxelorException(TraceBackRepository.CATEGORY_CONFIGURATION_ERROR, "no sequence"))).code());
    assertEquals("SETUP_REQUIRED", QualityService.nativeRefusal(new AxelorException(TraceBackRepository.CATEGORY_NO_VALUE, "no status")).code());
    assertEquals("NOT_CONSISTENT", QualityService.nativeRefusal(new AxelorException(TraceBackRepository.CATEGORY_INCONSISTENCY, "x")).code());
    assertNull(QualityService.nativeRefusal(new IllegalStateException("not native")));
  }

  @Test
  void anInternalCauseIsAttributedToTheOrganisationNeverAPerson() {
    QualityImprovement qi = new QualityImprovement();
    assertNull(QualityService.responsibleParty(qi, Responsible.INTERNAL)); // no company party record: fail closed
    Company company = new Company();
    Partner organisation = new Partner();
    company.setPartner(organisation);
    qi.setCompany(company);
    assertSame(organisation, QualityService.responsibleParty(qi, Responsible.INTERNAL));
    assertNull(QualityService.responsibleParty(qi, Responsible.CUSTOMER));
    QIIdentification identification = new QIIdentification();
    Partner client = new Partner();
    identification.setCustomerPartner(client);
    qi.setQiIdentification(identification);
    assertSame(client, QualityService.responsibleParty(qi, Responsible.CUSTOMER));
    assertNull(QualityService.responsibleParty(qi, Responsible.SUPPLIER));
  }

  @Test
  void nativeResponsibleTypesMapToTheThreeAttributions() {
    QIAnalysisCause cause = new QIAnalysisCause();
    assertEquals(Responsible.INTERNAL, QualityService.responsible(cause));
    cause.setResponsiblePartnerTypeSelect(QIAnalysisCauseRepository.RESPONSIBLE_EMPLOYEE);
    assertEquals(Responsible.INTERNAL, QualityService.responsible(cause));
    cause.setResponsiblePartnerTypeSelect(QIAnalysisCauseRepository.RESPONSIBLE_CUSTOMER_CONTACT);
    assertEquals(Responsible.CUSTOMER, QualityService.responsible(cause));
    cause.setResponsiblePartnerTypeSelect(QIAnalysisCauseRepository.RESPONSIBLE_SUPPLIER);
    assertEquals(Responsible.SUPPLIER, QualityService.responsible(cause));
  }
}
