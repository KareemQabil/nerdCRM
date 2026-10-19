package com.ioeti.businessline.module;

import com.axelor.app.AxelorModule;
import com.ioeti.businessline.db.repo.BusinessLineManagementRepository;
import com.ioeti.businessline.db.repo.BusinessLineRepository;

public class IoetiBusinessLinesModule extends AxelorModule {

  @Override
  protected void configure() {
    bind(BusinessLineRepository.class).to(BusinessLineManagementRepository.class);
  }
}
