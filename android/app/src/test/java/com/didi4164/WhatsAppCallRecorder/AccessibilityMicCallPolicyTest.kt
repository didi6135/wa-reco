package com.didi4164.WhatsAppCallRecorder

import org.junit.Assert.*
import org.junit.Test

class AccessibilityMicCallPolicyTest {
  private fun call(key: String = "call-a", packageName: String = "com.whatsapp", uid: Int = 10123) =
    AutoCallPolicy.NotificationSignal(packageName, uid, key, "call", true, callType = 2)
  private fun step(policy: AccessibilityMicCallPolicy, at: Long, signals: List<AutoCallPolicy.NotificationSignal> = listOf(call()),
      mode: Int? = 3, ready: Boolean = true, busy: Boolean = false, capturing: Boolean = false) =
    policy.step(at, signals, mode, ready, busy, capturing)
  private fun started(): AccessibilityMicCallPolicy = AccessibilityMicCallPolicy().also {
    assertEquals(AccessibilityMicCallPolicy.Decision.None, step(it, 1000))
    val start = step(it, 1500) as AccessibilityMicCallPolicy.Decision.Start
    it.onStartAccepted(start.episode)
  }
  @Test fun requiresDistinctFreshSamplesAndStableOngoingCommunication() {
    val policy = AccessibilityMicCallPolicy()
    assertEquals(AccessibilityMicCallPolicy.Decision.None, step(policy, 1000))
    assertEquals(AccessibilityMicCallPolicy.Decision.None, step(policy, 1000))
    assertEquals(AccessibilityMicCallPolicy.Decision.None, step(policy, 1499))
    assertEquals(AccessibilityMicCallPolicy.Decision.Start(AccessibilityMicCallPolicy.Episode(10123, "call-a")), step(policy, 1500))
  }
  @Test fun ringingIncomingMissedGroupMessagesAndOtherAppsNeverStart() {
    val rejected = listOf(call().copy(callType = 1), call().copy(callType = 3), call().copy(hasAnswer = true),
      call().copy(groupSummary = true), call().copy(callType = 0, category = "msg"), call(packageName = "com.other"), call(uid = 1000))
    rejected.forEach { signal ->
      val policy = AccessibilityMicCallPolicy()
      assertEquals(AccessibilityMicCallPolicy.Decision.None, step(policy, 1000, listOf(signal)))
      assertEquals(AccessibilityMicCallPolicy.Decision.None, step(policy, 2000, listOf(signal)))
    }
  }
  @Test fun businessUsesTheSameExperimentalDetectionRules() {
    val policy = AccessibilityMicCallPolicy(); val signal = call(packageName = "com.whatsapp.w4b", uid = 10456)
    step(policy, 1000, listOf(signal))
    assertEquals(AccessibilityMicCallPolicy.Decision.Start(AccessibilityMicCallPolicy.Episode(10456, "call-a")), step(policy, 1500, listOf(signal)))
  }
  @Test fun unknownOrNonCommunicationModeCannotAuthorizeCapture() {
    listOf<Int?>(null, 0, 1, 2).forEach { mode ->
      val policy = AccessibilityMicCallPolicy(); step(policy, 1000, mode = mode)
      assertEquals(AccessibilityMicCallPolicy.Decision.None, step(policy, 2000, mode = mode))
    }
  }
  @Test fun missingAccessOrBusyManualRecorderCannotStart() {
    val policy = AccessibilityMicCallPolicy(); step(policy, 1000)
    assertEquals(AccessibilityMicCallPolicy.Decision.None, step(policy, 1500, ready = false))
    assertEquals(AccessibilityMicCallPolicy.Decision.None, step(policy, 2000, busy = true))
    assertEquals(AccessibilityMicCallPolicy.Decision.None, step(policy, 2500))
    assertTrue(step(policy, 3000) is AccessibilityMicCallPolicy.Decision.Start)
  }
  @Test fun simultaneousOngoingApplicationsAndBlankKeysAreAmbiguous() {
    val policy = AccessibilityMicCallPolicy()
    listOf(listOf(call(), call("business", "com.whatsapp.w4b", 10456)), listOf(call("")), listOf(call(), call())).forEach {
      step(policy, 1000, it)
      assertEquals(AccessibilityMicCallPolicy.Decision.None, step(policy, 2000, it))
    }
  }
  @Test fun gapClockRollbackAndEpisodeChangesResetStartStability() {
    val policy = AccessibilityMicCallPolicy(); step(policy, 1000)
    assertEquals(AccessibilityMicCallPolicy.Decision.None, step(policy, 4000))
    assertEquals(AccessibilityMicCallPolicy.Decision.None, step(policy, 3500))
    assertEquals(AccessibilityMicCallPolicy.Decision.None, step(policy, 4000, listOf(call("new"))))
    assertTrue(step(policy, 4500, listOf(call("new"))) is AccessibilityMicCallPolicy.Decision.Start)
  }
  @Test fun staleLiveNotificationAtArmingCannotFollowForeignVoipMode() {
    val policy = AccessibilityMicCallPolicy(); policy.prime(listOf(call()))
    step(policy, 1000, mode = 0)
    step(policy, 1500)
    assertEquals(AccessibilityMicCallPolicy.Decision.None, step(policy, 2000))
    assertNull(policy.acceptedEpisode())
  }
  @Test fun initialOngoingEpisodeMustEndBeforeAutomaticCaptureCanStart() {
    val policy = AccessibilityMicCallPolicy(); policy.prime(listOf(call()))
    step(policy, 1000, listOf(call("new")))
    assertEquals(AccessibilityMicCallPolicy.Decision.None, step(policy, 1500, listOf(call("new"))))
    step(policy, 2000, emptyList(), mode = 0); step(policy, 3500, emptyList(), mode = 0)
    step(policy, 4000, listOf(call("new")))
    assertTrue(step(policy, 4500, listOf(call("new"))) is AccessibilityMicCallPolicy.Decision.Start)
  }
  @Test fun accessLossStopsOwnedCaptureImmediately() {
    val policy = started()
    assertEquals(AccessibilityMicCallPolicy.Decision.Stop, step(policy, 2000, ready = false, busy = true, capturing = true))
  }
  @Test fun briefNotificationFlickerDoesNotStopButConfirmedEndDoes() {
    val policy = started()
    assertEquals(AccessibilityMicCallPolicy.Decision.None, step(policy, 2000, emptyList(), busy = true, capturing = true))
    assertEquals(AccessibilityMicCallPolicy.Decision.None, step(policy, 2500, busy = true, capturing = true))
    step(policy, 3000, emptyList(), mode = 0, busy = true, capturing = true)
    assertEquals(AccessibilityMicCallPolicy.Decision.Stop, step(policy, 4500, emptyList(), mode = 0, busy = true, capturing = true))
  }
  @Test fun manualStopCannotResumeFromFlickerChangedKeyOrUnknownMode() {
    val policy = started(); policy.suppress(listOf(call()), 3); policy.onStopAccepted(); policy.onCaptureCompleted(false)
    step(policy, 2000, emptyList(), mode = null)
    step(policy, 2500, listOf(call("replaced")))
    assertEquals(AccessibilityMicCallPolicy.Decision.None, step(policy, 3000, listOf(call("replaced"))))
    assertTrue(policy.isSuppressed())
  }
  @Test fun sustainedRealEndAllowsNextCallAfterManualStop() {
    val policy = started(); policy.suppress(listOf(call()), 3); policy.onStopAccepted(); policy.onCaptureCompleted(false)
    step(policy, 2000, emptyList(), mode = 0); step(policy, 3500, emptyList(), mode = 0)
    assertFalse(policy.isSuppressed())
    step(policy, 4000, listOf(call("next")))
    assertTrue(step(policy, 4500, listOf(call("next"))) is AccessibilityMicCallPolicy.Decision.Start)
  }
  @Test fun callHoldOrStaleLiveNotificationCannotReleaseManualStop() {
    val policy = started(); policy.suppress(listOf(call()), 3); policy.onStopAccepted(); policy.onCaptureCompleted(false)
    step(policy, 2000, mode = 0); step(policy, 3500, mode = 0)
    assertTrue(policy.isSuppressed())
    step(policy, 4000)
    assertEquals(AccessibilityMicCallPolicy.Decision.None, step(policy, 4500))
  }
  @Test fun cellularHandoffCannotReleaseStoppedWhatsAppEpisode() {
    val policy = started(); policy.suppress(listOf(call()), 3); policy.onStopAccepted(); policy.onCaptureCompleted(false)
    step(policy, 2000, mode = 2); step(policy, 3500, mode = 2)
    assertTrue(policy.isSuppressed())
    step(policy, 4000)
    assertEquals(AccessibilityMicCallPolicy.Decision.None, step(policy, 4500))
  }
  @Test fun failedCaptureIsSuppressedRatherThanRetriedInSameCall() {
    val policy = started(); policy.onCaptureCompleted(true)
    step(policy, 2000)
    assertEquals(AccessibilityMicCallPolicy.Decision.None, step(policy, 2500))
    assertTrue(policy.isSuppressed())
  }
  @Test fun finalizationCannotBeginAnotherCapture() {
    val policy = started(); policy.onStopAccepted()
    assertEquals(AccessibilityMicCallPolicy.Decision.None, step(policy, 2000, listOf(call("next"))))
  }
}
