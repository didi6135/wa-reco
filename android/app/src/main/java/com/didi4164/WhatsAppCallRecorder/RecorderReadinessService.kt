package com.didi4164.WhatsAppCallRecorder

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import java.util.concurrent.CompletableFuture
import java.util.concurrent.atomic.AtomicBoolean

/** Keeps only the explicitly activated, authenticated local recorder ready. */
class RecorderReadinessService : Service() {
  private val shutdownStarted = AtomicBoolean(false)
  @Volatile private var destroyed = false
  @Volatile private var shutdownFinished = false
  private var foreground = false
  private var monitor: Thread? = null

  companion object {
    private const val CHANNEL = "recorder_readiness"
    private const val NOTIFICATION_ID = 4166
    private const val ACTION_START = "recorder.READINESS_START"
    private const val ACTION_STOP = "recorder.READINESS_STOP"
    private const val STOP_TIMEOUT_MS = 10000L
    private val lock = Any()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val pendingStarts = mutableListOf<CompletableFuture<Unit>>()
    @Volatile private var activeService: RecorderReadinessService? = null
    @Volatile private var stopping = false

    @JvmStatic fun isStopping(): Boolean = stopping
    @JvmStatic fun refreshAutomaticState() {
      mainHandler.post { activeService?.let { if (it.foreground && !it.shutdownStarted.get() && !it.destroyed) it.showNotification(false) } }
    }

    /** Called on main after foreground user activation and a fresh authenticated heartbeat. */
    @JvmStatic fun start(context: Context): CompletableFuture<Unit> {
      check(Looper.myLooper() == Looper.getMainLooper()) { AppText.choose("יש להפעיל את המקליט מתוך מסך האפליקציה.", "Activate the recorder from the app.") }
      check(!stopping) { AppText.choose("המקליט עדיין נכבה. המתן לסיום הכיבוי.", "The recorder is still shutting down. Wait for it to finish.") }
      check(UsbAudioBridge.isConnected()) { AppText.choose("רכיב ההקלטה אינו מחובר.", "The recording component is disconnected.") }
      val result = CompletableFuture<Unit>()
      val ownerContext = context.applicationContext
      synchronized(lock) { pendingStarts.add(result) }
      try {
        val intent = Intent(ownerContext, RecorderReadinessService::class.java).setAction(ACTION_START)
        if (Build.VERSION.SDK_INT >= 26) ownerContext.startForegroundService(intent)
        else ownerContext.startService(intent)
      } catch (failure: Exception) {
        synchronized(lock) { pendingStarts.remove(result) }
        result.completeExceptionally(failure)
      }
      mainHandler.postDelayed({
        if (!result.isDone) {
          synchronized(lock) { pendingStarts.remove(result) }
          result.completeExceptionally(IllegalStateException(AppText.choose("מצב המוכנות לא הופעל בזמן. חזור למסך האפליקציה ונסה שוב.", "Readiness did not start in time. Return to the app and try again.")))
          // The native activation owner also disconnects the helper on failure.
          activeService?.beginShutdown() ?: ownerContext.stopService(
            Intent(ownerContext, RecorderReadinessService::class.java))
        }
      }, 5000L)
      return result
    }

    private fun settleStarts(failure: Throwable? = null) {
      val requests = synchronized(lock) { pendingStarts.toList().also { pendingStarts.clear() } }
      requests.forEach { if (failure == null) it.complete(Unit) else it.completeExceptionally(failure) }
    }
  }

  override fun onCreate() {
    super.onCreate()
    activeService = this
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> {
        try {
          check(!shutdownStarted.get() && !stopping) { AppText.choose("המקליט עדיין נכבה.", "The recorder is still shutting down.") }
          check(UsbAudioBridge.isConnected()) { AppText.choose("רכיב ההקלטה אינו מחובר.", "The recording component is disconnected.") }
          showNotification(false)
          foreground = true
          check(UsbAudioBridge.isConnected()) { AppText.choose("החיבור לרכיב ההקלטה אבד בזמן ההפעלה.", "The recording component disconnected during activation.") }
          settleStarts()
          if (monitor == null) startMonitor()
        } catch (failure: Exception) {
          settleStarts(failure)
          Log.e("RecorderReadiness", "Readiness promotion failed", failure)
          beginShutdown()
        }
      }
      ACTION_STOP -> beginShutdown()
      else -> {
        settleStarts(IllegalStateException(AppText.choose("מצב המוכנות דורש הפעלה מתוך האפליקציה.", "Activate readiness from the app.")))
        finishService()
      }
    }
    return START_NOT_STICKY
  }

  private fun startMonitor() {
    monitor = Thread({
      val evidenceWatchdog = AutoEvidenceRecoveryWatchdog()
      try {
        while (!destroyed && !shutdownStarted.get()) {
          // An authenticated socket can remain open across CPU suspension while its
          // heartbeat appears old. Give it the same awake recovery window as auto mode.
          val transportOpen = UsbAudioBridge.isTransportOpen()
          val recovery = if (transportOpen) evidenceWatchdog.observe(
            SystemClock.uptimeMillis(), UsbAudioBridge.isConnected())
            else AutoEvidenceRecoveryWatchdog.State.EXPIRED
          if (!transportOpen || recovery == AutoEvidenceRecoveryWatchdog.State.EXPIRED) {
            mainHandler.post { if (!destroyed && !shutdownStarted.get()) beginShutdown() }
            return@Thread
          }
          Thread.sleep(1000L)
        }
      } catch (_: InterruptedException) { }
    }, "RecorderReadinessMonitor").also { it.start() }
  }

  /** Main thread changes state/requests STOP; only the worker waits or closes TCP. */
  private fun beginShutdown() {
    if (!shutdownStarted.compareAndSet(false, true)) return
    stopping = true
    AutoRecordingController.onSystemOwnerStopping(applicationContext)
    RecordingService.disarmSystemAutomatic(applicationContext)
    settleStarts(IllegalStateException(AppText.choose("המקליט נכבה.", "The recorder has shut down.")))
    if (foreground && !destroyed) {
      try { showNotification(true) } catch (failure: Exception) {
        Log.w("RecorderReadiness", "Could not update shutdown notification", failure)
      }
    }
    try { RecordingService.requestOwnerStop(applicationContext) } catch (failure: Exception) {
      Log.w("RecorderReadiness", "Could not request recorder STOP", failure)
    }
    Thread({
      try {
        val deadline = SystemClock.elapsedRealtime() + STOP_TIMEOUT_MS
        while (RecordingService.isBusyForSystemOwner() && SystemClock.elapsedRealtime() < deadline) {
          Thread.sleep(100L)
        }
        if (RecordingService.isBusyForSystemOwner()) Log.w("RecorderReadiness", "Recorder finalization exceeded owner stop deadline")
      } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
      finally {
        try { UsbAudioBridge.disconnectCurrent() } catch (failure: Exception) {
          Log.w("RecorderReadiness", "Could not disconnect local recorder", failure)
        }
        shutdownFinished = true
        mainHandler.post {
          if (destroyed) {
            if (activeService == null || activeService === this) stopping = false
          } else finishService()
        }
      }
    }, "RecorderReadinessStop").start()
  }

  private fun finishService() {
    stopping = true
    if (foreground) {
      stopForeground(STOP_FOREGROUND_REMOVE)
      foreground = false
    }
    stopSelf()
  }

  private fun showNotification(turningOff: Boolean) {
    val readyText = if (RecordingService.isAutomaticArmed()) AppText.choose("אפשר להקליט גם בלי Wi-Fi • הקלטה אוטומטית של שיחות WhatsApp פעילה", "Recording works without Wi-Fi. Automatic WhatsApp recording is armed")
      else AppText.choose("אפשר להקליט גם בלי Wi-Fi • ההקלטה מתחילה רק בלחיצה", "Recording works without Wi-Fi. Recording starts when you press Record")
    val notifications = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) notifications.createNotificationChannel(
      NotificationChannel(CHANNEL, AppText.choose("מוכנות להקלטה", "Recording readiness"), NotificationManager.IMPORTANCE_LOW))
    val stopIntent = PendingIntent.getService(this, 2,
      Intent(this, RecorderReadinessService::class.java).setAction(ACTION_STOP),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val openIntent = PendingIntent.getActivity(this, 2,
      Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
    val notification = builder.setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setContentTitle(if (turningOff) AppText.choose("מכבה את המקליט", "Shutting down the recorder") else AppText.choose("המקליט מוכן להקלטה", "The recorder is ready"))
      .setContentText(if (turningOff) AppText.choose("ממתין לסיום ולשמירת ההקלטה", "Waiting for the recording to finish and save") else readyText)
      .setStyle(Notification.BigTextStyle().bigText(if (turningOff) AppText.choose("ממתין לסיום ולשמירת ההקלטה", "Waiting for the recording to finish and save") else readyText))
      .setCategory(Notification.CATEGORY_SERVICE).setOngoing(true).setOnlyAlertOnce(true)
      .setContentIntent(openIntent)
      .addAction(Notification.Action.Builder(null, AppText.choose("כיבוי המקליט", "Turn off recorder"), stopIntent).build()).build()
    if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    else startForeground(NOTIFICATION_ID, notification)
  }

  override fun onDestroy() {
    destroyed = true
    monitor?.interrupt()
    settleStarts(IllegalStateException(AppText.choose("מצב המוכנות הופסק.", "Recording readiness stopped.")))
    // Unexpected service destruction must first let an active recorder save.
    if (!shutdownStarted.get() && (UsbAudioBridge.isTransportOpen() || RecordingService.isAutomaticArmed() ||
      RecordingService.isBusyForSystemOwner())) beginShutdown()
    if (activeService === this) activeService = null
    if (!shutdownStarted.get() || shutdownFinished) stopping = false
    super.onDestroy()
  }
}
