package com.wave.desktop

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import androidx.activity.result.ActivityResult
import androidx.core.app.ActivityCompat
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.File
import java.io.FileOutputStream

@InvokeArg
data class SetPlaybackArgs(
  var playing: Boolean = false,
  var title: String? = null,
  var artist: String? = null,
  var duration: Double = 0.0,
  var position: Double = 0.0,
)

class PlaybackPlugin(activity: Activity) : Plugin(activity) {
  private val activityRef: Activity = activity

  @Command
  fun consumeMediaAction(invoke: Invoke) {
    val action = MainActivity.consumeMediaAction()
    if (action != null) {
      invoke.resolveObject(action)
    } else {
      invoke.resolve()
    }
  }

  @Command
  fun setPlayback(invoke: Invoke) {
    val args = invoke.parseArgs(SetPlaybackArgs::class.java)
    if (args.playing) {
      requestNotificationPermission()
      PlaybackService.update(
        activityRef,
        true,
        args.title,
        args.artist,
        (args.duration * 1000).toLong(),
        (args.position * 1000).toLong(),
      )
    } else {
      PlaybackService.update(
        activityRef,
        false,
        args.title,
        args.artist,
        (args.duration * 1000).toLong(),
        (args.position * 1000).toLong(),
      )
    }
    invoke.resolve()
  }

  @Command
  fun pickAudio(invoke: Invoke) {
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "audio/*"
      putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
    }
    startActivityForResult(invoke, intent, "onAudioPicked")
  }

  @ActivityCallback
  fun onAudioPicked(invoke: Invoke, result: ActivityResult) {
    if (result.resultCode != Activity.RESULT_OK || result.data == null) {
      invoke.resolveObject(emptyList<String>())
      return
    }
    val uris = mutableListOf<Uri>()
    val data = result.data!!
    val clip = data.clipData
    if (clip != null) {
      for (i in 0 until clip.itemCount) {
        clip.getItemAt(i).uri?.let { uris.add(it) }
      }
    } else {
      data.data?.let { uris.add(it) }
    }

    val paths = mutableListOf<String>()
    val dir = File(activityRef.filesDir, "wave-picked")
    dir.mkdirs()
    for ((index, uri) in uris.withIndex()) {
      val name = queryDisplayName(uri) ?: "track-${index + 1}"
      val target = uniqueFile(dir, sanitizeFileName(name))
      try {
        activityRef.contentResolver.openInputStream(uri)?.use { input ->
          FileOutputStream(target).use { output -> input.copyTo(output) }
        }
        val url = "http://asset.localhost/" + Uri.encode(target.absolutePath)
        paths.add(url)
      } catch (_: Exception) {
      }
    }
    invoke.resolveObject(paths)
  }

  private fun requestNotificationPermission() {
    if (Build.VERSION.SDK_INT >= 33 &&
      ActivityCompat.checkSelfPermission(activityRef, Manifest.permission.POST_NOTIFICATIONS) !=
      android.content.pm.PackageManager.PERMISSION_GRANTED
    ) {
      ActivityCompat.requestPermissions(
        activityRef,
        arrayOf(Manifest.permission.POST_NOTIFICATIONS),
        PERMISSION_REQUEST_NOTIFICATIONS,
      )
    }
  }

  private fun queryDisplayName(uri: Uri): String? {
    return try {
      activityRef.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
        val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (index >= 0 && cursor.moveToFirst()) cursor.getString(index) else null
      }
    } catch (_: Exception) {
      null
    }
  }

  private fun sanitizeFileName(name: String): String {
    val clean = name.replace(Regex("[^A-Za-z0-9._\\-()\\s]"), "_").trim()
    return if (clean.isEmpty() || clean == "." || clean == "..") "track" else clean
  }

  private fun uniqueFile(dir: File, name: String): File {
    var candidate = File(dir, name)
    if (!candidate.exists()) return candidate
    val dot = name.lastIndexOf('.')
    val base = if (dot > 0) name.substring(0, dot) else name
    val ext = if (dot > 0) name.substring(dot) else ""
    var i = 1
    while (candidate.exists()) {
      candidate = File(dir, "$base ($i)$ext")
      i++
    }
    return candidate
  }

  companion object {
    private const val PERMISSION_REQUEST_NOTIFICATIONS = 1001
  }
}
