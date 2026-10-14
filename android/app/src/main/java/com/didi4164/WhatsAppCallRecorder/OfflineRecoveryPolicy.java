package com.didi4164.WhatsAppCallRecorder;

/** Pure policy for the user-initiated experiment. No setting is a substitute for a shell handshake. */
public final class OfflineRecoveryPolicy {
  private OfflineRecoveryPolicy() {}

  public static String rejection(int sdk, boolean foreground, boolean recordingBusy,
      boolean restricted, boolean paired, boolean enabled, boolean secureGranted,
      boolean nearbyGranted, boolean preparation) {
    if (sdk < 34) return "OFFLINE_UNSUPPORTED";
    if (!foreground) return "OFFLINE_FOREGROUND_REQUIRED";
    if (restricted) return "OFFLINE_ADMIN_RESTRICTED";
    if (recordingBusy) return "OFFLINE_RECORDING_BUSY";
    if (!paired) return "OFFLINE_PAIRING_REQUIRED";
    if (preparation) return null;
    if (!enabled) return "OFFLINE_DISABLED";
    if (!secureGranted) return "OFFLINE_PERMISSION_REQUIRED";
    if (!nearbyGranted) return "OFFLINE_NEARBY_PERMISSION_REQUIRED";
    return null;
  }
}
