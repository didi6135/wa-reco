package com.didi4164.WhatsAppCallRecorder

import android.content.ClipData
import android.content.Intent
import android.os.Build
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.common.LifecycleState
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

class CallRecorderModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context), LifecycleEventListener {
  private val io = Executors.newSingleThreadExecutor()
  private val offlineEntryHandler = android.os.Handler(android.os.Looper.getMainLooper())
  private val offlineEntryGeneration = AtomicLong()
  @Volatile private var offlineEntryGate: OfflineRecoveryEntryGate? = null
  @Volatile private var offlineEntryInvalidated = false
  init { context.addLifecycleEventListener(this) }
  override fun onHostResume() = Unit
  private fun cancelOfflineEntry() {
    offlineEntryGeneration.incrementAndGet()
    val waiting = offlineEntryGate
    offlineEntryGate = null
    offlineEntryHandler.post { waiting?.cancel() }
  }
  override fun onHostPause() { cancelOfflineEntry(); NativeWirelessAudioBridge.cancelOfflineRecovery() }
  override fun onHostDestroy() { cancelOfflineEntry(); NativeWirelessAudioBridge.cancelOfflineRecovery() }
  override fun invalidate() {
    offlineEntryInvalidated = true
    cancelOfflineEntry()
    NativeWirelessAudioBridge.cancelOfflineRecovery()
    context.removeLifecycleEventListener(this)
    super.invalidate()
  }
  private fun offlineForegroundAction(promise: Promise, foregroundFailureCode: String = "OFFLINE_FOREGROUND_REQUIRED", action: (foreground: () -> Boolean) -> Unit) {
    val activity = currentActivity
    // Capture the lifecycle token before posting to main: pause/resume must not resurrect this request.
    val generation = offlineEntryGeneration.incrementAndGet()
    if (activity == null || offlineEntryInvalidated || context.lifecycleState != LifecycleState.RESUMED) {
      promise.reject(foregroundFailureCode, foregroundFailureCode); return
    }
    activity.runOnUiThread {
      if (offlineEntryGeneration.get() != generation || offlineEntryInvalidated || context.lifecycleState != LifecycleState.RESUMED) {
        promise.reject(foregroundFailureCode, foregroundFailureCode); return@runOnUiThread
      }
      val foreground = {
        OfflineRecoveryEntryGate.permitsAction(OfflineRecoveryEntryGate.State(
          !offlineEntryInvalidated && currentActivity === activity && !activity.isFinishing && !activity.isDestroyed,
          context.lifecycleState == LifecycleState.RESUMED,
          activity.hasWindowFocus(),
          offlineEntryGeneration.get() == generation,
        ))
      }
      offlineEntryGate?.cancel()
      lateinit var gate: OfflineRecoveryEntryGate
      gate = OfflineRecoveryEntryGate(object : OfflineRecoveryEntryGate.Scheduler {
        override fun now(): Long = android.os.SystemClock.elapsedRealtime()
        override fun post(task: Runnable, delayMs: Long) { offlineEntryHandler.postDelayed(task, delayMs) }
      }, {
        OfflineRecoveryEntryGate.State(
          !offlineEntryInvalidated && currentActivity === activity && !activity.isFinishing && !activity.isDestroyed,
          context.lifecycleState == LifecycleState.RESUMED,
          activity.hasWindowFocus(),
          offlineEntryGeneration.get() == generation && offlineEntryGate === gate,
        )
      }, {
        if (offlineEntryGate === gate) offlineEntryGate = null
        // The bridge still rechecks this same foreground predicate before privileged work.
        if (foreground()) action(foreground)
        else promise.reject(foregroundFailureCode, foregroundFailureCode)
      }, { code ->
        if (offlineEntryGate === gate) offlineEntryGate = null
        val mapped = if (code == "OFFLINE_FOREGROUND_REQUIRED") foregroundFailureCode else code
        promise.reject(mapped, mapped)
      })
      offlineEntryGate = gate
      gate.start()
    }
  }
  override fun getName(): String = "CallRecorder"
  @ReactMethod fun getStatus(promise: Promise) { promise.resolve(RecordingService.status(context)) }
  @ReactMethod fun getAutoRecordingStatus(promise: Promise) { promise.resolve(AutoRecordingController.statusMap(context)) }
  @ReactMethod fun consumeRestartResumeRequest(promise: Promise) {
    val activity = currentActivity
    if (activity == null) { promise.resolve(false); return }
    activity.runOnUiThread {
      promise.resolve(RestartReminderController.consume(activity,
        !offlineEntryInvalidated && currentActivity === activity && context.lifecycleState == LifecycleState.RESUMED))
    }
  }
  @ReactMethod fun resumeAutoRecordingAfterRestart(promise: Promise) {
    offlineForegroundAction(promise, "FOREGROUND_REQUIRED") { foreground ->
      val activity = currentActivity
      if (activity == null) { promise.reject("RESTART_RESUME_UNAVAILABLE", "RESTART_RESUME_UNAVAILABLE"); return@offlineForegroundAction }
      val authorization = RestartReminderController.beginArming(activity, foreground())
      if (authorization < 0) { promise.reject("RESTART_RESUME_UNAVAILABLE", "RESTART_RESUME_UNAVAILABLE"); return@offlineForegroundAction }
      val allowed = {
        RestartReminderController.permitsArming(activity, authorization, foreground()) &&
          !RecordingService.isBusy() && !NativeWirelessAudioBridge.isOfflineRecoveryRunning() &&
          !RecorderReadinessService.isStopping() && !AutoRecordingController.hasObservedCall() &&
          runCatching { (context.getSystemService(android.content.Context.AUDIO_SERVICE) as android.media.AudioManager).mode == 0 }.getOrDefault(false)
      }
      if (RecordingService.isArming() || !allowed()) {
        RestartReminderController.cancelResume(context)
        promise.reject("RESTART_RESUME_REVOKED", "RESTART_RESUME_REVOKED"); return@offlineForegroundAction
      }
      AutoRecordingController.setEnabled(context, true, promise, allowed)
    }
  }
  @ReactMethod fun getAccessibilityMicStatus(promise: Promise) { promise.resolve(AccessibilityMicController.status(context)) }
  @ReactMethod fun setRecordingMode(mode: String, promise: Promise) {
    offlineForegroundAction(promise, "FOREGROUND_REQUIRED") { foreground ->
      val audioMode = runCatching { (context.getSystemService(android.content.Context.AUDIO_SERVICE) as android.media.AudioManager).mode }.getOrDefault(2)
      val code = AccessibilityMicCapturePolicy.modeMutationRejection(mode, Build.VERSION.SDK_INT, foreground(),
        RecordingService.isBusy(), RecordingService.isArming(), NativeWirelessAudioBridge.statusMap(context).getBoolean("connecting"),
        if (AutoRecordingController.hasObservedCall()) 2 else audioMode)
      if (code != null) { promise.reject(code, code); return@offlineForegroundAction }
      if (AccessibilityMicController.mode(context) != mode) {
        AutoRecordingController.disableForModeChange(context)
        if (!AccessibilityMicController.saveMode(context, mode)) { promise.reject("RECORDING_MODE_SAVE_FAILED", "RECORDING_MODE_SAVE_FAILED"); return@offlineForegroundAction }
      }
      promise.resolve(AccessibilityMicController.status(context))
    }
  }
  @ReactMethod fun openAccessibilityMicSetup(promise: Promise) {
    offlineForegroundAction(promise, "FOREGROUND_REQUIRED") { foreground ->
      if (!foreground()) { promise.reject("FOREGROUND_REQUIRED", "FOREGROUND_REQUIRED"); return@offlineForegroundAction }
      try {
        currentActivity!!.startActivity(Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS))
        promise.resolve(null)
      } catch (_: Exception) { promise.reject("ACCESSIBILITY_SETUP_FAILED", "ACCESSIBILITY_SETUP_FAILED") }
    }
  }
  @ReactMethod fun openAccessibilityMicAppInfo(promise: Promise) {
    offlineForegroundAction(promise, "FOREGROUND_REQUIRED") { foreground ->
      val audioMode = runCatching { (context.getSystemService(android.content.Context.AUDIO_SERVICE) as android.media.AudioManager).mode }.getOrDefault(-1)
      val code = AccessibilityMicCapturePolicy.appInfoRecoveryRejection(Build.VERSION.SDK_INT,
        AccessibilityMicController.mode(context) == AccessibilityMicController.MODE, foreground(),
        RecordingService.isBusy(), RecordingService.isArming(),
        NativeWirelessAudioBridge.isOfflineRecoveryRunning() || NativeWirelessAudioBridge.statusMap(context).getBoolean("connecting"),
        audioMode, AutoRecordingController.hasObservedCall())
      if (code != null) { promise.reject(code, code); return@offlineForegroundAction }
      if (!foreground()) { promise.reject("FOREGROUND_REQUIRED", "FOREGROUND_REQUIRED"); return@offlineForegroundAction }
      try {
        // Public own-app details only. Android and the user retain all restriction/permission decisions.
        currentActivity!!.startActivity(Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
          android.net.Uri.fromParts("package", context.packageName, null)))
        promise.resolve(null)
      } catch (_: Exception) { promise.reject("ACCESSIBILITY_APP_INFO_FAILED", "ACCESSIBILITY_APP_INFO_FAILED") }
    }
  }
  @ReactMethod fun getCallNameStatus(promise: Promise) {
    promise.resolve(Arguments.createMap().apply { putBoolean("enabled", CallNamePreferences.isEnabled(context)) })
  }
  @ReactMethod fun setCallNameEnabled(enabled: Boolean, promise: Promise) {
    val activity = currentActivity
    if (activity == null) {
      promise.reject("FOREGROUND_REQUIRED", AppText.choose("פתח את האפליקציה כדי לשנות שמות הקלטות.", "Open the app to change recording names.")); return
    }
    activity.runOnUiThread {
      val code = CallNameMutationPolicy.rejection(currentActivity === activity && !activity.isFinishing && !activity.isDestroyed,
        context.lifecycleState == LifecycleState.RESUMED, activity.hasWindowFocus(), RecordingService.isBusy())
      if (code != null) {
        promise.reject(code, if (code == "RECORDING_BUSY")
          AppText.choose("סיים את ההקלטה לפני שינוי שמות הקלטות.", "Finish the recording before changing recording names.") else
          AppText.choose("שנה שמות הקלטות כשהאפליקציה פתוחה על המסך.", "Change recording names while the app is on screen."))
        return@runOnUiThread
      }
      if (!CallNamePreferences.setEnabled(context, enabled)) {
        promise.reject("SETTINGS_SAVE_FAILED", AppText.choose("לא ניתן לשמור את הגדרת שמות ההקלטות.", "The recording name setting could not be saved.")); return@runOnUiThread
      }
      getCallNameStatus(promise)
    }
  }
  @ReactMethod fun setAutoRecordingEnabled(enabled: Boolean, promise: Promise) {
    if (!enabled) {
      android.os.Handler(android.os.Looper.getMainLooper()).post { AutoRecordingController.setEnabled(context, false, promise) }
      return
    }
    if (AccessibilityMicController.mode(context) == AccessibilityMicController.MODE) {
      offlineForegroundAction(promise, "FOREGROUND_REQUIRED") { foreground ->
        if (!foreground()) promise.reject("FOREGROUND_REQUIRED", "FOREGROUND_REQUIRED")
        else AutoRecordingController.setEnabled(context, true, promise)
      }
      return
    }
    val activity = currentActivity
    if (activity == null || activity.isFinishing) { promise.reject("FOREGROUND_REQUIRED", AppText.choose("פתחו את האפליקציה כדי להפעיל הקלטה אוטומטית.", "Open the app to enable automatic recording.")); return }
    activity.runOnUiThread {
      if (!activity.hasWindowFocus()) { promise.reject("FOREGROUND_REQUIRED", AppText.choose("יש להפעיל הקלטה אוטומטית כשהאפליקציה פתוחה על המסך.", "Enable automatic recording while the app is on screen.")); return@runOnUiThread }
      AutoRecordingController.setEnabled(context, true, promise)
    }
  }
  @ReactMethod fun openNotificationAccessSetup(promise: Promise) {
    val activity = currentActivity
    if (activity == null || activity.isFinishing) { promise.reject("FOREGROUND_REQUIRED", AppText.choose("פתחו את האפליקציה כדי לאפשר זיהוי שיחות.", "Open the app to enable call detection.")); return }
    activity.runOnUiThread {
      try {
        val component = android.content.ComponentName(context, WhatsAppCallNotificationService::class.java)
        try {
          activity.startActivity(Intent(android.provider.Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
            .putExtra(android.provider.Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, component.flattenToString()))
        } catch (_: android.content.ActivityNotFoundException) {
          activity.startActivity(Intent(android.provider.Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }
        promise.resolve(null)
      } catch (failure: Exception) { promise.reject("NOTIFICATION_SETUP_FAILED", AppText.choose("לא ניתן לפתוח את הרשאת זיהוי השיחות.", "Call detection permission could not be opened."), failure) }
    }
  }
  @ReactMethod fun getSystemAccessStatus(promise: Promise) {
    promise.resolve(NativeWirelessAudioBridge.statusMap(context).apply {
      putMap("pairingSetup", Arguments.makeNativeMap(PairingNotificationController.statusMap()))
      putBoolean("developerOptionsEnabled", runCatching {
        android.provider.Settings.Global.getInt(context.contentResolver,
          android.provider.Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) != 0
      }.getOrDefault(false))
    })
  }
  @ReactMethod fun prepareSystemPairing(promise: Promise) { PairingNotificationController.prepare(context, promise) }
  @ReactMethod fun pairSystemRecorder(pairingPort: Int, pairingCode: String, promise: Promise) {
    PairingNotificationController.cancel(context)
    NativeWirelessAudioBridge.pair(context, pairingPort, pairingCode, promise)
  }
  @ReactMethod fun connectSystemRecorder(connectionPort: Int, promise: Promise) {
    try {
      val pairing = UsbAudioBridge.getPairing()
      NativeWirelessAudioBridge.startHelper(context, connectionPort, pairing.port, pairing.key, pairing.appUid, promise)
    } catch (e: Exception) { promise.reject("SYSTEM_CONNECTION_FAILED", e.message, e) }
  }
  @ReactMethod fun setOfflineRecoveryEnabled(enabled: Boolean, promise: Promise) {
    offlineForegroundAction(promise) { foreground -> NativeWirelessAudioBridge.setOfflineRecoveryEnabled(context, enabled, foreground, promise) }
  }
  @ReactMethod fun connectSystemRecorderOffline(promise: Promise) {
    offlineForegroundAction(promise) { foreground -> NativeWirelessAudioBridge.startHelperOffline(context, foreground, promise) }
  }
  @ReactMethod fun cancelOfflineRecovery(promise: Promise) {
    cancelOfflineEntry()
    RestartReminderController.cancelResume(context)
    NativeWirelessAudioBridge.cancelOfflineRecovery(promise)
  }
  @ReactMethod fun openSystemAccessSetup(destination: String, promise: Promise) {
    val activity = currentActivity
    if (activity == null) { promise.reject("FOREGROUND_REQUIRED", AppText.choose("פתח את האפליקציה כדי להגדיר גישה", "Open the app to configure access")); return }
    activity.runOnUiThread {
      try {
        val intent = when (destination) {
          "about" -> Intent(android.provider.Settings.ACTION_DEVICE_INFO_SETTINGS)
          "developer" -> Intent(android.provider.Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS)
          "wireless" -> Intent("android.settings.WIRELESS_DEBUGGING_SETTINGS")
          "wifi" -> Intent(android.provider.Settings.ACTION_WIFI_SETTINGS)
          else -> throw IllegalArgumentException(AppText.choose("יעד הגדרה לא תקין", "The setup destination is invalid"))
        }
        try { activity.startActivity(intent) }
        catch (unavailable: android.content.ActivityNotFoundException) {
          activity.startActivity(Intent(android.provider.Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS))
        }
        promise.resolve(null)
      } catch (e: Exception) { promise.reject("SETUP_FAILED", e.message, e) }
    }
  }
  @ReactMethod fun startRecording(source: String, promise: Promise) {
    if (source == AccessibilityMicController.MODE) {
      offlineForegroundAction(promise, "FOREGROUND_REQUIRED") { foreground ->
        if (!foreground()) promise.reject("FOREGROUND_REQUIRED", "FOREGROUND_REQUIRED")
        else RecordingService.start(context, source, promise)
      }
      return
    }
    val activity = currentActivity
    if (activity == null || activity.isFinishing) {
      promise.reject("FOREGROUND_REQUIRED", AppText.choose("פתח את האפליקציה כדי להתחיל הקלטה", "Open the app to start recording")); return
    }
    activity.runOnUiThread { RecordingService.start(context, source, promise) }
  }
  @ReactMethod fun stopRecording(promise: Promise) { RecordingService.stop(context, promise) }
  @ReactMethod fun listRecordings(promise: Promise) { io.execute {
    try {
      val result = Arguments.createArray()
      RecordingStore.list(context).forEach { item ->
        result.pushMap(Arguments.createMap().apply {
          putString("id", item.getString("id")); putString("title", item.getString("title"))
          putString("date", item.getString("date")); putDouble("durationMs", item.getLong("durationMs").toDouble())
          putString("filePath", item.getString("filePath")); putDouble("fileSize", item.getLong("fileSize").toDouble())
          putString("status", item.getString("status")); putBoolean("wasSilenced", item.getBoolean("wasSilenced"))
          putString("captureSource", item.optString("captureSource", "microphone"))
          putInt("channels", item.optInt("channels", 1))
          putBoolean("startedAutomatically", item.optBoolean("startedAutomatically", false))
          if (item.optString("captureSource") == AccessibilityMicController.MODE) {
            putBoolean("experimental", true); putString("audioSource", "voice_recognition")
            putBoolean("remoteAudioVerified", false); putBoolean("silencingKnown", item.optBoolean("silencingKnown", false))
            putString("inputRoute", item.optString("inputRoute", "unknown"))
            putString("routeAtStart", item.optString("routeAtStart", "unknown")); putString("routeAtEnd", item.optString("routeAtEnd", "unknown"))
            putBoolean("routeChanged", item.optBoolean("routeChanged", false))
          }
          if (item.has("callDisplayName")) putString("callDisplayName", item.optString("callDisplayName"))
          if (item.has("callPackage")) putString("callPackage", item.optString("callPackage"))
          if (item.has("exportFileName")) putString("exportFileName", item.optString("exportFileName"))
          putDouble("outputSoundMs", item.optLong("outputSoundMs", 0L).toDouble())
          putDouble("microphoneSoundMs", item.optLong("microphoneSoundMs", 0L).toDouble())
        })
      }
      promise.resolve(result)
    } catch (e: Exception) { promise.reject("LOAD_FAILED", e.message, e) }
  } }
  @ReactMethod fun deleteRecording(id: String, promise: Promise) { io.execute {
    try { RecordingStore.delete(context, id); promise.resolve(null) }
    catch (e: Exception) { promise.reject("DELETE_FAILED", e.message, e) }
  } }
  @ReactMethod fun shareRecording(id: String, promise: Promise) {
    val activity = currentActivity
    if (activity == null) { promise.reject("FOREGROUND_REQUIRED", AppText.choose("פתח את האפליקציה כדי לשתף", "Open the app to share")); return }
    activity.runOnUiThread {
      try {
        val file = RecordingStore.file(context, id, ".wav")
        check(file.exists()) { AppText.choose("קובץ ההקלטה לא נמצא", "The recording file was not found") }
        val displayName = RecordingStore.exportFileName(context, id) ?: file.name
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.recordings", file, displayName)
        val send = Intent(Intent.ACTION_SEND).setType("audio/wav")
          .putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          .apply { clipData = ClipData.newRawUri(AppText.choose("הקלטת מיקרופון", "Microphone recording"), uri) }
        activity.startActivity(Intent.createChooser(send, AppText.choose("שיתוף הקלטה", "Share recording"))); promise.resolve(null)
      } catch (e: Exception) { promise.reject("SHARE_FAILED", e.message, e) }
    }
  }
  @ReactMethod fun openWhatsApp(promise: Promise) {
    val activity = currentActivity
    if (activity == null) { promise.reject("FOREGROUND_REQUIRED", AppText.choose("פתח את האפליקציה", "Open the app")); return }
    activity.runOnUiThread {
      try {
        val intent = context.packageManager.getLaunchIntentForPackage("com.whatsapp")
          ?: context.packageManager.getLaunchIntentForPackage("com.whatsapp.w4b")
          ?: throw IllegalStateException(AppText.choose("WhatsApp אינו מותקן בפרופיל הזה", "WhatsApp is not installed in this profile"))
        activity.startActivity(intent); promise.resolve(null)
      } catch (e: Exception) { promise.reject("WHATSAPP_UNAVAILABLE", e.message, e) }
    }
  }
  @ReactMethod fun getDeviceInfo(promise: Promise) {
    promise.resolve(Arguments.createMap().apply {
      putString("manufacturer", Build.MANUFACTURER); putString("model", Build.MODEL)
      putString("androidVersion", Build.VERSION.RELEASE); putInt("sdk", Build.VERSION.SDK_INT)
    })
  }
}
