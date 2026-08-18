#[cfg(target_os = "android")]
use serde_json::{json, Value};
#[cfg(target_os = "android")]
use tauri::Manager;
use tauri::{
    plugin::{Builder as PluginBuilder, PluginHandle, TauriPlugin},
    Wry,
};

#[allow(dead_code)]
pub struct WaveAndroid(pub PluginHandle<Wry>);

#[tauri::command]
async fn set_playback(
    app: tauri::AppHandle,
    playing: bool,
    title: Option<String>,
    artist: Option<String>,
    duration: Option<f64>,
    position: Option<f64>,
    cover_url: Option<String>,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<WaveAndroid>();
        state
            .0
            .run_mobile_plugin_async::<Value>(
                "setPlayback",
                json!({
                    "playing": playing,
                    "title": title,
                    "artist": artist,
                    "duration": duration.unwrap_or(0.0),
                    "position": position.unwrap_or(0.0),
                    "coverUrl": cover_url,
                }),
            )
            .await
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "android"))]
    let _ = (app, playing, title, artist, duration, position, cover_url);
    Ok(())
}

#[tauri::command]
async fn consume_media_action(app: tauri::AppHandle) -> Result<Option<String>, String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<WaveAndroid>();
        let action = state
            .0
            .run_mobile_plugin_async::<Option<String>>("consumeMediaAction", Value::Null)
            .await
            .map_err(|e| e.to_string())?;
        return Ok(action);
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(None)
    }
}

#[tauri::command]
async fn pick_local_audio(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<WaveAndroid>();
        let paths = state
            .0
            .run_mobile_plugin_async::<Vec<String>>("pickAudio", Value::Null)
            .await
            .map_err(|e| e.to_string())?;
        return Ok(paths);
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(vec![])
    }
}

pub fn init() -> TauriPlugin<Wry> {
    PluginBuilder::new("wave_android")
        .invoke_handler(tauri::generate_handler![
            set_playback,
            pick_local_audio,
            consume_media_action
        ])
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle = _api.register_android_plugin("com.wave.desktop", "PlaybackPlugin")?;
                _app.manage(WaveAndroid(handle));
            }
            Ok(())
        })
        .build()
}
