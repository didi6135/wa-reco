package com.didi4164.WhatsAppCallRecorder;

/** One Activity owns the transient request. A paused/destroyed Activity must explicitly revoke it. */
public final class RestartResumeGate {
  public static final long REQUEST_MAX_AGE_MS = 60_000L;
  public static final long ARM_MAX_AGE_MS = 90_000L;
  private Object owner;
  private long queuedAt;
  private long consumedAt;
  private long generation;
  private int state; // 0 absent, 1 pending, 2 consumed tap, 3 one arming attempt

  public synchronized boolean queue(Object activity, long now) {
    clear();
    if (activity == null || now < 0) return false;
    owner = activity; queuedAt = now; state = 1; return true;
  }

  public synchronized boolean consume(Object activity, long now, boolean eligible, boolean foreground) {
    if (state != 1) return false;
    if (!eligible || now < queuedAt || now - queuedAt >= REQUEST_MAX_AGE_MS) { clear(); return false; }
    if (owner != activity || !foreground) return false;
    state = 2; consumedAt = now; return true;
  }

  public synchronized long beginArming(Object activity, long now, boolean eligible, boolean foreground) {
    if (state != 2 || owner != activity) return -1;
    if (!eligible || !foreground || now < consumedAt || now - consumedAt >= ARM_MAX_AGE_MS) {
      clear(); return -1;
    }
    state = 3; return generation;
  }

  public synchronized boolean permitsArming(Object activity, long expectedGeneration, long now,
      boolean eligible, boolean foreground) {
    if (state != 3 || owner != activity || generation != expectedGeneration) return false;
    if (!eligible || !foreground || now < consumedAt || now - consumedAt >= ARM_MAX_AGE_MS) {
      clear(); return false;
    }
    return true;
  }

  public synchronized boolean clearFor(Object activity) {
    if (owner != activity) return false;
    clear(); return true;
  }
  public synchronized boolean revokeConsumedFor(Object activity) {
    if (owner != activity || state < 2) return false;
    clear(); return true;
  }
  public synchronized void clear() { owner = null; queuedAt = consumedAt = 0; state = 0; generation++; }
}
