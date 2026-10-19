package com.ioeti.core.module;

import com.axelor.app.AxelorModule;
import com.ioeti.core.security.RequestIdentityBoundary;

/** Guice module of the IOETI shared kernel. Bindings shared by all IOETI modules go here. */
public class IoetiCoreModule extends AxelorModule {

  @Override
  protected void configure() {
    // SEC-001: first filter of the web application (no-op without a servlet context).
    RequestIdentityBoundary.register();
  }
}
