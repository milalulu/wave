package com.wave.desktop

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Срабатывание будильника: будим MainActivity с media_action alarm:<id>. */
class AlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra(EXTRA_ALARM_ID) ?: return
    val main = Intent(context, MainActivity::class.java).apply {
      putExtra("media_action", "alarm:$id")
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
    }
    try {
      context.startActivity(main)
    } catch (_: Exception) {
    }
  }

  companion object {
    const val EXTRA_ALARM_ID = "alarm_id"
  }
}
