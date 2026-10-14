package com.didi4164.WhatsAppCallRecorder

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.wifi.WifiManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.os.UserManager
import android.provider.Settings
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

internal class OfflineRecoveryException(val code: String) : IllegalStateException(code)

/** Attempt-local resources. Neither a hotspot callback nor an enabled setting means recovery succeeded. */
internal class OfflineRecoveryAttempt(
  private val context: Context,
  private val foreground: () -> Boolean,
  private val preparation: Boolean = false,
) {
  val state = OfflineRecoveryState(SystemClock.elapsedRealtime(), if (preparation) 30000L else 60000L)
  private val main = Handler(Looper.getMainLooper())
  private val resourceLock = Any()
  private val hotspot = OfflineRecoveryLease()
  private val transportClosers = mutableListOf<() -> Unit>()
  @Volatile private var cleaned = false
  @Volatile private var cleanupFailure: String? = null
  @Volatile private var closingHotspot = false
  private val settings = OfflineRecoverySettings(object : OfflineRecoverySettings.Store {
    override fun read(): String? = Settings.Global.getString(context.contentResolver, "adb_wifi_enabled")
    override fun write(value: String?): Boolean = Settings.Global.putString(context.contentResolver, "adb_wifi_enabled", value)
  })
  private var nudge: Thread? = null
  @Volatile private var worker: Thread? = null

  private val watchdog = object : Runnable {
    override fun run() {
      if (cleaned) return
      val code = state.rejection(SystemClock.elapsedRealtime()) ?: liveRejection()
      if (code != null) cancel(code)
      else main.postDelayed(this, 100L)
    }
  }

  fun beginWatchdog() { main.post(watchdog) }
  fun attachWorker() { worker = Thread.currentThread(); checkpoint() }
  fun detachWorker() { worker = null; Thread.interrupted() }
  fun remaining(): Long = state.remaining(SystemClock.elapsedRealtime())
  fun checkpoint() {
    val code = state.rejection(SystemClock.elapsedRealtime()) ?: liveRejection()
    if (code != null) throw OfflineRecoveryException(code)
  }
  fun stage(value: String) {
    checkpoint()
    if (!state.transition(value, SystemClock.elapsedRealtime())) throw OfflineRecoveryException(
      state.rejection(SystemClock.elapsedRealtime()) ?: "OFFLINE_CANCELED")
  }
  private fun liveRejection(): String? = when {
    !foreground() -> "OFFLINE_FOREGROUND_REQUIRED"
    restricted(context) -> "OFFLINE_ADMIN_RESTRICTED"
    RecordingService.isBusy() -> "OFFLINE_RECORDING_BUSY"
    !preparation && !secureGranted(context) -> "OFFLINE_PERMISSION_REQUIRED"
    !preparation && !nearbyGranted(context) -> "OFFLINE_NEARBY_PERMISSION_REQUIRED"
    else -> null
  }

  /** Register immediately after acquisition. Cancellation also closes a transport acquired late. */
  fun ownTransport(close: () -> Unit) {
    val once = AtomicBoolean(false)
    val guarded = { if (once.compareAndSet(false, true)) close() else Unit }
    synchronized(resourceLock) {
      transportClosers.add(guarded)
      if (cleaned || state.rejection(SystemClock.elapsedRealtime()) != null) closeAsync(guarded)
    }
  }

  fun cancel(reason: String = "OFFLINE_CANCELED"): String? {
    state.cancel(reason)
    val result = cleanup()
    worker?.takeIf { it !== Thread.currentThread() }?.interrupt()
    val owned = synchronized(resourceLock) { transportClosers.toList() }
    owned.forEach { closeAsync(it) }
    return result
  }

  private fun closeAsync(close: () -> Unit) {
    // ADB manager serializes connect/disconnect; never block Android's UI thread on that lock.
    Thread({ runCatching { close() } }, "OfflineRecorderTransportClose").apply { isDaemon = true; start() }
  }

  fun startHotspot() {
    stage("hotspot")
    val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
      ?: throw OfflineRecoveryException("OFFLINE_HOTSPOT_FAILED")
    if (!wifi.isWifiEnabled) throw OfflineRecoveryException("OFFLINE_WIFI_DISABLED")
    synchronized(resourceLock) {
      if (cleaned) throw OfflineRecoveryException("OFFLINE_CANCELED")
      // LOHS can itself change station/debugging state. Snapshot before requesting it.
      settings.capture()
      settings.markNetworkMutation()
    }
    val callbackDone = CountDownLatch(1)
    val outcomeLock = Any()
    var started = false
    var failure: String? = null
    main.post {
      try {
        checkpoint()
        wifi.startLocalOnlyHotspot(object : WifiManager.LocalOnlyHotspotCallback() {
          override fun onStarted(reservation: WifiManager.LocalOnlyHotspotReservation) {
            try {
              // accept() closes late or duplicate deliveries rather than losing their reservations.
              val accepted = hotspot.accept { reservation.close() }
              synchronized(outcomeLock) { started = accepted }
            } catch (_: Exception) {
              synchronized(resourceLock) { cleanupFailure = "OFFLINE_RESTORE_FAILED" }
              synchronized(outcomeLock) { failure = "OFFLINE_RESTORE_FAILED" }
              cancel("OFFLINE_RESTORE_FAILED")
            }
            callbackDone.countDown()
          }
          override fun onFailed(reason: Int) {
            synchronized(outcomeLock) { failure = "OFFLINE_HOTSPOT_FAILED" }
            callbackDone.countDown()
          }
          override fun onStopped() {
            if (!closingHotspot && !cleaned) cancel("OFFLINE_HOTSPOT_FAILED")
            callbackDone.countDown()
          }
        }, main)
      } catch (error: Exception) {
        synchronized(outcomeLock) { failure = (error as? OfflineRecoveryException)?.code ?: "OFFLINE_HOTSPOT_FAILED" }
        callbackDone.countDown()
      }
    }
    val hotspotDeadline = minOf(SystemClock.elapsedRealtime() + 12000L, SystemClock.elapsedRealtime() + remaining())
    while (!callbackDone.await(100L, TimeUnit.MILLISECONDS)) {
      checkpoint()
      if (SystemClock.elapsedRealtime() >= hotspotDeadline) throw OfflineRecoveryException("OFFLINE_HOTSPOT_FAILED")
    }
    checkpoint()
    synchronized(outcomeLock) { if (!started || failure != null) throw OfflineRecoveryException(failure ?: "OFFLINE_HOTSPOT_FAILED") }
  }

  fun startNudge() {
    checkpoint()
    synchronized(resourceLock) { if (cleaned) throw OfflineRecoveryException("OFFLINE_CANCELED") }
    nudge = Thread({
      while (true) {
        try {
          checkpoint()
          synchronized(resourceLock) {
            if (cleaned) return@Thread
            // Serialized with restoration: no delayed write may re-enable debugging after cleanup.
            if (!settings.nudge()) {
              throw OfflineRecoveryException("OFFLINE_PERMISSION_REQUIRED")
            }
          }
          Thread.sleep(60L)
        } catch (_: InterruptedException) { return@Thread }
        catch (failure: Exception) {
          cancel((failure as? OfflineRecoveryException)?.code ?: "OFFLINE_PERMISSION_REQUIRED")
          return@Thread
        }
      }
    }, "OfflineRecorderDebuggingNudge").apply { isDaemon = true; start() }
  }

  /** Once only; restore the exact original value, not an assumed off state. */
  fun cleanup(): String? = synchronized(resourceLock) {
    if (cleaned) return@synchronized cleanupFailure
    state.beginRestore()
    cleaned = true
    main.removeCallbacks(watchdog)
    nudge?.interrupt()
    closingHotspot = true
    try { hotspot.close() } catch (_: Exception) { cleanupFailure = "OFFLINE_RESTORE_FAILED" }
    try { if (!settings.restore()) cleanupFailure = "OFFLINE_RESTORE_FAILED" }
    catch (_: Exception) { cleanupFailure = "OFFLINE_RESTORE_FAILED" }
    if (cleanupFailure == null) state.restored(SystemClock.elapsedRealtime())
    cleanupFailure
  }

  companion object {
    fun secureGranted(context: Context): Boolean = context.checkSelfPermission(Manifest.permission.WRITE_SECURE_SETTINGS) == PackageManager.PERMISSION_GRANTED
    fun nearbyGranted(context: Context): Boolean = context.checkSelfPermission(Manifest.permission.NEARBY_WIFI_DEVICES) == PackageManager.PERMISSION_GRANTED
    fun restricted(context: Context): Boolean = try {
      val user = context.getSystemService(Context.USER_SERVICE) as? UserManager
      user == null || user.hasUserRestriction(UserManager.DISALLOW_DEBUGGING_FEATURES) || user.hasUserRestriction(UserManager.DISALLOW_CONFIG_TETHERING)
    } catch (_: Exception) { true }
  }
}
