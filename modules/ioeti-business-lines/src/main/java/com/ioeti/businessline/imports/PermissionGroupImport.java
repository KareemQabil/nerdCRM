package com.ioeti.businessline.imports;

import com.axelor.auth.db.Group;
import com.axelor.auth.db.Permission;
import com.axelor.auth.db.repo.GroupRepository;
import com.axelor.inject.Beans;
import java.util.Map;

/** CSV import callback (data-init): attaches each imported permission to the group in "group". */
public class PermissionGroupImport {

  public Object attachToGroup(Object bean, Map<String, Object> values) {
    Permission permission = (Permission) bean;
    Object groupCode = values.get("group");
    if (groupCode == null || groupCode.toString().isBlank()) {
      return permission;
    }
    Group group = Beans.get(GroupRepository.class).findByCode(groupCode.toString().trim());
    if (group == null) {
      throw new IllegalStateException("Unknown group " + groupCode + " for " + permission.getName());
    }
    group.addPermission(permission);
    return permission;
  }
}
