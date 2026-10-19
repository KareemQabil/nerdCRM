package com.ioeti.core.security;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Thread-safe per-key event counts over a sliding time window, with a bound on tracked keys. */
final class SlidingWindowCounter {

  private final long windowMillis;
  private final int maxKeys;
  private final Map<String, Deque<Long>> events = new ConcurrentHashMap<>();

  SlidingWindowCounter(long windowMillis, int maxKeys) {
    this.windowMillis = windowMillis;
    this.maxKeys = maxKeys;
  }

  void record(String key, long now) {
    if (events.size() >= maxKeys) {
      events.entrySet().removeIf(e -> pruned(e.getValue(), now).isEmpty());
      if (events.size() >= maxKeys) {
        return; // never grow without bound; the IP key of a flood is already over its limit
      }
    }
    Deque<Long> times = events.computeIfAbsent(key, k -> new ArrayDeque<>());
    synchronized (times) {
      times.addLast(now);
    }
  }

  /** 0 while {@code key} is under {@code max} events; otherwise ms until the oldest one expires. */
  long retryAfterMillis(String key, int max, long now) {
    Deque<Long> times = events.get(key);
    if (times == null) {
      return 0;
    }
    synchronized (times) {
      pruned(times, now);
      if (times.size() < max) {
        return 0;
      }
      return Math.max(1, times.peekFirst() + windowMillis - now);
    }
  }

  void reset(String key) {
    events.remove(key);
  }

  private Deque<Long> pruned(Deque<Long> times, long now) {
    synchronized (times) {
      while (!times.isEmpty() && times.peekFirst() <= now - windowMillis) {
        times.removeFirst();
      }
      return times;
    }
  }
}
