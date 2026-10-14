package com.didi4164.WhatsAppCallRecorder;

import java.util.Objects;

/** Exact entry-state restoration, including framework changes caused by requesting a hotspot. */
public final class OfflineRecoverySettings {
  public interface Store { String read(); boolean write(String value); }
  private final Store store;
  private String original;
  private boolean captured, changed, restoreAttempted, restoreSucceeded;
  public OfflineRecoverySettings(Store store) { this.store = Objects.requireNonNull(store); }
  public synchronized void capture() {
    if (captured || restoreAttempted) throw new IllegalStateException("State already captured or closed");
    original = store.read(); captured = true;
  }
  public synchronized void markNetworkMutation() {
    if (!captured || restoreAttempted) throw new IllegalStateException("State not available for mutation");
    changed = true;
  }
  public synchronized boolean nudge() {
    markNetworkMutation();
    return store.write("1");
  }
  public synchronized boolean restore() {
    if (restoreAttempted) return restoreSucceeded;
    restoreAttempted = true;
    if (!changed) { restoreSucceeded = true; return true; }
    restoreSucceeded = store.write(original) && Objects.equals(original, store.read());
    return restoreSucceeded;
  }
}
