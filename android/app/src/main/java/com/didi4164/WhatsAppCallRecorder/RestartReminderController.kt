package com.didi4164.WhatsAppCallRecorder

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.SystemClock
import android.os.UserManager
import android.provider.Settings
import java.security.SecureRandom

/** Reminder delivery and private one-use handoff only. None of these methods starts audio or ADB. */
object RestartReminderController {
  private const val PREFS = "restart_reminder"
  private const val CHANNEL = "restart_recording_reminder"
  private const val NOTIFICATION_ID = 4168
  private const val ACTION_RESUME = "com.codaki.wareco.RESTART_RESUME"
  private const val EXTRA_TOKEN = "wa_reco_restart_token"
  private val lock = Any()
  private val pending = RestartResumeGate()

  private fun eligible(context: Context): Boolean =
    context.getSharedPreferences("automatic_recording", Context.MODE_PRIVATE).getBoolean("enabled", false) &&
      context.getSharedPreferences("recording_mode", Context.MODE_PRIVATE).getString("selected", "system") == "system"

  private fun bootCount(context: Context): Int = runCatching {
    Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1)
  }.getOrDefault(-1)

  private fun clearToken(context: Context): Boolean = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    .edit().clear().commit()

  fun clear(context: Context) = synchronized(lock) {
    pending.clear()
    runCatching { clearToken(context) }
    runCatching { context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID) }
  }

  fun onBoot(context: Context) = synchronized(lock) {
    val app = context.applicationContext
    clear(app) // An earlier boot/tap never survives issuance of a new reminder.
    // The app still installs on API24. Do not link newer notification APIs before this gate.
    if (Build.VERSION.SDK_INT < 34 || !eligible(app) ||
        app.getSystemService(UserManager::class.java)?.isUserUnlocked != true) return@synchronized
    try {
      val manager = app.getSystemService(NotificationManager::class.java)
      manager.createNotificationChannel(NotificationChannel(CHANNEL,
        AppText.choose("תזכורת אחרי הפעלה מחדש", "Restart reminder"), NotificationManager.IMPORTANCE_HIGH))
      val channel = manager.getNotificationChannel(CHANNEL)
      val groupBlocked = Build.VERSION.SDK_INT >= 28 &&
        channel?.group?.let { manager.getNotificationChannelGroup(it)?.isBlocked } == true
      val unlocked = app.getSystemService(UserManager::class.java)?.isUserUnlocked == true
      val permission = Build.VERSION.SDK_INT < 33 ||
        app.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
      if (!RestartReminderPolicy.shouldNotify(Build.VERSION.SDK_INT, unlocked, eligible(app),
          app.getSharedPreferences("recording_mode", Context.MODE_PRIVATE).getString("selected", "system") == "system",
          manager.areNotificationsEnabled(), permission,
          channel != null && channel.importance != NotificationManager.IMPORTANCE_NONE && !groupBlocked)) return@synchronized
      val boot = bootCount(app)
      if (boot < 0) return@synchronized
      val token = ByteArray(32).also { SecureRandom().nextBytes(it) }
        .joinToString("") { "%02x".format(it.toInt() and 255) }
      val saved = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putString("token", token).putLong("issuedElapsedMs", SystemClock.elapsedRealtime())
        .putInt("bootCount", boot).commit()
      if (!saved) return@synchronized
      val intent = Intent(app, MainActivity::class.java).setAction(ACTION_RESUME)
        .setPackage(app.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        .putExtra(EXTRA_TOKEN, token)
      val action = PendingIntent.getActivity(app, NOTIFICATION_ID, intent,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_ONE_SHOT)
      val title = AppText.choose("חידוש הקלטה אוטומטית", "Resume automatic recording")
      val text = AppText.choose("הטלפון הופעל מחדש. פתחו את wa-reco כדי לחדש את ההפעלה.",
        "Your phone restarted. Open wa-reco to resume activation.")
      val publicVersion = Notification.Builder(app, CHANNEL).setSmallIcon(R.mipmap.ic_launcher)
        .setContentTitle("wa-reco").setContentText(AppText.choose("פתחו את האפליקציה", "Open the app")).build()
      val notification = Notification.Builder(app, CHANNEL).setSmallIcon(R.mipmap.ic_launcher)
        .setContentTitle(title).setContentText(text).setStyle(Notification.BigTextStyle().bigText(text))
        .setContentIntent(action).addAction(Notification.Action.Builder(null, title, action).build())
        .setAutoCancel(true).setOnlyAlertOnce(true).setVisibility(Notification.VISIBILITY_PRIVATE)
        .setPublicVersion(publicVersion).build()
      manager.notify(NOTIFICATION_ID, notification)
    } catch (_: Exception) { clear(app) }
  }

  /** Exported Activity extras are untrusted; remove them even if validation fails. */
  fun receive(activity: Activity, intent: Intent?) = synchronized(lock) {
    val requested = intent?.action == ACTION_RESUME
    val token = runCatching { intent?.getStringExtra(EXTRA_TOKEN) }.getOrNull()
    intent?.removeExtra(EXTRA_TOKEN)
    if (!requested) { pending.clearFor(activity); return@synchronized }
    intent?.action = null // singleTask/task restoration must not replay this request.
    val app = activity.applicationContext
    val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (!eligible(app) || !RestartReminderPolicy.acceptsToken(prefs.getString("token", null), token,
        prefs.getLong("issuedElapsedMs", -1), prefs.getInt("bootCount", -1), bootCount(app),
        SystemClock.elapsedRealtime())) return@synchronized
    // Commit removal before exposing a process-local request. A failed write authorizes nothing.
    if (!clearToken(app)) return@synchronized
    pending.queue(activity, SystemClock.elapsedRealtime())
    runCatching { app.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID) }
  }

  fun consume(activity: Activity?, resumed: Boolean): Boolean = synchronized(lock) {
    if (activity == null) return@synchronized false
    pending.consume(activity, SystemClock.elapsedRealtime(), eligible(activity.applicationContext),
      resumed && !activity.isFinishing && !activity.isDestroyed && activity.hasWindowFocus())
  }

  fun beginArming(activity: Activity, foreground: Boolean): Long = synchronized(lock) {
    pending.beginArming(activity, SystemClock.elapsedRealtime(), eligible(activity.applicationContext), foreground)
  }

  fun permitsArming(activity: Activity, generation: Long, foreground: Boolean): Boolean = synchronized(lock) {
    pending.permitsArming(activity, generation, SystemClock.elapsedRealtime(), eligible(activity.applicationContext), foreground)
  }

  fun onActivityLeft(activity: Activity) = synchronized(lock) {
    if (pending.clearFor(activity)) AutoRecordingController.cancelRestartArming(activity.applicationContext)
  }

  fun onActivityFocusLost(activity: Activity) = synchronized(lock) {
    // Initial notification delivery may precede first window focus. Only an accepted tap is sticky-revoked.
    if (pending.revokeConsumedFor(activity)) AutoRecordingController.cancelRestartArming(activity.applicationContext)
  }

  fun cancelResume(context: Context) = synchronized(lock) {
    pending.clear()
    AutoRecordingController.cancelRestartArming(context.applicationContext)
  }
}
