package com.wave.desktop

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaDescriptionCompat
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.media.MediaBrowserServiceCompat

/**
 * Android Auto: отдаёт машине метаданные/транспорт через MediaSession.
 * Состояние пушится из PlaybackPlugin (set_playback) — тот же путь, что и
 * нотификация; кнопки ведут в MainActivity через media_action.
 */
class WaveAutoService : MediaBrowserServiceCompat() {

  private var session: MediaSessionCompat? = null

  override fun onCreate() {
    super.onCreate()
    session = MediaSessionCompat(this, "WaveAuto").apply {
      setCallback(AutoCallback())
      setFlags(
        MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS or
          MediaSessionCompat.FLAG_HANDLES_QUEUE_COMMANDS,
      )
      isActive = true
    }
    sessionToken = session?.sessionToken
  }

  override fun onDestroy() {
    session?.run {
      isActive = false
      release()
    }
    session = null
    super.onDestroy()
  }

  override fun onGetRoot(
    clientPackageName: String,
    clientUid: Int,
    rootHints: Bundle?,
  ): BrowserRoot = BrowserRoot(ROOT_ID, null)

  override fun onLoadChildren(
    parentId: String,
    result: Result<MutableList<MediaBrowserCompat.MediaItem>>,
  ) {
    val open = MediaDescriptionCompat.Builder()
      .setMediaId(ITEM_OPEN)
      .setTitle(getString(R.string.app_name))
      .setSubtitle(getString(R.string.auto_open_desc))
      .build()
    result.sendResult(
      mutableListOf(
        MediaBrowserCompat.MediaItem(open, MediaBrowserCompat.MediaItem.FLAG_PLAYABLE),
      ),
    )
  }

  private fun openApp() {
    val intent = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
    }
    startActivity(intent)
  }

  private fun sendAction(action: String) {
    val intent = Intent(this, MainActivity::class.java).apply {
      putExtra("media_action", action)
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
    }
    startActivity(intent)
  }

  private inner class AutoCallback : MediaSessionCompat.Callback() {
    override fun onPlay() = sendAction("play")
    override fun onPause() = sendAction("pause")
    override fun onSkipToNext() = sendAction("next")
    override fun onSkipToPrevious() = sendAction("prev")
    override fun onPlayFromMediaId(mediaId: String?, extras: Bundle?) {
      openApp()
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val playing = intent?.getBooleanExtra(EXTRA_PLAYING, false) ?: false
    val title = intent?.getStringExtra(EXTRA_TITLE)
    val artist = intent?.getStringExtra(EXTRA_ARTIST)
    val duration = intent?.getLongExtra(EXTRA_DURATION, 0L) ?: 0L
    val position = intent?.getLongExtra(EXTRA_POSITION, 0L) ?: 0L
    val s = session ?: return START_NOT_STICKY
    val state = PlaybackStateCompat.Builder()
      .setActions(
        PlaybackStateCompat.ACTION_PLAY or
          PlaybackStateCompat.ACTION_PAUSE or
          PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
          PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS,
      )
      .setState(
        if (playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
        position,
        if (playing) 1f else 0f,
      )
      .build()
    s.setPlaybackState(state)
    val metadata = MediaMetadataCompat.Builder()
      .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title ?: "")
      .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist ?: "")
      .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, duration)
      .build()
    s.setMetadata(metadata)
    return START_NOT_STICKY
  }

  companion object {
    private const val ROOT_ID = "wave_root"
    private const val ITEM_OPEN = "open"
    private const val EXTRA_PLAYING = "playing"
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_ARTIST = "artist"
    private const val EXTRA_DURATION = "duration"
    private const val EXTRA_POSITION = "position"

    fun pushState(
      context: Context,
      playing: Boolean,
      title: String?,
      artist: String?,
      duration: Long,
      position: Long,
    ) {
      val intent = Intent(context, WaveAutoService::class.java).apply {
        putExtra(EXTRA_PLAYING, playing)
        putExtra(EXTRA_TITLE, title)
        putExtra(EXTRA_ARTIST, artist)
        putExtra(EXTRA_DURATION, duration)
        putExtra(EXTRA_POSITION, position)
      }
      try {
        context.startService(intent)
      } catch (_: Exception) {
      }
    }
  }
}
