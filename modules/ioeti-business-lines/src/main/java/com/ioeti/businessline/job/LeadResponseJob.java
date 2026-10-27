package com.ioeti.businessline.job;

import com.ioeti.businessline.service.LeadResponse;
import jakarta.inject.Inject;
import java.time.LocalDateTime;
import org.quartz.Job;
import org.quartz.JobExecutionContext;
import org.quartz.JobExecutionException;

/**
 * D-12: records the leads that missed a response target since the last run and notifies each line's manager in-app, once.
 * Registered as a native schedule by migration V025. Without the owners' working hours and targets it does nothing, and it
 * never reassigns a lead.
 */
public class LeadResponseJob implements Job {

  @Inject protected LeadResponse response;

  @Override
  public void execute(JobExecutionContext context) throws JobExecutionException {
    try {
      response.check(LocalDateTime.now());
    } catch (RuntimeException e) {
      throw new JobExecutionException(e);
    }
  }
}
