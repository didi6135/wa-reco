package com.didi4164.WhatsAppCallRecorder

import android.accessibilityservice.AccessibilityServiceInfo
import android.content.ComponentName
import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.view.accessibility.AccessibilityManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap

/** Status and explicit mode selection only. Reading status never starts any service or audio. */
object AccessibilityMicController {
  const val SYSTEM = "system"
  const val MODE = "accessibilityMic"
  private const val PREFS = "recording_mode"
  fun supported(): Boolean = Build.VERSION.SDK_INT >= 29
  fun mode(context: Context): String = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    .getString("selected", SYSTEM).let { if (it == MODE) MODE else SYSTEM }
  fun saveMode(context: Context, mode: String): Boolean = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    .edit().putString("selected", mode).commit()
  fun enabled(context: Context): Boolean = runCatching {
    val own = ComponentName(context, AccessibilityMicService::class.java)
    val manager = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
    manager.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK).any {
      val service = it.resolveInfo.serviceInfo
      ComponentName(service.packageName, service.name) == own
    }
  }.getOrDefault(false)
  fun ready(context: Context): Boolean = supported() && mode(context) == MODE && enabled(context) && AccessibilityMicService.isConnected()
  fun route(context: Context): String = runCatching {
    val manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    if (Build.VERSION.SDK_INT >= 31) AccessibilityMicRoute.output(manager.communicationDevice?.type ?: 0)
    else if (manager.isBluetoothScoOn) "headset" else if (manager.isSpeakerphoneOn) "speaker" else "unknown"
  }.getOrDefault("unknown")
  fun inputRoute(device: AudioDeviceInfo?): String = AccessibilityMicRoute.input(device?.type ?: 0)
  fun status(context: Context): WritableMap = Arguments.createMap().apply {
    putBoolean("supported", supported()); putBoolean("automaticSupported", supported())
    putBoolean("appInfoRecoverySupported", AccessibilityMicCapturePolicy.appInfoRecoverySupported(Build.VERSION.SDK_INT))
    putBoolean("enabled", enabled(context)); putBoolean("connected", AccessibilityMicService.isConnected())
    putBoolean("selected", mode(context) == MODE); putBoolean("experimental", true)
    putString("source", "voice_recognition")
    val route = route(context); putString("route", route); putBoolean("routeKnown", route != "unknown")
  }
}
