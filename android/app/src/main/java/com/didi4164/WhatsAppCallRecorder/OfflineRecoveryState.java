package com.didi4164.WhatsAppCallRecorder;

/** Monotonic deadline and readiness ordering shared by the real recovery worker and host tests. */
public final class OfflineRecoveryState {
  private final long deadline;
  private String canceled;
  private String stage = "idle";
  private boolean restored;
  private boolean heartbeatVerified;
  private long restoredAt;

  public OfflineRecoveryState(long startedAt, long durationMs) {
    if (durationMs <= 0 || startedAt > Long.MAX_VALUE - durationMs) {
      throw new IllegalArgumentException("Invalid monotonic deadline");
    }
    deadline = startedAt + durationMs;
  }
  public synchronized String stage() { return stage; }
  public synchronized String rejection(long now) {
    if (canceled != null) return canceled;
    return now >= deadline ? "OFFLINE_TIMEOUT" : null;
  }
  public synchronized long remaining(long now) { return Math.max(0, deadline - now); }
  public synchronized void cancel(String reason) {
    // The owner-service promotion still has to finish after the heartbeat succeeds.
    if (canceled == null) canceled = reason;
  }
  public synchronized boolean transition(String next, long now) {
    if (rejection(now) != null || restored || "ready".equals(stage)) return false;
    if ("ready".equals(next)) throw new IllegalArgumentException("Readiness requires restored state and heartbeat");
    stage = next;
    return true;
  }
  public synchronized void beginRestore() { stage = "restoring"; }
  public synchronized void restored(long now) {
    restored = true; restoredAt = now; stage = "verifying";
  }
  public synchronized boolean ready(boolean authenticated, long heartbeatAt, long now) {
    if (rejection(now) != null || !restored || !authenticated || heartbeatAt <= restoredAt) return false;
    heartbeatVerified = true;
    return true;
  }
  /** Only the final owner-service callback may expose ready to the UI. */
  public synchronized boolean commitReady(long now) {
    if (rejection(now) != null || !restored || !heartbeatVerified) return false;
    stage = "ready";
    return true;
  }
  /** Permission preparation changes no network state and makes no helper-readiness claim. */
  public synchronized boolean prepared(long now) {
    if (rejection(now) != null || !restored) return false;
    stage = "idle";
    return true;
  }
  public synchronized void failed(String code) {
    stage = "OFFLINE_CANCELED".equals(code) || "OFFLINE_FOREGROUND_REQUIRED".equals(code) ? "canceled" : "failed";
  }
}
