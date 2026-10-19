package com.ioeti.businessline.db.repo;

import com.ioeti.businessline.db.BusinessLine;
import com.ioeti.businessline.service.BusinessLineValidator;
import jakarta.persistence.PersistenceException;
import java.util.List;

/**
 * Enforces business line rules on every save that goes through the repository (form view, generic
 * /ws/rest API, services). Bound in {@link com.ioeti.businessline.module.IoetiBusinessLinesModule}.
 */
public class BusinessLineManagementRepository extends BusinessLineRepository {

  @Override
  public BusinessLine save(BusinessLine line) {
    BusinessLineValidator.normalize(line);
    List<String> errors = BusinessLineValidator.validate(line);
    if (!errors.isEmpty()) {
      throw new PersistenceException(String.join(" ", errors));
    }
    BusinessLine sameCode = findByCode(line.getCode());
    if (sameCode != null && !sameCode.getId().equals(line.getId())) {
      throw new PersistenceException("A business line with code " + line.getCode() + " exists.");
    }
    return super.save(line);
  }

  public BusinessLine findByCode(String code) {
    return all().filter("self.code = :code").bind("code", code).fetchOne();
  }
}
