package com.wave.desktop

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.view.View
import android.widget.RemoteViews
import java.io.File

/**
 * Homescreen-виджет: название/трек + prev/play-pause/next.
 * Состояние хранится в SharedPreferences (пушится из PlaybackPlugin при
 * каждом setPlayback), кнопки уходят тем же путём, что и нотификация —
 * media_action в MainActivity.
 */
class WaveWidgetProvider : AppWidgetProvider() {

  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    ids.forEach { updateOne(context, manager, it) }
  }

  companion object {
    private const val PREFS = "wave_widget"
    private const val KEY_PLAYING = "playing"
    private const val KEY_TITLE = "title"
    private const val KEY_ARTIST = "artist"
    private const val COVER_FILE = "widget_cover.png"

    fun saveState(context: Context, playing: Boolean, title: String?, artist: String?) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putBoolean(KEY_PLAYING, playing)
        .putString(KEY_TITLE, title)
        .putString(KEY_ARTIST, artist)
        .apply()
    }

    fun refreshAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(
        android.content.ComponentName(context, WaveWidgetProvider::class.java)
      )
      ids.forEach { updateOne(context, manager, it) }
    }

    fun setCoverArt(context: Context, bytes: ByteArray) {
      try {
        File(context.filesDir, COVER_FILE).outputStream().use { it.write(bytes) }
      } catch (_: Exception) {
        return
      }
      refreshAll(context)
    }

    fun clearCoverArt(context: Context) {
      try {
        File(context.filesDir, COVER_FILE).delete()
      } catch (_: Exception) {
      }
    }

    private fun mediaActionIntent(context: Context, action: String, requestCode: Int): PendingIntent {
      val intent = Intent(context, MainActivity::class.java).apply {
        putExtra("media_action", action)
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
      }
      return PendingIntent.getActivity(
        context,
        requestCode,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    private fun updateOne(context: Context, manager: AppWidgetManager, id: Int) {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val playing = prefs.getBoolean(KEY_PLAYING, false)
      val title = prefs.getString(KEY_TITLE, null)
      val artist = prefs.getString(KEY_ARTIST, null)

      val views = RemoteViews(context.packageName, R.layout.widget_player)
      views.setTextViewText(R.id.widget_title, title ?: context.getString(R.string.app_name))
      views.setTextViewText(R.id.widget_artist, artist ?: "")
      val letter = title?.trim()?.firstOrNull()?.uppercase() ?: "W"
      views.setTextViewText(R.id.widget_letter, letter)
      val cover = try {
        val f = File(context.filesDir, COVER_FILE)
        if (f.exists()) BitmapFactory.decodeFile(f.absolutePath) else null
      } catch (_: Exception) {
        null
      }
      if (cover != null) {
        views.setImageViewBitmap(R.id.widget_cover, cover)
        views.setViewVisibility(R.id.widget_cover, View.VISIBLE)
        views.setViewVisibility(R.id.widget_letter, View.GONE)
      } else {
        views.setViewVisibility(R.id.widget_cover, View.GONE)
        views.setViewVisibility(R.id.widget_letter, View.VISIBLE)
      }
      views.setImageViewResource(
        R.id.widget_play,
        if (playing) R.drawable.ic_w_pause else R.drawable.ic_w_play,
      )
      views.setOnClickPendingIntent(R.id.widget_prev, mediaActionIntent(context, "prev", 11))
      views.setOnClickPendingIntent(
        R.id.widget_play,
        mediaActionIntent(context, if (playing) "pause" else "play", 12),
      )
      views.setOnClickPendingIntent(R.id.widget_next, mediaActionIntent(context, "next", 13))
      views.setOnClickPendingIntent(
        R.id.widget_letter,
        mediaActionIntent(context, "open", 10),
      )
      views.setOnClickPendingIntent(
        R.id.widget_title,
        mediaActionIntent(context, "open", 10),
      )
      manager.updateAppWidget(id, views)
    }
  }
}
