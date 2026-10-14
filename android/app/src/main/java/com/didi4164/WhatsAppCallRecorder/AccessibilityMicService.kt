package com.didi4164.WhatsAppCallRecorder

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.view.accessibility.AccessibilityEvent

/** Optional input-sharing experiment. No event processing, windows, gestures, or click automation. */
class AccessibilityMicService : AccessibilityService() {
  companion object { @Volatile private var live: AccessibilityMicService? = null
    fun isConnected(): Boolean = live != null
  }
  override fun onServiceConnected() { super.onServiceConnected(); live = this }
  override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit
  override fun onInterrupt() = Unit
  private fun disconnected() {
    if (live !== this) return
    live = null
    // Losing access may stop an existing experiment; it never starts or arms one.
    AutoRecordingController.onAccessibilityDisconnected(applicationContext)
    RecordingService.onAccessibilityDisconnected(applicationContext)
  }
  override fun onUnbind(intent: Intent?): Boolean { disconnected(); return super.onUnbind(intent) }
  override fun onDestroy() { disconnected(); super.onDestroy() }
}
