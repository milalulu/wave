#[cfg(target_os = "android")]
use serde_json::{json, Value};
#[cfg(target_os = "android")]
use tauri::Manager;
use tauri::{
    plugin::{Builder as PluginBuilder, PluginHandle, TauriPlugin},
    Wry,
};

/// Дескриптор Android-плагина (Kotlin-часть: фоновое воспроизведение, импорт файлов).
#[allow(dead_code)]
pub struct WaveAndroid(pub PluginHandle<Wry>);

/// Включить/выключить foreground service с wake lock во время воспроизведения.
#[tauri::command]
async fn set_playback(app: tauri::AppHandle, playing: bool) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<WaveAndroid>();
        state
            .0
            .run_mobile_plugin_async::<Value>("setPlayback", json!({ "playing": playing }))
            .await
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "android"))]
    let _ = (app, playing);
    Ok(())
}

/// Системный выбор аудиофайлов (SAF/ACTION_OPEN_DOCUMENT). Возвращает пути
/// к файлам, скопированным в app-specific storage (играются через asset protocol).
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
        .invoke_handler(tauri::generate_handler![set_playback, pick_local_audio])
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
