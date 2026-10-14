package com.didi4164.WhatsAppCallRecorder;

import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;
import static org.junit.Assert.*;

public class OfflineRecoveryResourcesTest {
  @Test public void ownedHotspotIsClosedExactlyOnce() {
    OfflineRecoveryLease lease = new OfflineRecoveryLease();
    AtomicInteger closes = new AtomicInteger();
    assertTrue(lease.accept(closes::incrementAndGet));
    lease.close(); lease.close();
    assertEquals(1, closes.get());
  }
  @Test public void callbackDeliveredAfterCancelOrTimeoutIsClosedImmediately() {
    OfflineRecoveryLease lease = new OfflineRecoveryLease();
    AtomicInteger closes = new AtomicInteger();
    lease.close();
    assertFalse(lease.accept(closes::incrementAndGet));
    lease.close();
    assertEquals(1, closes.get());
  }
  @Test public void unexpectedDuplicateReservationIsNotLeakedOrSubstitutedForTheOriginal() {
    OfflineRecoveryLease lease = new OfflineRecoveryLease();
    AtomicInteger original = new AtomicInteger(), duplicate = new AtomicInteger();
    assertTrue(lease.accept(original::incrementAndGet));
    assertFalse(lease.accept(duplicate::incrementAndGet));
    assertEquals(0, original.get()); assertEquals(1, duplicate.get());
    lease.close(); assertEquals(1, original.get());
  }
  private static final class Store implements OfflineRecoverySettings.Store {
    String value; boolean writeAllowed = true, lieOnWrite; int writes;
    Store(String value) { this.value = value; }
    public String read() { return value; }
    public boolean write(String next) {
      writes++;
      if (!writeAllowed) return false;
      if (!lieOnWrite) value = next;
      return true;
    }
  }
  @Test public void restoresEveryOriginalValueIncludingMissingSetting() {
    for (String original : new String[] {null, "0", "1"}) {
      Store store = new Store(original);
      OfflineRecoverySettings setting = new OfflineRecoverySettings(store);
      setting.capture(); assertTrue(setting.nudge());
      assertEquals("1", store.value);
      assertTrue(setting.restore()); assertEquals(original, store.value);
      int writes = store.writes;
      assertTrue(setting.restore()); assertEquals(writes, store.writes);
    }
  }
  @Test public void hotspotFailureBeforeNudgeStillRestoresFrameworkChangedValue() {
    Store store = new Store("1");
    OfflineRecoverySettings setting = new OfflineRecoverySettings(store);
    setting.capture(); setting.markNetworkMutation();
    store.value = "0"; // Framework clears wireless debugging during the hotspot transition.
    assertTrue(setting.restore()); assertEquals("1", store.value);
  }
  @Test public void revokedPermissionOrUnverifiedRestorationDoesNotReturnSuccess() {
    Store denied = new Store("0");
    OfflineRecoverySettings first = new OfflineRecoverySettings(denied);
    first.capture(); assertTrue(first.nudge()); denied.writeAllowed = false;
    assertFalse(first.restore()); assertFalse(first.restore());
    Store unchanged = new Store("0");
    OfflineRecoverySettings second = new OfflineRecoverySettings(unchanged);
    second.capture(); assertTrue(second.nudge()); unchanged.lieOnWrite = true;
    assertFalse(second.restore());
  }
  @Test public void permissionPreparationDoesNotWriteAnyDebuggingSetting() {
    Store store = new Store("1");
    OfflineRecoverySettings setting = new OfflineRecoverySettings(store);
    assertTrue(setting.restore()); assertEquals(0, store.writes);
    assertEquals("1", store.value);
  }
  @Test public void noDelayedNudgeCanReenableDebuggingAfterRestoration() {
    Store store = new Store("0");
    OfflineRecoverySettings setting = new OfflineRecoverySettings(store);
    setting.capture(); assertTrue(setting.nudge()); assertTrue(setting.restore());
    try { setting.nudge(); fail("A late nudge must be rejected"); }
    catch (IllegalStateException expected) { }
    assertEquals("0", store.value);
  }
}
