package com.ioeti.core.module;

import com.axelor.app.AxelorModule;

/** Guice module of the IOETI shared kernel. Bindings shared by all IOETI modules go here. */
public class IoetiCoreModule extends AxelorModule {

  @Override
  protected void configure() {
    // No bindings yet: ArabicTextNormalizer is a stateless utility.
  }
}
