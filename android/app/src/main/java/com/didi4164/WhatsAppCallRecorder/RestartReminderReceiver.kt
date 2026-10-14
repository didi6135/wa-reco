package com.didi4164.WhatsAppCallRecorder

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Unlocked boot delivery posts an ordinary reminder only; it cannot start a recorder or service. */
class RestartReminderReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == Intent.ACTION_BOOT_COMPLETED) RestartReminderController.onBoot(context)
  }
}
