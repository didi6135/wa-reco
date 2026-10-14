package com.didi4164.WhatsAppCallRecorder

import android.Manifest
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioManager
import android.os.Handler
import android.os.Build
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableMap
import java.util.concurrent.Executors
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import java.io.PrintWriter

/** Explicit foreground arming; idle monitoring contains mode/UID evidence and no audio. */
object AutoRecordingController {
  private const val PREFS = "automatic_recording"
  private const val ENABLED = "enabled"
  // RecordingService uses this channel for both its armed and capturing foreground notices.
  private const val RECORDING_NOTIFICATION_CHANNEL = "microphone_recording"
  private val NOTIFICATION_VISIBILITY_MESSAGE: String
    get() = AppText.choose("אפשר התראות למקליט השיחות, כולל ערוץ ההקלטה, בהגדרות הטלפון. לאחר מכן הפעל שוב הקלטה אוטומטית.", "Allow wa-reco notifications, including its recording channel, in Android Settings. Then arm automatic recording again.")
  private val main = Handler(Looper.getMainLooper())
  private val io = Executors.newSingleThreadExecutor { task -> Thread(task, "AutomaticCallMonitorIo") }
  private val policy = AutoCallPolicy()
  private val micPolicy = AccessibilityMicCallPolicy()
  private val evidenceWatchdog = AutoEvidenceRecoveryWatchdog()
  private val initializationLock = Any()
  @Volatile private var appContext: Context? = null
  @Volatile private var enabled = false
  @Volatile private var listenerConnected = false
  @Volatile private var monitoringReady = false
  @Volatile private var desiredMonitoring = false
  private var restartActivation: Long? = null // Main thread: revoke only this notification-owned arming.
  @Volatile private var generation = 0L
  @Volatile private var lastError: String? = null
  @Volatile private var paused = false
  @Volatile private var modeEvidenceFailed = false
  @Volatile private var recoveringEvidence = false
  private var notifications = emptyList<AutoCallPolicy.NotificationSignal>()
  private var lastObservedAudio: AutoCallPolicy.AudioObservation? = null
  private var lastTransitionReason = "none"

  private fun UsbAudioBridge.CallAudioSnapshot.asPolicyObservation() = AutoCallPolicy.AudioObservation(
    mode, ownerUid, known, receivedAtMs,
    telecom?.let { proof -> AutoCallPolicy.TelecomObservation(
      proof.known, proof.packageCode, proof.userId, proof.liveCalls, proof.activeCalls,
      proof.foregroundMatched, proof.selfManaged, proof.voip, proof.receivedAtMs,
    ) },
  )

  private fun initialize(context: Context): Context = appContext ?: synchronized(initializationLock) {
    appContext ?: context.applicationContext.also { owner ->
      // Restored preference expresses intent, never permission to re-arm after process death.
      enabled = owner.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(ENABLED, false)
      appContext = owner
    }
  }

  private fun onMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post(block)
  }

  fun hasNotificationAccess(context: Context): Boolean = runCatching {
    val own = ComponentName(context.applicationContext, WhatsAppCallNotificationService::class.java)
    Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")
      ?.split(':')?.any { ComponentName.unflattenFromString(it) == own } == true
  }.getOrDefault(false)

  private fun hasMicrophone(context: Context): Boolean =
    context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
  private fun accessibilityMode(context: Context): Boolean = AccessibilityMicController.mode(context) == AccessibilityMicController.MODE
  private fun publicAudioMode(context: Context): Int? = runCatching {
    (context.getSystemService(Context.AUDIO_SERVICE) as AudioManager).mode
  }.getOrNull()

  /** Read-only. A microphone FGS may run with its notice hidden, which this feature refuses. */
  private fun hasVisibleNotifications(context: Context, requireRecordingChannel: Boolean = false): Boolean = runCatching {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (!manager.areNotificationsEnabled()) return@runCatching false
    if (Build.VERSION.SDK_INT >= 33 &&
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
      return@runCatching false
    if (Build.VERSION.SDK_INT >= 26) {
      val channel = manager.getNotificationChannel(RECORDING_NOTIFICATION_CHANNEL)
      if (channel == null) return@runCatching !requireRecordingChannel
      if (channel.importance == NotificationManager.IMPORTANCE_NONE) return@runCatching false
    }
    true
  }.getOrDefault(false)

  /** Read-only: this method never starts services, schedules monitoring, or captures audio. */
  fun statusMap(context: Context): WritableMap {
    val owner = initialize(context)
    val access = hasNotificationAccess(owner)
    val helper = UsbAudioBridge.isConnected() && !NativeWirelessAudioBridge.isOfflineRecoveryRunning()
    val transportOpen = UsbAudioBridge.isTransportOpen()
    val actualArmed = RecordingService.isAutomaticArmed()
    val mode = AccessibilityMicController.mode(owner)
    val micMode = mode == AccessibilityMicController.MODE
    val modeReady = if (micMode) AccessibilityMicController.ready(owner) else helper
    val visibleNotifications = hasVisibleNotifications(owner, requireRecordingChannel = actualArmed)
    val armed = enabled && monitoringReady && actualArmed && RecordingService.automaticMode() == mode &&
      (!micMode || modeReady) && visibleNotifications && hasMicrophone(owner) && !NativeWirelessAudioBridge.isOfflineRecoveryRunning()
    val recording = armed && RecordingService.isAutomaticCapture()
    val state = when {
      !enabled -> if (modeEvidenceFailed) "error" else "off"
      !visibleNotifications -> "needs_access"
      !access -> "needs_access"
      !listenerConnected -> "needs_access"
      modeEvidenceFailed -> "error"
      (!micMode && !transportOpen) || !armed -> "needs_activation"
      recording -> "recording"
      recoveringEvidence || !modeReady -> "paused"
      lastError != null -> "error"
      paused -> "paused"
      else -> "ready"
    }
    return Arguments.createMap().apply {
      putBoolean("enabled", enabled)
      putString("mode", mode); putBoolean("modeReady", modeReady); putBoolean("experimental", micMode)
      putBoolean("armed", armed)
      putBoolean("notificationAccessGranted", access)
      putBoolean("notificationsEnabled", visibleNotifications)
      putBoolean("listenerConnected", listenerConnected)
      putBoolean("helperConnected", helper)
      putString("state", state)
      val statusError = if (enabled && !visibleNotifications) NOTIFICATION_VISIBILITY_MESSAGE else lastError
      if (statusError == null) putNull("error") else putString("error", statusError)
    }
  }

  fun setEnabled(context: Context, enable: Boolean, promise: Promise, restartGuard: (() -> Boolean)? = null) {
    val owner = initialize(context)
    onMain {
      if (!enable) {
        disableForModeChange(owner)
        promise.resolve(statusMap(owner))
        return@onMain
      }
      if (restartGuard != null && !restartGuard()) {
        promise.reject("RESTART_RESUME_REVOKED", "RESTART_RESUME_REVOKED"); return@onMain
      }
      val alreadyArmed = enabled && monitoringReady && RecordingService.isAutomaticArmed()
      val prerequisite = when {
        NativeWirelessAudioBridge.isOfflineRecoveryRunning() -> AppText.choose("המתן לסיום הכנת רכיב ההקלטה לפני הפעלת מצב אוטומטי.", "Wait for recorder preparation to finish before arming automatic recording.")
        !hasVisibleNotifications(owner, requireRecordingChannel = RecordingService.isAutomaticArmed()) -> NOTIFICATION_VISIBILITY_MESSAGE
        !hasNotificationAccess(owner) -> AppText.choose("אפשר גישה להתראות עבור מקליט השיחות בהגדרות הטלפון.", "Allow notification access for wa-reco in Android Settings.")
        !listenerConnected -> AppText.choose("הגישה להתראות עדיין לא התחברה. חזור לאפליקציה ונסה שוב.", "Notification access has not connected yet. Return to the app and try again.")
        (if (accessibilityMode(owner)) !AccessibilityMicController.ready(owner)
          else if (alreadyArmed) !UsbAudioBridge.isTransportOpen() else !UsbAudioBridge.isConnected()) ->
          AppText.choose("השלם תחילה את הגדרת מצב ההקלטה שנבחר.", "Complete setup for the selected recording mode first.")
        !hasMicrophone(owner) -> AppText.choose("אפשר הרשאת מיקרופון למקליט השיחות.", "Allow microphone access for wa-reco.")
        else -> null
      }
      if (prerequisite != null) {
        lastError = prerequisite
        if (monitoringReady || desiredMonitoring || RecordingService.isAutomaticArmed()) pauseArming(owner)
        promise.reject("AUTO_SETUP_REQUIRED", prerequisite)
        return@onMain
      }
      if (alreadyArmed) {
        RestartReminderController.clear(owner)
        evaluate(owner)
        promise.resolve(statusMap(owner))
        return@onMain
      }
      val activation = ++generation
      restartActivation = if (restartGuard != null) activation else null
      desiredMonitoring = true
      monitoringReady = false
      lastError = null
      modeEvidenceFailed = false
      paused = false
      recoveringEvidence = false
      evidenceWatchdog.reset()
      policy.reset()
      micPolicy.reset()
      if (accessibilityMode(owner)) micPolicy.prime(notifications)
      try {
        RecordingService.armAutomatic(owner).whenComplete { _, failure -> onMain {
          if (activation != generation || !desiredMonitoring) {
            if (!desiredMonitoring) RecordingService.disarmAutomatic(owner)
            promise.reject("AUTO_ACTIVATION_CANCELLED", AppText.choose("הפעלת ההקלטה האוטומטית בוטלה.", "Automatic recording activation was canceled."))
          } else if (restartGuard != null && !restartGuard()) {
            activationFailed(owner, activation, promise, AppText.choose("בקשת החידוש בוטלה. חזרו לאפליקציה כדי להפעיל שוב.", "The resume request was canceled. Return to the app to activate again."))
          } else if (failure != null) {
            activationFailed(owner, activation, promise, AppText.choose("לא ניתן להפעיל הקלטה אוטומטית. פתח את האפליקציה ונסה שוב.", "Automatic recording could not be armed. Open the app and try again."))
          } else enableMonitoring(owner, activation, promise, restartGuard)
        } }
      } catch (_: Exception) {
        activationFailed(owner, activation, promise, AppText.choose("לא ניתן להפעיל הקלטה אוטומטית. פתח את האפליקציה ונסה שוב.", "Automatic recording could not be armed. Open the app and try again."))
      }
    }
  }

  fun disableForModeChange(context: Context) {
    check(Looper.myLooper() == Looper.getMainLooper())
    val owner = initialize(context)
    enabled = false
    owner.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(ENABLED, false).apply()
    RestartReminderController.clear(owner)
    lastError = null; modeEvidenceFailed = false
    pauseArming(owner, "disabled"); policy.reset(); micPolicy.reset(); paused = false
  }

  fun hasObservedCall(): Boolean = notifications.any { AutoCallPolicy.allowsPackage(it.packageName) &&
    !it.groupSummary && (AutoCallPolicy.isOngoingCall(it) || it.callType == 1 || it.hasAnswer) }

  fun cancelRestartArming(context: Context) {
    onMain {
      if (restartActivation != null && restartActivation == generation && desiredMonitoring)
        pauseArming(initialize(context), "restart_resume_revoked")
    }
  }

  private fun enableMonitoring(owner: Context, activation: Long, promise: Promise, restartGuard: (() -> Boolean)? = null) {
    if (restartGuard != null && !restartGuard()) {
      activationFailed(owner, activation, promise, AppText.choose("בקשת החידוש בוטלה.", "The resume request was canceled.")); return
    }
    if (accessibilityMode(owner)) {
      if (activation != generation || !desiredMonitoring || !AccessibilityMicController.ready(owner) ||
        !RecordingService.isAutomaticArmed() || RecordingService.automaticMode() != AccessibilityMicController.MODE ||
        !hasMicrophone(owner) || !listenerConnected || !hasNotificationAccess(owner) ||
        !hasVisibleNotifications(owner, requireRecordingChannel = true) || publicAudioMode(owner) == null) {
        activationFailed(owner, activation, promise, AppText.choose("מצב המיקרופון הניסיוני אינו מוכן. בדוק את ההרשאות ונסה שוב מתוך האפליקציה.", "Experimental microphone mode is not ready. Check access and try again from the app.")); return
      }
      enabled = true; monitoringReady = true; recoveringEvidence = false; lastTransitionReason = "accessibility_armed"
      restartActivation = null
      owner.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(ENABLED, true).apply()
      RestartReminderController.clear(owner)
      main.removeCallbacks(tick); main.post(tick)
      promise.resolve(statusMap(owner)); return
    }
    io.execute {
      var failure = false
      try {
        if (activation == generation && desiredMonitoring) UsbAudioBridge.setCallMonitoring(true)
        if (activation != generation || !desiredMonitoring) UsbAudioBridge.setCallMonitoring(false)
      } catch (_: Exception) { failure = true }
      main.post {
        if (activation != generation || !desiredMonitoring) {
          promise.reject("AUTO_ACTIVATION_CANCELLED", AppText.choose("הפעלת ההקלטה האוטומטית בוטלה.", "Automatic recording activation was canceled."))
        } else if (restartGuard != null && !restartGuard()) {
          activationFailed(owner, activation, promise, AppText.choose("בקשת החידוש בוטלה.", "The resume request was canceled."))
        } else if (!hasVisibleNotifications(owner, requireRecordingChannel = true)) {
          activationFailed(owner, activation, promise, NOTIFICATION_VISIBILITY_MESSAGE)
        } else if (failure || !UsbAudioBridge.isConnected() || !RecordingService.isAutomaticArmed() ||
          !hasMicrophone(owner) ||
          !hasNotificationAccess(owner) || !listenerConnected) {
          activationFailed(owner, activation, promise, AppText.choose("רכיב ההקלטה אינו מוכן לניטור שיחות. הפעל אותו מחדש ונסה שוב.", "The recording component is not ready to monitor calls. Reactivate it and try again."))
        } else awaitKnownObservation(owner, activation, promise, restartGuard)
      }
    }
  }

  private fun awaitKnownObservation(owner: Context, activation: Long, promise: Promise, restartGuard: (() -> Boolean)? = null) {
    val deadline = SystemClock.elapsedRealtime() + 5000L
    val check = object : Runnable {
      override fun run() {
        if (activation != generation || !desiredMonitoring) {
          promise.reject("AUTO_ACTIVATION_CANCELLED", AppText.choose("הפעלת ההקלטה האוטומטית בוטלה.", "Automatic recording activation was canceled."))
          return
        }
        if (restartGuard != null && !restartGuard()) {
          activationFailed(owner, activation, promise, AppText.choose("בקשת החידוש בוטלה.", "The resume request was canceled.")); return
        }
        if (!hasVisibleNotifications(owner, requireRecordingChannel = true)) {
          activationFailed(owner, activation, promise, NOTIFICATION_VISIBILITY_MESSAGE)
          return
        }
        if (!UsbAudioBridge.isConnected() || !RecordingService.isAutomaticArmed() || !hasMicrophone(owner) ||
          !listenerConnected || !hasNotificationAccess(owner)) {
          activationFailed(owner, activation, promise, AppText.choose("המוכנות להקלטה אוטומטית הופסקה. הפעל אותה שוב מתוך האפליקציה.", "Automatic recording readiness stopped. Arm it again from the app."))
          return
        }
        val now = SystemClock.elapsedRealtime()
        val audio = UsbAudioBridge.callAudioSnapshot()
        if (audio != null && audio.known && now - audio.receivedAtMs in 0..AutoCallPolicy.MAX_SAMPLE_AGE_MS) {
          // A known idle NORMAL/UID0 observation proves transport/parser support without capturing PCM.
          lastObservedAudio = audio.asPolicyObservation()
          evidenceWatchdog.reset()
          recoveringEvidence = false
          lastTransitionReason = "armed"
          modeEvidenceFailed = false
          enabled = true
          monitoringReady = true
          restartActivation = null
          owner.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(ENABLED, true).apply()
          RestartReminderController.clear(owner)
          main.removeCallbacks(tick)
          main.post(tick)
          promise.resolve(statusMap(owner))
        } else if (now >= deadline) {
          modeEvidenceFailed = true
          activationFailed(owner, activation, promise,
            AppText.choose("לא ניתן לאמת את מצב השיחה במכשיר הזה. ההקלטה האוטומטית לא הופעלה; אפשר להמשיך בהקלטה ידנית.", "Call state cannot be verified on this device. Automatic recording was not armed; manual recording remains available."))
        } else main.postDelayed(this, 100L)
      }
    }
    main.post(check)
  }

  private fun activationFailed(owner: Context, activation: Long, promise: Promise, message: String) {
    if (activation == generation) {
      lastError = message
      pauseArming(owner, if (modeEvidenceFailed) "evidence_timeout" else "activation_failed")
    }
    promise.reject("AUTO_ACTIVATION_FAILED", message)
  }

  /** Preserve the enabled preference after owner loss; foreground activation is still required. */
  private fun pauseArming(owner: Context, reason: String = "activation_failed") {
    ++generation
    restartActivation = null
    desiredMonitoring = false
    monitoringReady = false
    recoveringEvidence = false
    evidenceWatchdog.reset()
    lastTransitionReason = reason
    main.removeCallbacks(tick)
    stopOwnedCapture(owner)
    RecordingService.disarmAutomatic(owner)
    if (!accessibilityMode(owner)) io.execute { runCatching { UsbAudioBridge.setCallMonitoring(false) } }
  }

  private fun stopOwnedCapture(owner: Context) {
    if (accessibilityMode(owner)) {
      if (RecordingService.isAutomaticCapture() || micPolicy.acceptedEpisode() != null) {
        RecordingService.stopAutomaticCapture(owner); micPolicy.onStopAccepted()
      }
      return
    }
    if (RecordingService.isAutomaticCapture() || policy.recordingUid() != null) {
      RecordingService.stopAutomaticCapture(owner)
      policy.onStopAccepted()
    }
  }

  fun onListenerSnapshot(context: Context, connected: Boolean, signals: List<AutoCallPolicy.NotificationSignal>) {
    val owner = initialize(context)
    onMain {
      listenerConnected = connected
      notifications = if (connected) signals.filter { AutoCallPolicy.allowsPackage(it.packageName) && !it.groupSummary }
        .distinctBy { it.key }.toList() else emptyList()
      if (!connected && (monitoringReady || desiredMonitoring || RecordingService.isAutomaticArmed())) {
        lastError = AppText.choose("הגישה להתראות נותקה. חזור לאפליקציה והפעל שוב הקלטה אוטומטית.", "Notification access disconnected. Return to the app and arm automatic recording again.")
        pauseArming(owner, "listener_disconnected")
      } else if (monitoringReady) evaluate(owner)
    }
  }

  private val tick = object : Runnable {
    override fun run() {
      val owner = appContext ?: return
      if (!enabled || !monitoringReady) return
      evaluate(owner)
      if (enabled && monitoringReady) main.postDelayed(this, 500L)
    }
  }

  private fun evaluate(owner: Context) {
    // Recovery is a readiness transaction. Leave call policy untouched until its
    // authenticated helper has survived network/settings cleanup.
    if (NativeWirelessAudioBridge.isOfflineRecoveryRunning()) return
    if (!hasVisibleNotifications(owner, requireRecordingChannel = true)) {
      lastError = NOTIFICATION_VISIBILITY_MESSAGE
      pauseArming(owner, "notification_visibility")
      return
    }
    if (accessibilityMode(owner)) { evaluateAccessibility(owner); return }
    val prerequisiteFailure = when {
      !hasNotificationAccess(owner) -> "notification_access"
      !listenerConnected -> "listener_disconnected"
      !UsbAudioBridge.isTransportOpen() -> "transport_closed"
      !RecordingService.isAutomaticArmed() -> "recording_owner"
      !hasMicrophone(owner) -> "microphone_permission"
      else -> null
    }
    if (prerequisiteFailure != null) {
      lastError = AppText.choose("המוכנות להקלטה אוטומטית הופסקה. פתח את האפליקציה והפעל אותה מחדש.", "Automatic recording readiness stopped. Open the app and arm it again.")
      pauseArming(owner, prerequisiteFailure)
      return
    }
    val audio = UsbAudioBridge.callAudioSnapshot()?.asPolicyObservation()
    val now = SystemClock.elapsedRealtime()
    val attribution = policy.resolveAttribution(now, notifications, audio)
    if (audio != null) lastObservedAudio = audio
    val evidenceFresh = UsbAudioBridge.isConnected() && audio != null && audio.known &&
      now - audio.receivedAtMs in 0..AutoCallPolicy.MAX_SAMPLE_AGE_MS
    val recovery = evidenceWatchdog.observe(SystemClock.uptimeMillis(), evidenceFresh)
    recoveringEvidence = recovery == AutoEvidenceRecoveryWatchdog.State.RECOVERING
    if (recoveringEvidence) lastTransitionReason = "evidence_recovering"
    if (recovery == AutoEvidenceRecoveryWatchdog.State.EXPIRED) {
      modeEvidenceFailed = true
      lastError = AppText.choose("אימות מצב השיחה הפסיק לפעול. ההקלטה האוטומטית הושהתה; פתח את האפליקציה ונסה להפעיל שוב.", "Call-state verification stopped working. Automatic recording was paused; open the app and try arming it again.")
      pauseArming(owner, "evidence_timeout")
      return
    }
    val decision = policy.step(now, notifications, audio,
      AutoCallPolicy.Environment(
        armed = true,
        notificationAccess = true,
        listenerConnected = true,
        helperConnected = true,
        busy = RecordingService.isBusyForOwner(),
        automaticCapture = RecordingService.isAutomaticCapture(),
      ))
    when (decision) {
      is AutoCallPolicy.Decision.Start -> {
        if (RecordingService.startAutomaticCapture(owner, decision.uid, notifications)) {
          policy.onStartAccepted(decision.uid)
          lastTransitionReason = "capture_started"
          lastError = null
        } else {
          policy.suppressCurrentCall(decision.uid, delegated = attribution.delegated)
          lastError = AppText.choose("לא ניתן היה להתחיל את ההקלטה. בדוק שהמקליט פנוי ונסה בשיחה הבאה.", "Recording could not start. Check that the recorder is available and try the next call.")
        }
      }
      AutoCallPolicy.Decision.Stop -> stopOwnedCapture(owner)
      AutoCallPolicy.Decision.None -> Unit
    }
    paused = policy.isCurrentCallSuppressed(attribution)
  }

  private fun evaluateAccessibility(owner: Context) {
    val mode = publicAudioMode(owner)
    val ready = AccessibilityMicController.ready(owner) && hasMicrophone(owner) && hasNotificationAccess(owner) &&
      listenerConnected && RecordingService.isAutomaticArmed() && RecordingService.automaticMode() == AccessibilityMicController.MODE && mode != null
    if (!ready) {
      lastError = AppText.choose("הגישה למיקרופון הניסיוני הופסקה. חזור לאפליקציה והפעל שוב הקלטה אוטומטית.", "Experimental microphone access stopped. Return to the app and arm automatic recording again.")
      pauseArming(owner, "accessibility_access_lost"); return
    }
    when (val decision = micPolicy.step(SystemClock.elapsedRealtime(), notifications, mode, true,
      RecordingService.isBusyForOwner(), RecordingService.isAutomaticCapture())) {
      is AccessibilityMicCallPolicy.Decision.Start -> {
        if (RecordingService.startAccessibilityAutomaticCapture(owner)) {
          micPolicy.onStartAccepted(decision.episode); lastTransitionReason = "accessibility_capture_started"; lastError = null
        } else {
          micPolicy.suppress(notifications, mode)
          lastError = AppText.choose("ההקלטה הניסיונית לא התחילה. בדוק את ההרשאות ונסה בשיחה הבאה.", "Experimental recording did not start. Check access and try the next call.")
        }
      }
      AccessibilityMicCallPolicy.Decision.Stop -> stopOwnedCapture(owner)
      AccessibilityMicCallPolicy.Decision.None -> Unit
    }
    paused = micPolicy.isSuppressed()
  }

  fun onManualStop(context: Context) {
    val owner = initialize(context)
    onMain {
      if (accessibilityMode(owner)) {
        micPolicy.suppress(notifications, publicAudioMode(owner)); lastTransitionReason = "manual_stop"
        stopOwnedCapture(owner); paused = micPolicy.isSuppressed(); return@onMain
      }
      val audio = UsbAudioBridge.callAudioSnapshot()?.asPolicyObservation()
      val attribution = policy.resolveAttribution(SystemClock.elapsedRealtime(), notifications, audio)
      policy.suppressCurrentCall(attribution.startEligibleUid, delegated = attribution.delegated)
      lastTransitionReason = "manual_stop"
      stopOwnedCapture(owner)
      paused = policy.isCurrentCallSuppressed(attribution)
    }
  }

  fun onRecorderCompleted(context: Context, failure: Throwable? = null) {
    val owner = initialize(context)
    onMain {
      if (accessibilityMode(owner)) {
        if (failure != null) lastError = AppText.choose("ההקלטה הניסיונית נעצרה. בדוק את ההרשאות לפני השיחה הבאה.", "Experimental recording stopped. Check access before the next call.")
        micPolicy.onCaptureCompleted(failure != null)
        if (enabled && monitoringReady) evaluate(owner)
        return@onMain
      }
      if (policy.acceptedEpisodeUid() != null && failure != null) {
        lastError = AppText.choose("ההקלטה האוטומטית נעצרה. בדוק את רכיב ההקלטה לפני השיחה הבאה.", "Automatic recording stopped. Check the recording component before the next call.")
      }
      policy.onCaptureCompleted(failed = failure != null)
      if (enabled && monitoringReady) evaluate(owner)
    }
  }

  fun onAccessibilityDisconnected(context: Context) {
    val owner = initialize(context)
    onMain { if (accessibilityMode(owner)) {
      if (monitoringReady || desiredMonitoring || RecordingService.isAutomaticArmed()) pauseArming(owner, "accessibility_disconnected")
      lastError = AppText.choose("שירות הנגישות נותק. אשר אותו בהגדרות והפעל שוב הקלטה מתוך האפליקציה.", "Accessibility service disconnected. Enable it in Settings and activate recording again from the app.")
    } }
  }

  fun onSystemOwnerStopping(context: Context) { if (!accessibilityMode(context)) onOwnerStopping(context) }

  fun onOwnerStopping(context: Context) {
    val owner = initialize(context)
    onMain {
      pauseArming(owner, "owner_stopped")
      paused = false
      if (enabled) lastError = AppText.choose("רכיב ההקלטה כובה. פתח את האפליקציה והפעל שוב הקלטה אוטומטית.", "The recording component was turned off. Open the app and arm automatic recording again.")
    }
  }

  /** Only the system-protected service dump calls this; no notification content or identifiers. */
  fun writeDiagnostics(writer: PrintWriter) {
    val lines: List<String>
    if (Looper.myLooper() == Looper.getMainLooper()) lines = diagnosticLines()
    else {
      val result = AtomicReference<List<String>>()
      val ready = CountDownLatch(1)
      main.post { try { result.set(diagnosticLines()) } finally { ready.countDown() } }
      val completed = try { ready.await(2, TimeUnit.SECONDS) } catch (_: InterruptedException) {
        Thread.currentThread().interrupt(); false
      }
      lines = if (completed) result.get() ?: listOf("AUTO_STATE available=false reason=unavailable")
        else listOf("AUTO_STATE available=false reason=main_unavailable")
    }
    writer.println("AUTO_DIAGNOSTICS_V1")
    lines.forEach(writer::println)
  }

  private fun diagnosticLines(): List<String> {
    val now = SystemClock.elapsedRealtime()
    val current = UsbAudioBridge.callAudioSnapshot()?.asPolicyObservation()
    if (current != null) lastObservedAudio = current
    val audio = current ?: lastObservedAudio
    val attribution = policy.resolveAttribution(now, notifications, audio)
    val telecom = audio?.telecom
    val owner = appContext
    val visible = owner?.let { hasVisibleNotifications(it, RecordingService.isAutomaticArmed()) } ?: false
    val access = owner?.let(::hasNotificationAccess) ?: false
    val recordingState = owner?.let { runCatching { RecordingService.status(it).getBoolean("isRecording") }.getOrNull() }
    val state = when {
      !enabled -> "off"
      !visible || !access || !listenerConnected -> "needs_access"
      modeEvidenceFailed -> "error"
      !monitoringReady || !RecordingService.isAutomaticArmed() || !UsbAudioBridge.isTransportOpen() -> "needs_activation"
      RecordingService.isAutomaticCapture() -> "recording"
      recoveringEvidence || paused -> "paused"
      lastError != null -> "error"
      else -> "ready"
    }
    val result = mutableListOf(
      "AUTO_STATE mode=${owner?.let { AccessibilityMicController.mode(it) } ?: "system"} enabled=$enabled armed=${RecordingService.isAutomaticArmed()} monitoringReady=$monitoringReady " +
        "desiredMonitoring=$desiredMonitoring listenerConnected=$listenerConnected helperConnected=${UsbAudioBridge.isConnected()} " +
        "transportOpen=${UsbAudioBridge.isTransportOpen()} notificationsVisible=$visible notificationAccess=$access " +
        "busy=${RecordingService.isBusyForOwner()} isRecording=${recordingState ?: false} " +
        "recordingStateKnown=${recordingState != null} automaticCapture=${RecordingService.isAutomaticCapture()} " +
        "state=$state recovering=$recoveringEvidence error=${lastError != null} reason=$lastTransitionReason " +
        "currentAcceptedUid=${policy.acceptedEpisodeUid() ?: -1} suppressedCurrent=${policy.isCurrentCallSuppressed(attribution)}",
      "AUTO_AUDIO source=${if (current != null) "current" else if (audio != null) "retained" else "none"} " +
        "known=${audio?.known ?: false} mode=${audio?.mode ?: -1} ownerUid=${audio?.ownerUid ?: -1} " +
        "observedAgeMs=${audio?.let { (now - it.receivedAtMs).coerceAtLeast(0L) } ?: -1L}",
      "AUTO_TELECOM known=${telecom?.known ?: false} packageCode=${telecom?.packageCode ?: 0} " +
        "userId=${telecom?.userId ?: -1} liveCalls=${telecom?.liveCalls ?: -1} activeCalls=${telecom?.activeCalls ?: -1} " +
        "foregroundMatched=${telecom?.foregroundMatched ?: false} selfManaged=${telecom?.selfManaged ?: false} " +
        "voip=${telecom?.voip ?: false} observedAgeMs=${telecom?.let { now - it.receivedAtMs } ?: -1L}",
      "AUTO_ATTRIBUTION eligibleUid=${attribution.startEligibleUid ?: -1} currentOwnerUid=${attribution.knownCurrentOwnerUid ?: -1} " +
        "delegated=${attribution.delegated} ended=${attribution.definitiveEnded}",
    )
    notifications.asSequence().filter { AutoCallPolicy.allowsPackage(it.packageName) }
      .sortedByDescending { if (AutoCallPolicy.isOngoingCall(it)) 2 else if (it.category == "call" || it.callType in 1..3) 1 else 0 }
      .take(8).forEach { signal ->
      val category = when (signal.category) { null -> "null"; "call" -> "call"; else -> "other" }
      result.add("AUTO_NOTIFICATION package=${signal.packageName} uid=${signal.uid} category=$category " +
        "ongoing=${signal.ongoing} callType=${signal.callType} hasAnswer=${signal.hasAnswer} hasHangup=${signal.hasHangup} " +
        "chrono=${signal.showChronometer} countdown=${signal.chronometerCountDown} " +
        "actionCount=${signal.actionCount.coerceIn(0, 16)} hasFullScreenIntent=${signal.hasFullScreenIntent} " +
        "eligible=${AutoCallPolicy.isOngoingCall(signal)}")
    }
    return result
  }
}
