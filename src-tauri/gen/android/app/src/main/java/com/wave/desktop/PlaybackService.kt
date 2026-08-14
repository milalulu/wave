package com.wave.desktop

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Foreground service, удерживающий приложение в памяти и экран от сна
 * во время воспроизведения. Запускается плагином PlaybackPlugin.
 */
class PlaybackService : Service() {

  private var wakeLock: PowerManager.WakeLock? = null

  override fun onCreate() {
    super.onCreate()
    createChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startInForeground()
    acquireWakeLock()
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    wakeLock?.let {
      if (it.isHeld) it.release()
    }
    wakeLock = null
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun startInForeground() {
    val notification = buildNotification()
    ServiceCompat.startForeground(
      this,
      NOTIFICATION_ID,
      notification,
      ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
    )
  }

  private fun buildNotification(): Notification {
    val contentIntent = PendingIntent.getActivity(
      this,
      0,
      Intent(this, MainActivity::class.java),
      PendingIntent.FLAG_IMMUTABLE,
    )
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle(getString(R.string.app_name))
      .setContentText(getString(R.string.playback_notification))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(contentIntent)
      .build()
  }

  private fun createChannel() {
    val manager = getSystemService(NotificationManager::class.java)
    val channel = NotificationChannel(
      CHANNEL_ID,
      getString(R.string.playback_channel_name),
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      setShowBadge(false)
    }
    manager.createNotificationChannel(channel)
  }

  private fun acquireWakeLock() {
    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
    val lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "wave:playback")
    lock.setReferenceCounted(false)
    lock.acquire()
    wakeLock = lock
  }

  companion object {
    private const val CHANNEL_ID = "wave_playback"
    private const val NOTIFICATION_ID = 1

    fun start(context: Context) {
      ContextCompat.startForegroundService(context, Intent(context, PlaybackService::class.java))
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, PlaybackService::class.java))
    }
  }
}
