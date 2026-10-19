package com.ioeti.businessline;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.axelor.apps.crm.db.Opportunity;
import com.axelor.db.JPA;
import com.axelor.db.JpaSupport;
import com.axelor.test.GuiceExtension;
import com.axelor.test.GuiceModules;
import com.ioeti.businessline.db.BusinessLine;
import com.ioeti.businessline.db.repo.BusinessLineManagementRepository;
import com.ioeti.businessline.db.repo.BusinessLineRepository;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManagerFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

/** Repository validation and the Opportunity listener, against a real JPA context (HSQLDB). */
@ExtendWith(GuiceExtension.class)
@GuiceModules(BusinessLineTestModule.class)
class BusinessLinePersistenceTest extends JpaSupport {

  @Inject private BusinessLineRepository repository;

  @AfterAll
  static void closeEntityManagerFactory() {
    EntityManagerFactory factory = JPA.em().getEntityManagerFactory();
    if (factory != null) {
      factory.close();
    }
  }

  private static BusinessLine line(String code, int status) {
    BusinessLine line = new BusinessLine();
    line.setCode(code);
    line.setNameEn("Line " + code);
    line.setNameAr("خط " + code);
    line.setStatusSelect(status);
    return line;
  }

  private static String causeMessages(Throwable error) {
    StringBuilder text = new StringBuilder();
    for (Throwable t = error; t != null; t = t.getCause()) {
      text.append(t.getMessage()).append(" | ");
    }
    return text.toString();
  }

  @Test
  void repositoryBindingIsTheIoetiManagementRepository() {
    assertTrue(repository instanceof BusinessLineManagementRepository);
  }

  @Test
  void savesAndNormalisesAValidLine() {
    BusinessLine line = line(" persist_ok ", BusinessLineRepository.STATUS_ACTIVE);
    inTransaction(() -> repository.save(line));
    BusinessLine stored = repository.all().filter("self.code = 'PERSIST_OK'").fetchOne();
    assertNotNull(stored);
    assertEquals("خط  persist_ok ".trim(), stored.getNameAr());
  }

  @Test
  void rejectsInvalidLineThroughTheRepository() {
    BusinessLine invalid = line("x", BusinessLineRepository.STATUS_ACTIVE);
    invalid.setNameAr("No Arabic");
    Exception error =
        assertThrows(Exception.class, () -> inTransaction(() -> repository.save(invalid)));
    assertTrue(causeMessages(error).contains("Code must be"), causeMessages(error));
  }

  @Test
  void rejectsDuplicateCode() {
    inTransaction(() -> repository.save(line("DUP_CODE", BusinessLineRepository.STATUS_ACTIVE)));
    Exception error =
        assertThrows(
            Exception.class,
            () ->
                inTransaction(
                    () -> repository.save(line("dup_code", BusinessLineRepository.STATUS_ACTIVE))));
    assertTrue(causeMessages(error).contains("exists"), causeMessages(error));
  }

  @Test
  void opportunityCannotBeCreatedOnASuspendedLine() {
    inTransaction(() -> repository.save(line("SUSP_LINE", BusinessLineRepository.STATUS_SUSPENDED)));
    Exception error =
        assertThrows(
            Exception.class,
            () ->
                inTransaction(
                    () -> {
                      Opportunity opportunity = new Opportunity();
                      opportunity.setName("Hotel ISO audit");
                      opportunity.setIoetiBusinessLine(repository.findByCode("SUSP_LINE"));
                      JPA.save(opportunity);
                      JPA.flush();
                    }));
    assertTrue(causeMessages(error).contains("is not active"), causeMessages(error));
  }

  @Test
  void opportunityCanBeCreatedOnAnActiveLine() {
    inTransaction(() -> repository.save(line("ACTIVE_LINE", BusinessLineRepository.STATUS_ACTIVE)));
    inTransaction(
        () -> {
          Opportunity opportunity = new Opportunity();
          opportunity.setName("Restaurant ISO 22000");
          opportunity.setIoetiBusinessLine(repository.findByCode("ACTIVE_LINE"));
          JPA.save(opportunity);
        });
    assertEquals(
        1,
        JPA.all(Opportunity.class)
            .filter("self.ioetiBusinessLine.code = 'ACTIVE_LINE'")
            .count());
  }
}
