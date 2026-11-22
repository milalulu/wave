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
pub(crate) async fn set_playback(
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
pub(crate) async fn consume_media_action(app: tauri::AppHandle) -> Result<Option<String>, String> {
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
pub(crate) async fn pick_local_audio(app: tauri::AppHandle) -> Result<Vec<String>, String> {
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

async fn mobile_call<T: serde::de::DeserializeOwned>(
    app: tauri::AppHandle,
    command: &str,
    args: serde_json::Value,
) -> Result<T, String> {
    #[cfg(target_os = "android")]
    {
        app.state::<WaveAndroid>()
            .0
            .run_mobile_plugin_async(command, args)
            .await
            .map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, command, args);
        Err("This command requires Android".into())
    }
}

#[tauri::command]
pub(crate) async fn share_text(app: tauri::AppHandle, text: String) -> Result<(), String> {
    mobile_call::<serde_json::Value>(app, "shareText", serde_json::json!({ "text": text })).await?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn schedule_alarm(
    app: tauri::AppHandle,
    id: String,
    at_ms: i64,
) -> Result<(), String> {
    mobile_call::<serde_json::Value>(
        app,
        "scheduleAlarm",
        serde_json::json!({ "id": id, "atMs": at_ms }),
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn cancel_alarm(app: tauri::AppHandle, id: String) -> Result<(), String> {
    mobile_call::<serde_json::Value>(app, "cancelAlarm", serde_json::json!({ "id": id })).await?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn recognize_speech(app: tauri::AppHandle) -> Result<String, String> {
    mobile_call(app, "recognizeSpeech", serde_json::json!({})).await
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
