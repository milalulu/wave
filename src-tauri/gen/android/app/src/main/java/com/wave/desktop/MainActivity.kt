package com.wave.desktop

import android.content.Intent
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import java.util.concurrent.ConcurrentLinkedQueue

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
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
