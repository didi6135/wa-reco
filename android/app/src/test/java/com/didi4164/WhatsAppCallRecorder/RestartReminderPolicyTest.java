package com.didi4164.WhatsAppCallRecorder;

import java.util.Arrays;
import org.junit.Test;
import static org.junit.Assert.*;

public class RestartReminderPolicyTest {
  private static String token(char value) { char[] chars = new char[64]; Arrays.fill(chars, value); return new String(chars); }
  private static boolean valid(String stored, String supplied, long issued, int savedBoot, int currentBoot, long now) {
    return RestartReminderPolicy.acceptsToken(stored, supplied, issued, savedBoot, currentBoot, now);
  }
  @Test public void previouslyEnabledSystemWithPermittedNotificationsGetsOnlyAReminderDecision() {
    assertTrue(RestartReminderPolicy.shouldNotify(34, true, true, true, true, true, true));
    assertTrue(RestartReminderPolicy.shouldNotify(36, true, true, true, true, true, true));
  }
  @Test public void manualOrExperimentalPreferenceNeverGetsAReminder() {
    assertFalse(RestartReminderPolicy.shouldNotify(36, true, false, true, true, true, true));
    assertFalse(RestartReminderPolicy.shouldNotify(36, true, true, false, true, true, true));
  }
  @Test public void lockedBootAndUnsupportedSdkNeverGetAReminder() {
    for (int sdk : new int[] {24, 25, 26, 28, 33})
      assertFalse(RestartReminderPolicy.shouldNotify(sdk, true, true, true, true, true, true));
    assertFalse(RestartReminderPolicy.shouldNotify(36, false, true, true, true, true, true));
  }
  @Test public void everyNotificationDenialPreventsTheReminder() {
    assertFalse(RestartReminderPolicy.shouldNotify(36, true, true, true, false, true, true));
    assertFalse(RestartReminderPolicy.shouldNotify(36, true, true, true, true, false, true));
    assertFalse(RestartReminderPolicy.shouldNotify(36, true, true, true, true, true, false));
  }
  @Test public void currentPrivateTokenInCurrentBootIsAccepted() {
    assertTrue(valid(token('a'), token('a'), 1000, 7, 7, 1001));
  }
  @Test public void exportedActivitySpoofCannotGuessTheStoredToken() {
    assertFalse(valid(token('a'), token('b'), 1000, 7, 7, 1001));
    assertFalse(valid(token('a'), null, 1000, 7, 7, 1001));
    assertFalse(valid(null, token('a'), 1000, 7, 7, 1001));
  }
  @Test public void onlyCanonicalFixedLengthHexIsAccepted() {
    for (String supplied : new String[] {"", "a", token('a') + "a", token('A'), token('g'), token('a') + "\n"})
      assertFalse(valid(token('a'), supplied, 1000, 7, 7, 1001));
    assertFalse(valid(token('A'), token('A'), 1000, 7, 7, 1001));
  }
  @Test public void expiryBoundaryRejectsOldNotificationTaps() {
    assertTrue(valid(token('a'), token('a'), 1000, 7, 7, 1000 + RestartReminderPolicy.TOKEN_MAX_AGE_MS - 1));
    assertFalse(valid(token('a'), token('a'), 1000, 7, 7, 1000 + RestartReminderPolicy.TOKEN_MAX_AGE_MS));
  }
  @Test public void futureOrMissingMonotonicTimestampIsRejected() {
    for (long issued : new long[] {-1, 0, 1002}) assertFalse(valid(token('a'), token('a'), issued, 7, 7, 1001));
    assertFalse(valid(token('a'), token('a'), 1000, 7, 7, -1));
  }
  @Test public void unreadableOrDifferentBootRejectsTheOldNonce() {
    assertFalse(valid(token('a'), token('a'), 1000, -1, -1, 1001));
    assertFalse(valid(token('a'), token('a'), 1000, 7, -1, 1001));
    assertFalse(valid(token('a'), token('a'), 1000, 7, 8, 1001));
  }
  @Test public void removingStoredTokenBeforeQueueMakesReplayInert() {
    String stored = token('a');
    assertTrue(valid(stored, token('a'), 1000, 7, 7, 1001));
    stored = null;
    assertFalse(valid(stored, token('a'), 1000, 7, 7, 1002));
  }
  @Test public void replacementNonceInvalidatesAnEarlierNotification() {
    assertFalse(valid(token('b'), token('a'), 1000, 7, 7, 1001));
    assertTrue(valid(token('b'), token('b'), 1000, 7, 7, 1001));
  }
}
