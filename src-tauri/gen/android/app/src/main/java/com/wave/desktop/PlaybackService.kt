package com.wave.desktop

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

class PlaybackService : Service() {

  private var wakeLock: PowerManager.WakeLock? = null
  private var mediaSession: MediaSessionCompat? = null

  override fun onCreate() {
    super.onCreate()
    createChannel()
    mediaSession = MediaSessionCompat(this, "WavePlayback").apply {
      isActive = true
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val playing = intent?.getBooleanExtra(EXTRA_PLAYING, false) ?: false
    val title = intent?.getStringExtra(EXTRA_TITLE)
    val artist = intent?.getStringExtra(EXTRA_ARTIST)
    val duration = intent?.getLongExtra(EXTRA_DURATION, 0L) ?: 0L
    val position = intent?.getLongExtra(EXTRA_POSITION, 0L) ?: 0L
    updateMediaSession(playing, title, artist, duration, position)
    startInForeground(playing, title, artist)
    if (playing) acquireWakeLock() else releaseWakeLock()
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    releaseWakeLock()
    mediaSession?.run {
      isActive = false
      release()
    }
    mediaSession = null
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun startInForeground(playing: Boolean, title: String?, artist: String?) {
    val notification = buildNotification(playing, title, artist)
    ServiceCompat.startForeground(
      this,
      NOTIFICATION_ID,
      notification,
      ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
    )
  }

  private fun buildNotification(playing: Boolean, title: String?, artist: String?): Notification {
    val contentIntent = PendingIntent.getActivity(
      this,
      0,
      Intent(this, MainActivity::class.java),
      PendingIntent.FLAG_IMMUTABLE,
    )

    val prevIntent = PendingIntent.getBroadcast(
      this,
      1,
      Intent(ACTION_PREV).setPackage(packageName),
      PendingIntent.FLAG_IMMUTABLE,
    )
    val pauseIntent = PendingIntent.getBroadcast(
      this,
      2,
      Intent(ACTION_PAUSE).setPackage(packageName),
      PendingIntent.FLAG_IMMUTABLE,
    )
    val playIntent = PendingIntent.getBroadcast(
      this,
      3,
      Intent(ACTION_PLAY).setPackage(packageName),
      PendingIntent.FLAG_IMMUTABLE,
    )
    val nextIntent = PendingIntent.getBroadcast(
      this,
      4,
      Intent(ACTION_NEXT).setPackage(packageName),
      PendingIntent.FLAG_IMMUTABLE,
    )

    registerReceiver(mediaButtonReceiver, IntentFilter(ACTION_PREV), RECEIVER_NOT_EXPORTED)
    registerReceiver(mediaButtonReceiver, IntentFilter(ACTION_PAUSE), RECEIVER_NOT_EXPORTED)
    registerReceiver(mediaButtonReceiver, IntentFilter(ACTION_PLAY), RECEIVER_NOT_EXPORTED)
    registerReceiver(mediaButtonReceiver, IntentFilter(ACTION_NEXT), RECEIVER_NOT_EXPORTED)

    val displayTitle = title ?: getString(R.string.app_name)
    val displayArtist = artist ?: getString(R.string.playback_notification)

    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setLargeIcon(BitmapFactory.decodeResource(resources, R.mipmap.ic_launcher))
      .setContentTitle(displayTitle)
      .setContentText(displayArtist)
      .setSubText(getString(R.string.app_name))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(contentIntent)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .addAction(R.mipmap.ic_launcher, getString(R.string.prev), prevIntent)
      .addAction(
        if (playing) R.mipmap.ic_launcher else R.mipmap.ic_launcher,
        if (playing) "Pause" else "Play",
        if (playing) pauseIntent else playIntent,
      )
      .addAction(R.mipmap.ic_launcher, getString(R.string.next), nextIntent)

    val sessionToken = mediaSession?.sessionToken
    if (sessionToken != null) {
      builder.setStyle(
        androidx.media.app.NotificationCompat.MediaStyle(builder)
          .setMediaSession(sessionToken)
          .setShowActionsInCompactView(0, 1, 2)
      )
    }

    return builder.build()
  }

  private fun updateMediaSession(playing: Boolean, title: String?, artist: String?, duration: Long, position: Long) {
    val session = mediaSession ?: return
    val state = PlaybackStateCompat.Builder()
      .setActions(
        PlaybackStateCompat.ACTION_PLAY or
          PlaybackStateCompat.ACTION_PAUSE or
          PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
          PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
          PlaybackStateCompat.ACTION_SEEK_TO
      )
      .setState(
        if (playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
        position,
        if (playing) 1f else 0f,
      )
      .build()
    session.setPlaybackState(state)

    val metadata = MediaMetadataCompat.Builder()
      .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title ?: "")
      .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist ?: "")
      .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, duration)
      .build()
    session.setMetadata(metadata)
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
    if (wakeLock?.isHeld == true) return
    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
    val lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "wave:playback")
    lock.setReferenceCounted(false)
    lock.acquire()
    wakeLock = lock
  }

  private fun releaseWakeLock() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
  }

  private val mediaButtonReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      val action = intent.action
      val mainIntent = Intent(this@PlaybackService, MainActivity::class.java).apply {
        when (action) {
          ACTION_PREV -> putExtra("media_action", "prev")
          ACTION_NEXT -> putExtra("media_action", "next")
          ACTION_PLAY -> putExtra("media_action", "play")
          ACTION_PAUSE -> putExtra("media_action", "pause")
        }
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
      }
      startActivity(mainIntent)
    }
  }

  companion object {
    private const val CHANNEL_ID = "wave_playback"
    private const val NOTIFICATION_ID = 1
    const val EXTRA_PLAYING = "playing"
    const val EXTRA_TITLE = "title"
    const val EXTRA_ARTIST = "artist"
    const val EXTRA_DURATION = "duration"
    const val EXTRA_POSITION = "position"
    private const val ACTION_PREV = "com.wave.desktop.ACTION_PREV"
    private const val ACTION_PAUSE = "com.wave.desktop.ACTION_PAUSE"
    private const val ACTION_PLAY = "com.wave.desktop.ACTION_PLAY"
    private const val ACTION_NEXT = "com.wave.desktop.ACTION_NEXT"

    fun start(context: Context) {
      ContextCompat.startForegroundService(context, Intent(context, PlaybackService::class.java))
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, PlaybackService::class.java))
    }

    fun update(context: Context, playing: Boolean, title: String?, artist: String?, duration: Long, position: Long) {
      val intent = Intent(context, PlaybackService::class.java).apply {
        putExtra(EXTRA_PLAYING, playing)
        putExtra(EXTRA_TITLE, title)
        putExtra(EXTRA_ARTIST, artist)
        putExtra(EXTRA_DURATION, duration)
        putExtra(EXTRA_POSITION, position)
      }
      ContextCompat.startForegroundService(context, intent)
    }
  }
}
