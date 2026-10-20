package com.ioeti.core.security;

import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.User;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.quartz.Job;
import org.quartz.JobExecutionContext;

/**
 * Diagnostic Quartz job for the scheduled-job part of SEC-001 (issue #10).
 *
 * <p>A plain scheduled job runs with no user: AOP's {@code GuiceJobRunShell} runs it on a Quartz
 * pool thread and sets none. Each run records the identity {@code AuthUtils.getUser()} returns on
 * its thread, in a small in-memory ring, readable only by an administrator through
 * {@code GET /ws/ioeti/security/identity-boundary}. Any user found there means a request identity
 * leaked into a background worker.
 *
 * <p>It does nothing unless an administrator schedules it (a {@code MetaSchedule} with this class
 * as its job) and the scheduler is enabled ({@code quartz.enable}). It stores no business data.
 */
public class JobIdentityProbe implements Job {

  private static final int KEEP = 200;
  private static final Deque<String> OBSERVED = new ArrayDeque<>();
  private static long runs;
  private static long withUser;

  @Override
  public void execute(JobExecutionContext context) {
    User user = AuthUtils.getUser();
    synchronized (OBSERVED) {
      runs++;
      if (user != null) {
        withUser++;
        OBSERVED.addFirst(user.getCode());
        while (OBSERVED.size() > KEEP) OBSERVED.removeLast();
      }
    }
  }

  /** Runs so far, how many saw a user, and the latest user codes seen (most recent first). */
  public static Map<String, Object> stats() {
    synchronized (OBSERVED) {
      Map<String, Object> stats = new LinkedHashMap<>();
      stats.put("runs", runs);
      stats.put("runsWithUser", withUser);
      List<String> recent = new ArrayList<>(OBSERVED);
      stats.put("usersSeen", recent.subList(0, Math.min(10, recent.size())));
      return stats;
    }
  }
}
