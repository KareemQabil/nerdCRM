package com.ioeti.admin.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.axelor.auth.db.Group;
import com.axelor.auth.db.Permission;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.policy.PolicyService;
import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** D-07 role templates and the rights catalogue, without a database. */
class RoleAdminRulesTest {

  @Test
  void theTemplatesAreTheJobsOfD07WithoutThePolicyOwner() {
    assertEquals(9, RoleAdmin.TEMPLATES.size());
    assertTrue(RoleAdmin.TEMPLATES.stream().noneMatch(t -> PolicyService.OWNER_ROLE.equals(t.role())));
    // the approvers the D-11 policies name resolve to these roles
    assertEquals("ioeti-sales-manager", RoleAdmin.template("SALES_MANAGER").role());
    assertEquals("ioeti-gm", RoleAdmin.template("GM").role());
    assertEquals(422, assertThrows(ApiException.class, () -> RoleAdmin.template("POLICY_OWNER")).status());
    assertEquals(422, assertThrows(ApiException.class, () -> RoleAdmin.template(" ")).status());
  }

  @Test
  void theCatalogueHasOneEntryPerKeyAndPerModel() {
    Set<String> keys = new HashSet<>();
    Set<String> models = new HashSet<>();
    for (RoleAdmin.RecordType t : RoleAdmin.TYPES) {
      assertTrue(keys.add(t.key()), "duplicate key " + t.key());
      assertTrue(models.add(t.model()), "duplicate model " + t.model());
      assertFalse(t.scopes().containsKey(RoleAdmin.ALL), "ALL is implied, never a condition: " + t.key());
      for (String scope : t.scopes().keySet()) assertTrue(RoleAdmin.PARAMS.containsKey(scope), t.key() + " " + scope);
      if (t.restricted()) assertTrue(t.scopes().isEmpty(), "restricted data is granted whole or not at all: " + t.key());
    }
    assertEquals(422, assertThrows(ApiException.class, () -> RoleAdmin.recordType("User")).status());
  }

  @Test
  void aScopeIsReadBackFromItsCondition() {
    RoleAdmin.RecordType lead = RoleAdmin.recordType("Lead");
    Permission p = new Permission("x");
    assertEquals(RoleAdmin.ALL, RoleAdmin.scopeOf(lead, p));
    p.setCondition("self.user = ?");
    assertEquals(RoleAdmin.OWN, RoleAdmin.scopeOf(lead, p));
    p.setCondition("self.ioetiBusinessLine in (?)");
    assertEquals(RoleAdmin.LINE, RoleAdmin.scopeOf(lead, p));
    p.setCondition("self.createdBy = ?");
    assertNull(RoleAdmin.scopeOf(lead, p)); // a condition written elsewhere is not one of ours
  }

  @Test
  void profileCodesAreShortLowerCaseAndNeverTheAdministrators() {
    assertEquals("sales-cairo", RoleAdmin.profileCode(" Sales-Cairo "));
    assertEquals(422, assertThrows(ApiException.class, () -> RoleAdmin.profileCode("admins")).status());
    assertEquals(422, assertThrows(ApiException.class, () -> RoleAdmin.profileCode("1sales")).status());
    assertEquals(422, assertThrows(ApiException.class, () -> RoleAdmin.profileCode("ab")).status());
    assertEquals(422, assertThrows(ApiException.class, () -> RoleAdmin.profileCode("sales cairo")).status());
  }

  @Test
  void aManagedPermissionIsNamedAfterItsProfileAndRecordType() {
    Group group = new Group("sales-cairo", "Sales Cairo");
    assertEquals("ioeti.sales-cairo.Opportunity", RoleAdmin.permissionName(group, RoleAdmin.recordType("Opportunity")));
  }
}
