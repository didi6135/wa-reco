package com.didi4164.WhatsAppCallRecorder;

import org.junit.Test;
import static org.junit.Assert.*;

public class OfflineRecoveryPolicyTest {
  private String reject(int sdk, boolean foreground, boolean busy, boolean admin, boolean paired,
      boolean enabled, boolean grant, boolean nearby, boolean preparation) {
    return OfflineRecoveryPolicy.rejection(sdk, foreground, busy, admin, paired, enabled, grant, nearby, preparation);
  }
  @Test public void candidateSdkDoesNotInventAProtectedGrant() {
    assertEquals("OFFLINE_UNSUPPORTED", reject(33, true, false, false, true, true, true, true, false));
    assertEquals("OFFLINE_PERMISSION_REQUIRED", reject(34, true, false, false, true, true, false, true, false));
    assertNull(reject(34, true, false, false, true, true, true, true, false));
  }
  @Test public void backgroundAndAdministratorRestrictionsWinEvenWithEveryGrant() {
    assertEquals("OFFLINE_FOREGROUND_REQUIRED", reject(36, false, false, false, true, true, true, true, false));
    assertEquals("OFFLINE_ADMIN_RESTRICTED", reject(36, true, false, true, true, true, true, true, false));
    assertEquals("OFFLINE_ADMIN_RESTRICTED", reject(36, true, false, true, true, false, false, false, true));
  }
  @Test public void activeAudioCannotBeDisruptedByRecoveryOrPreparation() {
    assertEquals("OFFLINE_RECORDING_BUSY", reject(36, true, true, false, true, true, true, true, false));
    assertEquals("OFFLINE_RECORDING_BUSY", reject(36, true, true, false, true, false, false, false, true));
  }
  @Test public void preparationStillRequiresPreviouslyAuthorizedPairing() {
    assertEquals("OFFLINE_PAIRING_REQUIRED", reject(36, true, false, false, false, false, false, false, true));
    assertNull(reject(36, true, false, false, true, false, false, false, true));
  }
  @Test public void recoveryIsAnOptInWithItsOwnHotspotPermission() {
    assertEquals("OFFLINE_DISABLED", reject(36, true, false, false, true, false, true, true, false));
    assertEquals("OFFLINE_NEARBY_PERMISSION_REQUIRED", reject(36, true, false, false, true, true, true, false, false));
  }
  @Test public void deadlineExpiresAtTheMonotonicBoundary() {
    OfflineRecoveryState state = new OfflineRecoveryState(120, 60000);
    assertNull(state.rejection(60119));
    assertEquals("OFFLINE_TIMEOUT", state.rejection(60120));
    assertEquals(0, state.remaining(60121));
  }
  @Test public void canceledAttemptCannotAdvanceOrBecomeReady() {
    OfflineRecoveryState state = new OfflineRecoveryState(10, 60000);
    assertTrue(state.transition("discovering", 11));
    state.cancel("OFFLINE_CANCELED");
    assertFalse(state.transition("connecting", 12));
    state.restored(15);
    assertFalse(state.ready(true, 20, 21));
    assertFalse(state.commitReady(22));
  }
  @Test public void networkAdvertisementAndOldHeartbeatNeverProveRestoredReadiness() {
    OfflineRecoveryState state = new OfflineRecoveryState(0, 60000);
    assertTrue(state.transition("connecting", 10));
    assertFalse(state.ready(true, 100, 101));
    state.restored(200);
    assertFalse(state.ready(true, 199, 201));
    assertFalse(state.ready(true, 200, 201));
    assertFalse(state.ready(false, 201, 202));
    assertFalse(state.commitReady(203));
  }
  @Test public void readinessIsExposedOnlyAfterFreshHeartbeatAndFinalOwnerCommit() {
    OfflineRecoveryState state = new OfflineRecoveryState(0, 60000);
    state.restored(200);
    assertTrue(state.ready(true, 201, 202));
    assertEquals("verifying", state.stage());
    assertTrue(state.commitReady(203));
    assertEquals("ready", state.stage());
  }
  @Test public void cancelAfterHeartbeatBeforeOwnerPromotionIsHonored() {
    OfflineRecoveryState state = new OfflineRecoveryState(0, 60000);
    state.restored(200);
    assertTrue(state.ready(true, 201, 202));
    state.cancel("OFFLINE_CANCELED");
    assertFalse(state.commitReady(203));
    assertEquals("OFFLINE_CANCELED", state.rejection(204));
  }
  @Test public void ownerPromotionCannotCompletePastTheDeadline() {
    OfflineRecoveryState state = new OfflineRecoveryState(0, 60000);
    state.restored(59980);
    assertTrue(state.ready(true, 59981, 59982));
    assertFalse(state.commitReady(60000));
  }
  @Test public void cleanupAndPreparationDoNotClaimAnAudioHelperExists() {
    OfflineRecoveryState state = new OfflineRecoveryState(0, 30000);
    assertFalse(state.prepared(100));
    state.restored(101);
    assertTrue(state.prepared(102));
    assertEquals("idle", state.stage());
    assertFalse(state.commitReady(103));
  }
}
