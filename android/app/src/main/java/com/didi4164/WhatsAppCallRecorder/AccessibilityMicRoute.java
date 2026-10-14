package com.didi4164.WhatsAppCallRecorder;

/** Numeric Android device types only; no device identity, name or address leaves the recorder. */
public final class AccessibilityMicRoute {
  private AccessibilityMicRoute() {}
  public static String output(int type) {
    if (type == 1) return "earpiece";
    if (type == 2 || type == 24 || type == 27) return "speaker";
    if (type == 3 || type == 4 || type == 7 || type == 8 || type == 11 || type == 12 ||
        type == 22 || type == 23 || type == 26) return "headset";
    return "unknown";
  }
  public static String input(int type) {
    if (type == 15) return "builtin_mic";
    if (type == 3) return "wired";
    if (type == 7 || type == 26) return "bluetooth";
    if (type == 11 || type == 12 || type == 22) return "usb";
    return "unknown";
  }
}
