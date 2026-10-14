package com.didi4164.WhatsAppCallRecorder;

import org.junit.Test;
import static org.junit.Assert.*;

public class AccessibilityMicAppInfoPolicyTest {
  @Test public void restrictedSettingsRecoveryIsVersionBounded() {
    assertFalse(AccessibilityMicCapturePolicy.appInfoRecoverySupported(29));
    assertFalse(AccessibilityMicCapturePolicy.appInfoRecoverySupported(32));
    assertTrue(AccessibilityMicCapturePolicy.appInfoRecoverySupported(33));
    assertTrue(AccessibilityMicCapturePolicy.appInfoRecoverySupported(36));
    assertEquals("ACCESSIBILITY_APP_INFO_UNSUPPORTED", rejection(32, true, true, false, false, false, 0, false));
  }
  @Test public void unavailableOrCanceledForegroundCannotNavigate() {
    assertEquals("FOREGROUND_REQUIRED", rejection(36, true, false, false, false, false, 0, false));
  }
  @Test public void activeCaptureAndQueuedArmingBlockNavigation() {
    assertEquals("RECORDING_BUSY", rejection(36, true, true, true, false, false, 0, false));
    assertEquals("RECORDING_BUSY", rejection(36, true, true, false, true, false, 0, false));
  }
  @Test public void preparationCannotBeInterruptedByRecoveryNavigation() {
    assertEquals("RECORDER_PREPARING", rejection(36, true, true, false, false, true, 0, false));
  }
  @Test public void ringingCommunicationScreeningAndUnknownAudioStateBlockNavigation() {
    for (int mode : new int[] {-1, 1, 2, 3, 4, 5, 6})
      assertEquals("CALL_ACTIVE", rejection(36, true, true, false, false, false, mode, false));
  }
  @Test public void observedCallBlocksEvenIfPublicAudioModeIsNormal() {
    assertEquals("CALL_ACTIVE", rejection(36, true, true, false, false, false, 0, true));
  }
  @Test public void pairedModeCannotLaunchExperimentalSetupRecovery() {
    assertEquals("ACCESSIBILITY_MIC_MODE_REQUIRED", rejection(36, false, true, false, false, false, 0, false));
  }
  @Test public void explicitIdleSelectedModeCanOpenAppInfoWithoutServiceOrMicrophoneGrantInputs() {
    // A blocked/unapproved service is the reason this action exists; it must not require service readiness.
    assertNull(rejection(33, true, true, false, false, false, 0, false));
    assertNull(rejection(36, true, true, false, false, false, 0, false));
  }
  private static String rejection(int sdk, boolean selected, boolean foreground, boolean busy,
      boolean arming, boolean preparing, int audioMode, boolean observedCall) {
    return AccessibilityMicCapturePolicy.appInfoRecoveryRejection(sdk, selected, foreground, busy,
      arming, preparing, audioMode, observedCall);
  }
}
