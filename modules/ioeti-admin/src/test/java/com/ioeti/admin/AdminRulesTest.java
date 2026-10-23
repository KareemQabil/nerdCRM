package com.ioeti.admin;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.axelor.auth.db.Group;
import com.ioeti.admin.service.AdminService;
import com.ioeti.core.api.ApiException;
import org.junit.jupiter.api.Test;

class AdminRulesTest {

  static String code(Runnable call) {
    return assertThrows(ApiException.class, call::run).fieldErrors().get(0).code();
  }

  @Test
  void signInNamesAreLowerCaseAndRestricted() {
    assertEquals("sara.mansour", AdminService.login("  Sara.Mansour "));
    assertEquals("FORMAT", code(() -> AdminService.login("sa")));
    assertEquals("FORMAT", code(() -> AdminService.login("سارة")));
    assertEquals("FORMAT", code(() -> AdminService.login("sara mansour")));
    assertEquals("REQUIRED", code(() -> AdminService.login(" ")));
  }

  @Test
  void temporaryPasswordsMustBeLongAndMixed() {
    assertEquals("TOO_SHORT", code(() -> AdminService.checkPassword("Short1")));
    assertEquals("TOO_SHORT", code(() -> AdminService.checkPassword(null)));
    assertEquals("WEAK", code(() -> AdminService.checkPassword("alllowercase1234")));
    assertEquals("WEAK", code(() -> AdminService.checkPassword("NoDigitsAtAllHere")));
    assertDoesNotThrow(() -> AdminService.checkPassword("Temp-Pass-2026x"));
  }

  @Test
  void emailIsOptionalButMustLookLikeAnAddress() {
    assertNull(AdminService.email("  "));
    assertEquals("a@ioeti.example", AdminService.email("a@ioeti.example"));
    assertEquals("FORMAT", code(() -> AdminService.email("not-an-address")));
  }

  @Test
  void languageDefaultsToArabicAndIsLimited() {
    assertEquals("ar", AdminService.language(null));
    assertEquals("en", AdminService.language("en"));
    assertEquals("UNAVAILABLE", code(() -> AdminService.language("de")));
  }

  @Test
  void businessLineCodesAreCapitalised() {
    assertEquals("ISO45001", AdminService.lineCode("iso45001"));
    assertEquals("FORMAT", code(() -> AdminService.lineCode("ISO 45001")));
    assertEquals("FORMAT", code(() -> AdminService.lineCode("X")));
  }

  @Test
  void onlyTheAdminsGroupIsTheAdministratorProfile() {
    Group admins = new Group();
    admins.setCode("admins");
    Group sales = new Group();
    sales.setCode("showcase-sales");
    assertTrue(AdminService.isAdminProfile(admins));
    assertFalse(AdminService.isAdminProfile(sales));
    assertFalse(AdminService.isAdminProfile(null));
  }
}
