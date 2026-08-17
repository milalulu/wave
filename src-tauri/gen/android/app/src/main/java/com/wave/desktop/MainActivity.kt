package com.wave.desktop

import android.content.Intent
import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    val action = intent.getStringExtra("media_action")
    if (action != null) {
      val js = when (action) {
        "prev" -> "window.__wave_media_action?.('prev')"
        "next" -> "window.__wave_media_action?.('next')"
        "play" -> "window.__wave_media_action?.('play')"
        "pause" -> "window.__wave_media_action?.('pause')"
        else -> null
      }
      if (js != null) {
        webView?.evaluateJavascript(js, null)
      }
    }
  }
}
