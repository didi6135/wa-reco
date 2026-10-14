package com.didi4164.WhatsAppCallRecorder;

/** Closes only the reservation this attempt owns, including delivery after cancellation or timeout. */
public final class OfflineRecoveryLease {
  private Runnable closeAction;
  private boolean closed;

  public synchronized boolean accept(Runnable action) {
    if (action == null) throw new IllegalArgumentException("Missing lease closer");
    if (closed || closeAction != null) { action.run(); return false; }
    closeAction = action;
    return true;
  }
  public synchronized void close() {
    if (closed) return;
    closed = true;
    Runnable action = closeAction;
    closeAction = null;
    if (action != null) action.run();
  }
}
