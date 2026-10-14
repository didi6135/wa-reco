package com.didi4164.WhatsAppCallRecorder;

/** Waits only for dismissal of an already authorized foreground dialog; never waits for host resume. */
public final class OfflineRecoveryEntryGate implements Runnable {
  public static final long TIMEOUT_MS = 1000, POLL_MS = 32;
  public interface Scheduler { long now(); void post(Runnable task, long delayMs); }
  public interface Reader { State read(); }
  public interface Failure { void reject(String code); }
  public static final class State {
    public final boolean sameActivity, resumed, focused, sameGeneration;
    public State(boolean sameActivity, boolean resumed, boolean focused, boolean sameGeneration) {
      this.sameActivity = sameActivity; this.resumed = resumed;
      this.focused = focused; this.sameGeneration = sameGeneration;
    }
  }
  private final Scheduler scheduler;
  private final Reader reader;
  private final Runnable ready;
  private final Failure failure;
  private final long deadline;
  private boolean canceled, settled;
  public OfflineRecoveryEntryGate(Scheduler scheduler, Reader reader, Runnable ready, Failure failure) {
    this.scheduler = scheduler; this.reader = reader; this.ready = ready; this.failure = failure;
    deadline = scheduler.now() + TIMEOUT_MS;
  }
  /** Re-evaluate immediately before the action and during its native checkpoints, not just at sampling. */
  public static boolean permitsAction(State state) {
    return state != null && state.sameActivity && state.resumed && state.focused && state.sameGeneration;
  }
  public void start() { scheduler.post(this, 0); }
  public synchronized void cancel() { canceled = true; run(); }
  @Override public synchronized void run() {
    if (settled) return;
    State state;
    try { state = reader.read(); }
    catch (RuntimeException ignored) { state = null; }
    if (canceled || state == null || !state.sameActivity || !state.resumed || !state.sameGeneration
        || scheduler.now() >= deadline) {
      settled = true; failure.reject("OFFLINE_FOREGROUND_REQUIRED");
    } else if (permitsAction(state)) {
      settled = true; ready.run();
    } else {
      scheduler.post(this, Math.min(POLL_MS, deadline - scheduler.now()));
    }
  }
}
