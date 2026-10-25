package com.ioeti.workspace.job;

import com.axelor.apps.base.service.app.AppBaseService;
import com.ioeti.workspace.service.FxService;
import jakarta.inject.Inject;
import org.quartz.Job;
import org.quartz.JobExecutionContext;
import org.quartz.JobExecutionException;

/**
 * D-06: fetches exchange rates from the public source when the finance.fx policy names it and the newest
 * fetched rate is half a day old. Registered as a native schedule by migration V020; does nothing without
 * the policy. A failure leaves the rates as they were (finance can enter them by hand).
 */
public class FxRefreshJob implements Job {

  @Inject protected FxService fx;
  @Inject protected AppBaseService appBaseService;

  @Override
  public void execute(JobExecutionContext context) throws JobExecutionException {
    try {
      fx.refreshIfDue(appBaseService.getTodayDateTime().toLocalDateTime());
    } catch (RuntimeException e) {
      throw new JobExecutionException(e);
    }
  }
}
