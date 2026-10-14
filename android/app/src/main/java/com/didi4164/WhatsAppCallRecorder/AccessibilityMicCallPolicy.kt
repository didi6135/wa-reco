package com.didi4164.WhatsAppCallRecorder

/** Experimental structural detection. A public mode/notification never proves digital call access. */
class AccessibilityMicCallPolicy {
  data class Episode(val uid: Int, val key: String)
  sealed class Decision { object None : Decision(); data class Start(val episode: Episode) : Decision(); object Stop : Decision() }
  private var pending: Episode? = null
  private var pendingAt = 0L
  private var lastSampleAt = -1L
  private var accepted: Episode? = null
  private var stopping = false
  private var endedAt: Long? = null
  private var suppressed: Episode? = null
  private var suppressedEndedAt: Long? = null
  private var baseline = emptySet<String>()
  private var baselineEndedAt: Long? = null
  fun reset() { pending = null; accepted = null; stopping = false; endedAt = null; suppressed = null; suppressedEndedAt = null; lastSampleAt = -1L; baseline = emptySet(); baselineEndedAt = null }
  fun prime(signals: Collection<AutoCallPolicy.NotificationSignal>) { baseline = signals.filter { AutoCallPolicy.isOngoingCall(it) }.map { it.key }.toSet() }
  fun acceptedEpisode(): Episode? = accepted
  fun isSuppressed(): Boolean = suppressed != null
  fun candidate(signals: Collection<AutoCallPolicy.NotificationSignal>, mode: Int?): Episode? {
    if (mode != AutoCallPolicy.COMMUNICATION_MODE) return null
    return signals.filter { AutoCallPolicy.isOngoingCall(it) }.singleOrNull()
      ?.takeIf { it.key.isNotBlank() }?.let { Episode(it.uid, it.key) }
  }
  fun suppress(signals: Collection<AutoCallPolicy.NotificationSignal>, mode: Int?) {
    suppressed = accepted ?: candidate(signals, mode) ?: suppressed
    suppressedEndedAt = null; pending = null
  }
  fun onStartAccepted(episode: Episode) { accepted = episode; pending = null; stopping = false; endedAt = null }
  fun onStopAccepted() { accepted?.let { suppressed = it }; suppressedEndedAt = null; stopping = true; pending = null }
  fun onCaptureCompleted(failed: Boolean) { if (failed) accepted?.let { suppressed = it }; accepted = null; stopping = false; pending = null; endedAt = null }
  fun step(now: Long, signals: Collection<AutoCallPolicy.NotificationSignal>, mode: Int?, ready: Boolean,
      busy: Boolean, capturing: Boolean): Decision {
    val sampleContinuous = lastSampleAt < 0 || (now > lastSampleAt && now - lastSampleAt <= AutoCallPolicy.MAX_SAMPLE_AGE_MS)
    if (!sampleContinuous) { pending = null; endedAt = null; suppressedEndedAt = null; baselineEndedAt = null }
    lastSampleAt = now
    val current = candidate(signals, mode)
    if (baseline.isNotEmpty()) {
      if (mode == 0 && signals.none { AutoCallPolicy.isOngoingCall(it) }) {
        val since = baselineEndedAt ?: now.also { baselineEndedAt = it }
        if (sampleContinuous && now - since >= AutoCallPolicy.STOP_GRACE_MS) { baseline = emptySet(); baselineEndedAt = null }
      } else baselineEndedAt = null
    }
    if (suppressed != null) {
      // A changed notification key alone never undoes a user's STOP during the same communication episode.
      if (mode == 0 && signals.none { AutoCallPolicy.isOngoingCall(it) }) {
        val since = suppressedEndedAt ?: now.also { suppressedEndedAt = it }
        if (sampleContinuous && now - since >= AutoCallPolicy.STOP_GRACE_MS) { suppressed = null; suppressedEndedAt = null }
      } else suppressedEndedAt = null
    }
    if (!ready) { pending = null; return if (capturing && !stopping) Decision.Stop else Decision.None }
    if (accepted != null || capturing) {
      if (stopping) return Decision.None
      if (current == accepted && sampleContinuous) { endedAt = null; return Decision.None }
      val since = endedAt ?: now.also { endedAt = it }
      return if (sampleContinuous && now - since >= AutoCallPolicy.STOP_GRACE_MS) Decision.Stop else Decision.None
    }
    if (busy || suppressed != null || baseline.isNotEmpty() || current == null || mode == null) { pending = null; return Decision.None }
    if (pending != current || !sampleContinuous) { pending = current; pendingAt = now; return Decision.None }
    return if (now - pendingAt >= AutoCallPolicy.START_STABILITY_MS) Decision.Start(current) else Decision.None
  }
}
