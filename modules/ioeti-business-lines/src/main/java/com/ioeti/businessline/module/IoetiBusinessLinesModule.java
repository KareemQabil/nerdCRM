package com.ioeti.businessline.module;

import com.axelor.app.AxelorModule;
import com.ioeti.businessline.db.repo.BusinessLineManagementRepository;
import com.ioeti.businessline.db.repo.BusinessLineRepository;
import com.ioeti.businessline.service.WonEvidence;
import com.google.inject.multibindings.OptionalBinder;

public class IoetiBusinessLinesModule extends AxelorModule {

  @Override
  protected void configure() {
    bind(BusinessLineRepository.class).to(BusinessLineManagementRepository.class);
    OptionalBinder.newOptionalBinder(binder(), WonEvidence.class).setDefault().to(WonEvidence.Unavailable.class);
  }
}
