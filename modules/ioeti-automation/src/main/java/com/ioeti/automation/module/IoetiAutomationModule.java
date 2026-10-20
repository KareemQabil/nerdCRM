package com.ioeti.automation.module;

import com.axelor.app.AxelorModule;
import com.google.inject.multibindings.OptionalBinder;
import com.ioeti.automation.service.StoredNotifier;
import com.ioeti.core.notify.Notifier;

/** Replaces the core's do-nothing {@link Notifier} with the stored inbox. */
public class IoetiAutomationModule extends AxelorModule {

  @Override
  protected void configure() {
    OptionalBinder.newOptionalBinder(binder(), Notifier.class).setBinding().to(StoredNotifier.class);
  }
}
