package com.ioeti.core.module;

import com.axelor.app.AxelorModule;
import com.google.inject.matcher.Matchers;
import com.ioeti.core.api.IoetiEndpoint;
import com.ioeti.core.api.IoetiEndpointInterceptor;
import com.ioeti.core.security.LoginThrottleFilter;
import com.ioeti.core.security.RequestIdentityBoundary;
import jakarta.servlet.ServletContext;

/** Guice module of the IOETI shared kernel. Bindings shared by all IOETI modules go here. */
public class IoetiCoreModule extends AxelorModule {

  @Override
  protected void configure() {
    // SEC-001: first filter of the web application; SEC-004: login throttle right behind it
    // (both no-ops without a servlet context).
    ServletContext context = RequestIdentityBoundary.servletContext();
    RequestIdentityBoundary.register(context);
    LoginThrottleFilter.register(context);
    // SEC-002: IOETI error contract for every @IoetiEndpoint method.
    bindInterceptor(
        Matchers.any(), Matchers.annotatedWith(IoetiEndpoint.class), new IoetiEndpointInterceptor());
  }
}
