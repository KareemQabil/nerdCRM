package com.ioeti.businessline;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.axelor.auth.db.User;
import com.axelor.db.JPA;
import com.axelor.db.JpaSupport;
import com.axelor.test.GuiceExtension;
import com.axelor.test.GuiceModules;
import com.ioeti.businessline.db.BusinessLine;
import com.ioeti.businessline.db.repo.BusinessLineRepository;
import com.ioeti.businessline.security.BusinessLineEligibility;
import jakarta.persistence.EntityManagerFactory;
import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

/** SEC-003 create eligibility against persisted users and lines (HSQLDB, real entity mapping). */
@ExtendWith(GuiceExtension.class)
@GuiceModules(BusinessLineTestModule.class)
class BusinessLineEligibilityTest extends JpaSupport {

  @AfterAll
  static void closeEntityManagerFactory() {
    EntityManagerFactory factory = JPA.em().getEntityManagerFactory();
    if (factory != null) {
      factory.close();
    }
  }

  private BusinessLine line(String code) {
    BusinessLine line = new BusinessLine();
    line.setCode(code);
    line.setNameEn("Line " + code);
    line.setNameAr("خط " + code);
    line.setStatusSelect(BusinessLineRepository.STATUS_ACTIVE);
    inTransaction(() -> JPA.save(line));
    return line;
  }

  private User user(String code, BusinessLine... lines) {
    User user = new User();
    user.setCode(code);
    user.setName(code);
    user.setPassword("not-used");
    user.setIoetiBusinessLines(new HashSet<>(Set.of(lines)));
    inTransaction(() -> JPA.save(user));
    return user;
  }

  @Test
  void membersMayStartWorkInTheirLinesOnly() {
    BusinessLine iso = line("ELIG_ISO");
    BusinessLine training = line("ELIG_TRN");
    User rep = user("elig.rep", iso);

    JPA.em().clear();
    User reloaded = JPA.find(User.class, rep.getId());
    assertTrue(BusinessLineEligibility.canCreateIn(reloaded, JPA.find(BusinessLine.class, iso.getId())));
    assertFalse(BusinessLineEligibility.canCreateIn(reloaded, JPA.find(BusinessLine.class, training.getId())));
  }

  @Test
  void usersWithoutMembershipAndMissingInputsAreRefused() {
    BusinessLine iso = line("ELIG_ISO2");
    assertFalse(BusinessLineEligibility.canCreateIn(user("elig.none"), iso));
    assertFalse(BusinessLineEligibility.canCreateIn(null, iso));
    assertFalse(BusinessLineEligibility.canCreateIn(user("elig.other", iso), null));
  }

  @Test
  void theAdministratorIsEligibleEverywhere() {
    BusinessLine any = line("ELIG_ANY");
    User admin = new User();
    admin.setCode("admin");
    assertTrue(BusinessLineEligibility.canCreateIn(admin, any));
  }
}
