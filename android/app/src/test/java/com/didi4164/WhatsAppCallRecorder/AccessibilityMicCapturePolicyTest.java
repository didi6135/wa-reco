package com.didi4164.WhatsAppCallRecorder;

import org.junit.Test;
import static org.junit.Assert.*;

public class AccessibilityMicCapturePolicyTest {
  @Test public void unsupportedPlatformNeverBecomesReadyFromEnabledService() {
    assertEquals("ACCESSIBILITY_MIC_UNSUPPORTED", AccessibilityMicCapturePolicy.rejection(28, true, true, true, true));
  }
  @Test public void selectedModeAndBothActualServiceStatesAreRequired() {
    assertEquals("ACCESSIBILITY_MIC_REQUIRED", AccessibilityMicCapturePolicy.rejection(36, false, true, true, true));
    assertEquals("ACCESSIBILITY_MIC_REQUIRED", AccessibilityMicCapturePolicy.rejection(36, true, false, true, true));
    assertEquals("ACCESSIBILITY_MIC_REQUIRED", AccessibilityMicCapturePolicy.rejection(36, true, true, false, true));
  }
  @Test public void microphoneRuntimeGrantIsIndependentOfAccessibility() {
    assertEquals("MIC_PERMISSION", AccessibilityMicCapturePolicy.rejection(36, true, true, true, false));
    assertNull(AccessibilityMicCapturePolicy.rejection(29, true, true, true, true));
  }
  @Test public void onlyKnownModeIdsMayBePersisted() {
    assertEquals("INVALID_RECORDING_MODE", AccessibilityMicCapturePolicy.modeMutationRejection("root", 36, true, false, false, false, 0));
    assertEquals("INVALID_RECORDING_MODE", AccessibilityMicCapturePolicy.modeMutationRejection(null, 36, true, false, false, false, 0));
  }
  @Test public void modeChangeRequiresVisibleForeground() {
    assertEquals("FOREGROUND_REQUIRED", AccessibilityMicCapturePolicy.modeMutationRejection("accessibilityMic", 36, false, false, false, false, 0));
  }
  @Test public void pendingArmCannotRaceModeSelection() {
    assertEquals("RECORDING_BUSY", AccessibilityMicCapturePolicy.modeMutationRejection("system", 36, true, false, true, false, 0));
    assertEquals("RECORDING_BUSY", AccessibilityMicCapturePolicy.modeMutationRejection("accessibilityMic", 36, true, true, false, false, 0));
  }
  @Test public void helperPreparationCannotRaceModeSelection() {
    assertEquals("RECORDER_PREPARING", AccessibilityMicCapturePolicy.modeMutationRejection("accessibilityMic", 36, true, false, false, true, 0));
  }
  @Test public void activeCommunicationCallScreeningAndRedirectionBlockModeSwitch() {
    for (int mode : new int[] {2, 3, 4, 5, 6})
      assertEquals("CALL_ACTIVE", AccessibilityMicCapturePolicy.modeMutationRejection("system", 36, true, false, false, false, mode));
  }
  @Test public void systemModeRemainsAvailableOnPreSharingPlatforms() {
    assertNull(AccessibilityMicCapturePolicy.modeMutationRejection("system", 28, true, false, false, false, 0));
    assertEquals("ACCESSIBILITY_MIC_UNSUPPORTED", AccessibilityMicCapturePolicy.modeMutationRejection("accessibilityMic", 28, true, false, false, false, 0));
  }
  @Test public void explicitIdleCandidateModeChangePassesWithoutAnyAdbInput() {
    assertNull(AccessibilityMicCapturePolicy.modeMutationRejection("accessibilityMic", 29, true, false, false, false, 0));
  }
}
