package com.didi4164.WhatsAppCallRecorder;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.regex.Pattern;

/** Pure decisions only: a boot event and an enabled preference never authorize recording. */
public final class RestartReminderPolicy {
  public static final long TOKEN_MAX_AGE_MS = 24L * 60 * 60 * 1000;
  private static final Pattern TOKEN = Pattern.compile("[a-f0-9]{64}");
  private RestartReminderPolicy() {}

  public static boolean shouldNotify(int sdk, boolean unlocked, boolean autoEnabled,
      boolean systemMode, boolean appNotifications, boolean runtimePermission, boolean channelEnabled) {
    return sdk >= 34 && unlocked && autoEnabled && systemMode && appNotifications &&
      runtimePermission && channelEnabled;
  }

  public static boolean acceptsToken(String stored, String supplied, long issuedAt,
      int issuedBoot, int currentBoot, long now) {
    if (stored == null || supplied == null || !TOKEN.matcher(stored).matches() ||
        !TOKEN.matcher(supplied).matches() || issuedAt <= 0 || now < issuedAt ||
        now - issuedAt >= TOKEN_MAX_AGE_MS || issuedBoot < 0 || currentBoot != issuedBoot) return false;
    return MessageDigest.isEqual(stored.getBytes(StandardCharsets.US_ASCII),
      supplied.getBytes(StandardCharsets.US_ASCII));
  }
}
