package com.ioeti.commercial.module;

import com.axelor.app.AxelorModule;
import com.google.inject.multibindings.OptionalBinder;
import com.ioeti.businessline.service.WonEvidence;
import com.ioeti.commercial.service.PolicyWonEvidence;

/** D-11: replaces the business lines' fail-closed {@link WonEvidence} with the business line's own evidence rule. */
public class IoetiCommercialModule extends AxelorModule {

  @Override
  protected void configure() {
    OptionalBinder.newOptionalBinder(binder(), WonEvidence.class).setBinding().to(PolicyWonEvidence.class);
  }
}
