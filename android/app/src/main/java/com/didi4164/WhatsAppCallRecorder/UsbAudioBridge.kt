package com.didi4164.WhatsAppCallRecorder

import android.content.Context
import android.os.SystemClock
import android.util.Log
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import org.json.JSONObject
import com.codaki.usbaudio.CallAttributionFrame

/** Local authenticated ADB-shell transport. Idle connections never capture audio. */
object UsbAudioBridge {
  data class Pairing(val port: Int, val key: ByteArray, val appUid: Int)
  /** receivedAtMs is the producer's elapsedRealtime observation time, never a re-timestamped queued frame. */
  data class TelecomSnapshot(
    val known: Boolean, val packageCode: Int, val userId: Int, val liveCalls: Int,
    val activeCalls: Int, val foregroundMatched: Boolean, val selfManaged: Boolean,
    val voip: Boolean, val receivedAtMs: Long,
  )
  data class CallAudioSnapshot(val mode: Int, val ownerUid: Int, val known: Boolean, val receivedAtMs: Long,
    val telecom: TelecomSnapshot? = null)
  sealed class Frame {
    object Started : Frame()
    object Stopped : Frame()
    data class Pcm(val flags: Int, val bytes: ByteArray) : Frame()
    data class Failure(val message: String) : Frame()
  }

  class Connection internal constructor(private val socket: Socket, private val token: ByteArray) {
    private val output = DataOutputStream(socket.outputStream)
    private val input = DataInputStream(socket.inputStream)
    private val sendLock = Any()
    private val frames = LinkedBlockingQueue<Frame>(64)
    @Volatile private var closed = false
    @Volatile private var handshaken = false
    @Volatile private var lastSeen = SystemClock.elapsedRealtime()
    @Volatile private var capturing = false
    private var stopSent = false
    @Volatile internal var callAudio: CallAudioSnapshot? = null
    @Volatile private var callMonitoring = false
    @Volatile private var callMonitorSince = 0L

    val connected: Boolean get() = handshaken && !closed && SystemClock.elapsedRealtime() - lastSeen < 6000L
    internal val transportOpen: Boolean get() = handshaken && !closed
    internal val authenticatedActivityMs: Long get() = if (handshaken && !closed) lastSeen else 0L
    fun begin() {
      synchronized(sendLock) {
        check(connected && !capturing) { AppText.choose("רכיב ההקלטה אינו זמין. חבר אותו שוב דרך מסך ההגדרות.", "The recording component is unavailable. Reconnect it from Settings.") }
        frames.clear(); capturing = true; stopSent = false
        output.writeUTF("START"); output.flush()
      }
    }
    fun requestStop() {
      synchronized(sendLock) {
        Log.i("UsbAudioBridge", "Stop requested closed=$closed capturing=$capturing sent=$stopSent")
        if (closed || !capturing || stopSent) return
        output.writeUTF("STOP"); output.flush()
        stopSent = true
        Log.i("UsbAudioBridge", "STOP command sent")
      }
    }
    fun next(timeoutMs: Long = 1000L): Frame? = frames.poll(timeoutMs, TimeUnit.MILLISECONDS)
    fun setCallMonitoring(enabled: Boolean) {
      synchronized(sendLock) {
        check(connected) { AppText.choose("רכיב ההקלטה אינו מחובר.", "The recording component is disconnected.") }
        callAudio = null
        callMonitorSince = SystemClock.elapsedRealtime()
        callMonitoring = enabled
        output.writeUTF(if (enabled) "MONITOR_CALLS_ON" else "MONITOR_CALLS_OFF")
        output.flush()
      }
    }
    fun end() { capturing = false }
    fun disconnect() {
      closed = true; capturing = false; callAudio = null; callMonitoring = false
      try { socket.close() } catch (_: IOException) { }
    }
    private fun enqueue(frame: Frame) {
      if (!frames.offer(frame)) {
        frames.clear(); frames.offer(Frame.Failure(AppText.choose("זרם ה־USB התמלא; ההקלטה הופסקה כדי למנוע אובדן אודיו", "The USB audio buffer filled; recording stopped to prevent audio loss")))
        disconnect()
      }
    }
    internal fun receive() {
      try {
        socket.soTimeout = 6000
        check(input.readUTF() == "WA_USB_2") { AppText.choose("גרסת רכיב ה־USB אינה תואמת", "The USB recording component version does not match") }
        val clientNonce = input.readUTF()
        check(clientNonce.matches(Regex("[0-9a-f]{64}"))) { AppText.choose("אימות USB נכשל", "USB authentication failed") }
        val serverNonce = randomHex()
        output.writeUTF(serverNonce)
        output.writeUTF(hmac(token, "SERVER|$clientNonce|$serverNonce")); output.flush()
        check(MessageDigest.isEqual(input.readUTF().toByteArray(Charsets.UTF_8),
          hmac(token, "CLIENT|$clientNonce|$serverNonce").toByteArray(Charsets.UTF_8))) { AppText.choose("אימות USB נכשל", "USB authentication failed") }
        val accepted = synchronized(lock) {
          if (current?.connected == true) false
          else { current?.disconnect(); current = this; handshaken = true; true }
        }
        check(accepted) { AppText.choose("רכיב USB כבר מחובר", "A USB component is already connected") }
        lastSeen = SystemClock.elapsedRealtime()
        while (!closed) {
          val type = input.readUnsignedByte()
          lastSeen = SystemClock.elapsedRealtime()
          when (type) {
            0 -> Unit
            1 -> {
              val flags = input.readUnsignedByte()
              val size = input.readInt()
              check(size in 4..16384 && size % 4 == 0) { AppText.choose("מסגרת אודיו לא תקינה", "The audio frame is invalid") }
              val pcm = ByteArray(size); input.readFully(pcm)
              if (capturing) enqueue(Frame.Pcm(flags, pcm))
            }
            2 -> enqueue(Frame.Started)
            3 -> enqueue(Frame.Stopped)
            4 -> enqueue(Frame.Failure(input.readUTF()))
            5 -> {
              val mode = input.readInt()
              val ownerUid = input.readInt()
              val known = input.readBoolean()
              val observedAtMs = input.readLong()
              check(mode in -1..6 && ownerUid >= -1) { AppText.choose("נתוני מצב שיחה לא תקינים", "Call-state data is invalid") }
              check(observedAtMs >= 0L && observedAtMs <= SystemClock.elapsedRealtime() + 1000L) { AppText.choose("זמן מצב השיחה אינו תקין", "The call-state timestamp is invalid") }
              // Metadata stays separate from PCM so idle monitoring cannot fill the audio queue.
              if (callMonitoring && observedAtMs >= callMonitorSince) callAudio = CallAudioSnapshot(mode, ownerUid, known, observedAtMs)
            }
            6 -> {
              // Additive payload: old frame5 remains exact-UID only. Neither queued source
              // is re-timestamped, and monitoring generations discard prior observations.
              val envelope = CallAttributionFrame.read(input, SystemClock.elapsedRealtime())
              val proof = envelope.telecom
              if (callMonitoring && envelope.observedAtMs >= callMonitorSince &&
                (proof == null || proof.observedAtMs >= callMonitorSince)) {
                callAudio = CallAudioSnapshot(envelope.mode, envelope.ownerUid, envelope.known,
                  envelope.observedAtMs, proof?.let { TelecomSnapshot(it.known, it.packageCode,
                    it.userId, it.liveCalls, it.activeCalls, it.foregroundMatched, it.selfManaged,
                    it.voip, it.observedAtMs) })
              }
            }
            else -> throw IOException(AppText.choose("מסגרת USB לא מוכרת", "The USB frame is unknown"))
          }
        }
      } catch (e: Exception) {
        enqueue(Frame.Failure("חיבור ההקלטה נותק: ${e.message ?: "שגיאת תקשורת"}"))
      } finally {
        disconnect()
        synchronized(lock) { if (current === this) current = null }
      }
    }
  }

  private val lock = Any()
  @Volatile private var initialized = false
  @Volatile private var current: Connection? = null
  @Volatile private var pairing: Pairing? = null

  fun initialize(context: Context) {
    synchronized(lock) {
      if (initialized) return
      initialized = true
    }
    Thread({
      var server: ServerSocket? = null
      try {
        if (!BuildConfig.DIAGNOSTIC_STANDALONE) {
          val privateFiles = context.filesDir.canonicalFile
          for (name in arrayOf("usb-pairing.pending", "usb-pairing.json")) {
            val staleSeed = java.io.File(privateFiles, name)
            check(staleSeed.parentFile?.canonicalFile == privateFiles) { "USB seed cleanup path is outside app files" }
            check(!staleSeed.exists() || staleSeed.delete()) { "Stale USB seed file could not be removed" }
          }
          Log.i("UsbAudioBridge", "STANDALONE_PAIRING_SEED_MEMORY_ONLY cleanupComplete=true")
        }
        val token = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val listener = ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"))
        server = listener
        if (BuildConfig.DIAGNOSTIC_STANDALONE) {
          val pairingJson = JSONObject().put("protocol", "WA_USB_2").put("appUid", android.os.Process.myUid())
            .put("processId", android.os.Process.myPid())
            .put("port", listener.localPort).put("token", token.joinToString("") { "%02x".format(it.toInt() and 255) })
          val pending = java.io.File(context.filesDir, "usb-pairing.pending")
          pending.writeText(pairingJson.toString())
          check(pending.renameTo(java.io.File(context.filesDir, "usb-pairing.json"))) { "USB pairing file unavailable" }
        }
        // Publish only after standalone cleanup or diagnostic seed persistence succeeds.
        pairing = Pairing(listener.localPort, token, android.os.Process.myUid())
        Log.i("UsbAudioBridge", if (BuildConfig.DIAGNOSTIC_STANDALONE) "Diagnostic helper listener ready" else "Memory-only helper listener ready")
        val slots = java.util.concurrent.Semaphore(4)
        while (true) {
          val socket = listener.accept()
          // Loopback only; mutual HMAC proves possession of app-private USB pairing data.
          if (!slots.tryAcquire()) { socket.close(); continue }
          socket.tcpNoDelay = true
          val connection = Connection(socket, token)
          Thread({ try { connection.receive() } finally { slots.release() } }, "UsbAudioReceiver").start()
        }
      } catch (e: Exception) {
        pairing = null
        try { server?.close() } catch (_: IOException) { }
        initialized = false
        Log.e("UsbAudioBridge", "USB listener failed", e)
      }
    }, "UsbAudioListener").start()
  }
  fun isConnected(): Boolean = current?.connected == true
  /** Native transaction ownership only; never expose the socket or token to JS. */
  internal fun currentConnectionForOwnership(): Connection? = synchronized(lock) {
    current?.takeIf { it.connected }
  }
  /** An old recovery may close its own helper, never a replacement accepted later. */
  internal fun disconnectIfCurrent(expected: Connection) {
    val owned = synchronized(lock) {
      if (current === expected) { current = null; expected } else null
    }
    owned?.disconnect()
  }
  /** Authenticated socket lifetime, independent of a heartbeat delayed by CPU suspension. */
  fun isTransportOpen(): Boolean = current?.transportOpen == true
  fun lastActivityMs(): Long = current?.let { if (it.connected) it.authenticatedActivityMs else 0L } ?: 0L
  fun callAudioSnapshot(): CallAudioSnapshot? = current?.let { if (it.connected) it.callAudio else null }
  /** Caller must use its IO worker; TCP writes must never run on main. */
  fun setCallMonitoring(enabled: Boolean) {
    val connection = current
    if (!enabled && connection?.connected != true) return
    check(connection?.connected == true) { AppText.choose("רכיב ההקלטה אינו מחובר.", "The recording component is disconnected.") }
    connection!!.setCallMonitoring(enabled)
  }
  fun disconnectCurrent() {
    val connection = synchronized(lock) { current.also { current = null } }
    connection?.disconnect()
  }
  fun getPairing(): Pairing = pairing?.let { it.copy(key = it.key.copyOf()) }
    ?: throw IllegalStateException(AppText.choose("רכיב השמע עדיין נטען; נסה שוב בעוד רגע", "The audio component is still loading; try again shortly"))
  private fun randomHex(): String = ByteArray(32).also { SecureRandom().nextBytes(it) }
    .joinToString("") { "%02x".format(it.toInt() and 255) }
  private fun hmac(key: ByteArray, message: String): String = Mac.getInstance("HmacSHA256").run {
    init(SecretKeySpec(key, "HmacSHA256"))
    doFinal(message.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 255) }
  }
  fun beginCapture(): Connection = synchronized(lock) {
    val connection = current ?: throw IllegalStateException(AppText.choose("יש לחבר את רכיב ההקלטה דרך מסך ההגדרות", "Connect the recording component from Settings"))
    connection.begin(); connection
  }
}
