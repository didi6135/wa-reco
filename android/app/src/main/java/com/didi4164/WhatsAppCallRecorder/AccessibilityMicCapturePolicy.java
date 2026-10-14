package com.didi4164.WhatsAppCallRecorder;

/** Pure ordinary-microphone gates; no ADB state or shell permission can replace live accessibility. */
public final class AccessibilityMicCapturePolicy {
  private AccessibilityMicCapturePolicy() {}
  public static String rejection(int sdk, boolean selected, boolean enabled, boolean connected, boolean microphone) {
    if (sdk < 29) return "ACCESSIBILITY_MIC_UNSUPPORTED";
    if (!selected || !enabled || !connected) return "ACCESSIBILITY_MIC_REQUIRED";
    if (!microphone) return "MIC_PERMISSION";
    return null;
  }
  public static String modeMutationRejection(String mode, int sdk, boolean foreground, boolean busy,
      boolean arming, boolean preparing, int audioMode) {
    if (!"system".equals(mode) && !"accessibilityMic".equals(mode)) return "INVALID_RECORDING_MODE";
    if (!foreground) return "FOREGROUND_REQUIRED";
    if (busy || arming) return "RECORDING_BUSY";
    if (preparing) return "RECORDER_PREPARING";
    if (audioMode >= 2) return "CALL_ACTIVE";
    if ("accessibilityMic".equals(mode) && sdk < 29) return "ACCESSIBILITY_MIC_UNSUPPORTED";
    return null;
  }
  /** App-info navigation is a user action, not evidence that Android restricted a setting. */
  public static boolean appInfoRecoverySupported(int sdk) { return sdk >= 33; }
  public static String appInfoRecoveryRejection(int sdk, boolean selected, boolean foreground,
      boolean busy, boolean arming, boolean preparing, int audioMode, boolean observedCall) {
    if (!foreground) return "FOREGROUND_REQUIRED";
    if (busy || arming) return "RECORDING_BUSY";
    if (preparing) return "RECORDER_PREPARING";
    if (audioMode != 0 || observedCall) return "CALL_ACTIVE";
    if (!appInfoRecoverySupported(sdk)) return "ACCESSIBILITY_APP_INFO_UNSUPPORTED";
    if (!selected) return "ACCESSIBILITY_MIC_MODE_REQUIRED";
    return null;
  }
}
