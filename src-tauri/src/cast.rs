use crate::cast_relay::Relay;
use oxicast::{CastApp, CastClient, IdleReason, MediaInfo, PlayerState};
use serde::Serialize;
use std::{
    net::{IpAddr, SocketAddr},
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};
use tokio::sync::Mutex;

#[derive(Default)]
pub struct CastHost(Mutex<Option<Session>>);
struct Session {
    id: u64,
    client: CastClient,
    relay: Relay,
}
static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);
#[derive(Serialize)]
pub struct Device {
    name: String,
    address: String,
    port: u16,
}
#[derive(Serialize)]
pub struct Snapshot {
    state: &'static str,
    position: f64,
    duration: f64,
    finished: bool,
    failed: bool,
}
fn private_peer(address: &str, port: u16) -> Result<SocketAddr, String> {
    let ip = address
        .parse::<std::net::Ipv4Addr>()
        .map_err(|_| "Enter the device's IPv4 address")?;
    if !ip.is_private() || port == 0 {
        return Err("Cast device must be on your private network".into());
    }
    Ok(SocketAddr::new(IpAddr::V4(ip), port))
}
#[tauri::command]
pub async fn cast_discover(app: tauri::AppHandle) -> Result<Vec<Device>, String> {
    static DISCOVERY: Mutex<()> = Mutex::const_new(());
    let _guard = DISCOVERY.lock().await;
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        app.state::<crate::android::WaveAndroid>()
            .0
            .run_mobile_plugin_async::<serde_json::Value>(
                "castDiscoveryLock",
                serde_json::json!({"enabled":true}),
            )
            .await
            .map_err(|e| e.to_string())?;
    }
    let result = oxicast::discovery::discover_devices(Duration::from_secs(3))
        .await
        .map_err(|e| e.to_string());
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let _ = app
            .state::<crate::android::WaveAndroid>()
            .0
            .run_mobile_plugin_async::<serde_json::Value>(
                "castDiscoveryLock",
                serde_json::json!({"enabled":false}),
            )
            .await;
    }
    #[cfg(not(target_os = "android"))]
    let _ = app;
    let devices = result?;
    Ok(devices
        .into_iter()
        .filter(|d| private_peer(&d.ip.to_string(), d.port).is_ok())
        .map(|d| Device {
            name: d.name,
            address: d.ip.to_string(),
            port: d.port,
        })
        .collect())
}
#[tauri::command]
pub async fn cast_connect(
    host: tauri::State<'_, CastHost>,
    address: String,
    port: u16,
) -> Result<u64, String> {
    let peer = private_peer(&address, port)?;
    let mut state = host.0.lock().await;
    let client = tokio::time::timeout(
        Duration::from_secs(10),
        CastClient::builder(address, port)
            .auto_reconnect(false)
            .request_timeout(Duration::from_secs(8))
            .connect(),
    )
    .await
    .map_err(|_| "Cast connection timed out")?
    .map_err(|e| e.to_string())?;
    client
        .launch_app(&CastApp::DefaultMediaReceiver)
        .await
        .map_err(|e| e.to_string())?;
    let relay = Relay::start(peer).await?;
    if let Some(previous) = state.take() {
        let _ = previous.client.stop_media().await;
        let _ = previous.client.disconnect().await;
    }
    let id = NEXT_SESSION.fetch_add(1, Ordering::Relaxed);
    *state = Some(Session { id, client, relay });
    Ok(id)
}
#[tauri::command]
pub async fn cast_disconnect(host: tauri::State<'_, CastHost>, id: u64) -> Result<(), String> {
    let mut state = host.0.lock().await;
    if state.as_ref().is_some_and(|s| s.id == id) {
        let session = state.take().unwrap();
        let _ = session.client.stop_media().await;
        session
            .client
            .disconnect()
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub async fn cast_load(
    host: tauri::State<'_, CastHost>,
    id: u64,
    src: String,
) -> Result<(), String> {
    let state = host.0.lock().await;
    let session = state
        .as_ref()
        .filter(|s| s.id == id)
        .ok_or("Cast session has ended")?;
    let (url, mime) = session.relay.register(&src).await?;
    session
        .client
        .load_media(&MediaInfo::new(url, mime), false, 0.0, None)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub async fn cast_control(
    host: tauri::State<'_, CastHost>,
    id: u64,
    action: String,
    value: Option<f64>,
) -> Result<(), String> {
    let state = host.0.lock().await;
    let session = state
        .as_ref()
        .filter(|s| s.id == id)
        .ok_or("Cast session has ended")?;
    let client = &session.client;
    match action.as_str() {
        "play" => {
            client.play().await.map_err(|e| e.to_string())?;
        }
        "pause" => {
            client.pause().await.map_err(|e| e.to_string())?;
        }
        "seek" => {
            let v = value
                .filter(|v| v.is_finite() && *v >= 0.0)
                .ok_or("Invalid position")?;
            client.seek(v).await.map_err(|e| e.to_string())?;
        }
        "volume" => {
            let v = value
                .filter(|v| v.is_finite() && (0.0..=1.0).contains(v))
                .ok_or("Invalid volume")?;
            client
                .set_volume(v as f32)
                .await
                .map_err(|e| e.to_string())?;
        }
        _ => return Err("Unknown Cast command".into()),
    }
    Ok(())
}
#[tauri::command]
pub async fn cast_status(host: tauri::State<'_, CastHost>, id: u64) -> Result<Snapshot, String> {
    let state = host.0.lock().await;
    let session = state
        .as_ref()
        .filter(|s| s.id == id)
        .ok_or("Cast session has ended")?;
    if !session.client.is_connected() {
        return Err("Cast disconnected".into());
    }
    let media = session
        .client
        .media_status()
        .await
        .map_err(|e| e.to_string())?;
    Ok(match media {
        Some(m) => Snapshot {
            state: match m.player_state {
                PlayerState::Playing => "playing",
                PlayerState::Paused => "paused",
                PlayerState::Buffering => "loading",
                _ => "idle",
            },
            position: m.current_time,
            duration: m.duration.unwrap_or(0.0),
            finished: m.idle_reason == Some(IdleReason::Finished),
            failed: m.idle_reason == Some(IdleReason::Error),
        },
        None => Snapshot {
            state: "idle",
            position: 0.0,
            duration: 0.0,
            finished: false,
            failed: false,
        },
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cast_targets_are_explicit_private_addresses() {
        assert!(private_peer("192.168.1.10", 8009).is_ok());
        for address in [
            "127.0.0.1",
            "0.0.0.0",
            "169.254.169.254",
            "8.8.8.8",
            "example.com",
        ] {
            assert!(private_peer(address, 8009).is_err());
        }
    }
}
