package com.wave.desktop

import android.content.Intent
import android.os.Bundle
import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.activity.enableEdgeToEdge
import java.util.concurrent.ConcurrentLinkedQueue

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // The WebView does not consistently expose Android system bars as CSS
    // safe-area insets. Reserve them natively, including cutouts after rotation.
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
      WindowInsetsCompat.CONSUMED
    }
    ViewCompat.requestApplyInsets(content)
    if (savedInstanceState == null) {
      intent?.getStringExtra("media_action")?.let { pendingMediaActions.add(it) }
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    val action = intent.getStringExtra("media_action")
    if (action != null) {
      pendingMediaActions.add(action)
    }
  }

  companion object {
    val pendingMediaActions = ConcurrentLinkedQueue<String>()

    @JvmStatic
    fun consumeMediaAction(): String? = pendingMediaActions.poll()
  }
}
