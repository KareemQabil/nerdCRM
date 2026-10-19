package com.ioeti.businessline;

import com.axelor.app.AppModule;
import com.axelor.apps.base.module.BaseModule;
import com.axelor.apps.crm.module.CrmModule;
import com.axelor.auth.AuthModule;
import com.axelor.db.JpaModule;
import com.axelor.message.module.MessageModule;
import com.axelor.studio.module.StudioModule;
import com.axelor.utils.module.UtilsModule;
import com.google.inject.AbstractModule;
import com.ioeti.businessline.module.IoetiBusinessLinesModule;
import com.ioeti.core.module.IoetiCoreModule;

/**
 * Guice graph for persistence tests: JPA on in-memory HSQLDB plus the upstream modules the IOETI
 * business line module depends on (same approach as the AOS module tests).
 */
public class BusinessLineTestModule extends AbstractModule {

  @Override
  protected void configure() {
    install(new JpaModule("testUnit", true, true));
    install(new AuthModule());
    install(new AppModule());
    install(new UtilsModule());
    install(new MessageModule());
    install(new StudioModule());
    install(new BaseModule());
    install(new CrmModule());
    install(new IoetiCoreModule());
    install(new IoetiBusinessLinesModule());
  }
}
