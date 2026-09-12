use std::sync::OnceLock;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixStream;

const HANDSHAKE_OP: u32 = 0;
const FRAME_OP: u32 = 1;
const CLOSE_OP: u32 = 2;

fn next_nonce() -> String {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).expect("rng");
    bytes
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>()
}

pub struct DiscordRpc {
    client_id: String,
}

static INSTANCE: OnceLock<tokio::sync::Mutex<Option<DiscordRpc>>> = OnceLock::new();

fn instance() -> &'static tokio::sync::Mutex<Option<DiscordRpc>> {
    INSTANCE.get_or_init(|| tokio::sync::Mutex::new(None))
}

fn ipc_path() -> Option<std::path::PathBuf> {
    if let Ok(dir) = std::env::var("XDG_RUNTIME_DIR") {
        let p = std::path::PathBuf::from(dir).join("discord-ipc-0");
        if p.exists() {
            return Some(p);
        }
    }
    if let Ok(uid) = std::env::var("UID").or_else(|_| {
        std::process::Command::new("id")
            .arg("-u")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .ok_or(())
    }) {
        let p = std::path::PathBuf::from(format!("/run/user/{uid}/discord-ipc-0"));
        if p.exists() {
            return Some(p);
        }
    }
    let p = std::path::PathBuf::from("/tmp/discord-ipc-0");
    if p.exists() {
        return Some(p);
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let p = std::path::PathBuf::from(format!(
                "{home}/Library/Application Support/discord-ipc-0"
            ));
            if p.exists() {
                return Some(p);
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        let p = std::path::PathBuf::from(r"\\.\pipe\discord-ipc-0");
        if p.exists() {
            return Some(p);
        }
    }
    None
}

async fn send_frame(
    stream: &mut UnixStream,
    op: u32,
    payload: &str,
) -> Result<(), String> {
    let data = payload.as_bytes();
    let len = data.len() as u32;
    stream
        .write_all(&op.to_le_bytes())
        .await
        .map_err(|e| e.to_string())?;
    stream
        .write_all(&len.to_le_bytes())
        .await
        .map_err(|e| e.to_string())?;
    stream.write_all(data).await.map_err(|e| e.to_string())?;
    Ok(())
}

async fn read_frame(stream: &mut UnixStream) -> Result<(u32, String), String> {
    let mut op_buf = [0u8; 4];
    stream.read_exact(&mut op_buf).await.map_err(|e| format!("read op: {e}"))?;
    let op = u32::from_le_bytes(op_buf);
    let mut len_buf = [0u8; 4];
    stream.read_exact(&mut len_buf).await.map_err(|e| format!("read len: {e}"))?;
    let len = u32::from_le_bytes(len_buf) as usize;
    let mut data = vec![0u8; len];
    stream.read_exact(&mut data).await.map_err(|e| format!("read payload: {e}"))?;
    let payload = String::from_utf8_lossy(&data).to_string();
    Ok((op, payload))
}

async fn connect_and_handshake(client_id: &str) -> Result<UnixStream, String> {
    let path = ipc_path().ok_or("discord-ipc-0 not found (is Discord running?)")?;
    let mut stream = UnixStream::connect(&path)
        .await
        .map_err(|e| format!("connect {}: {e}", path.display()))?;

    let handshake = serde_json::json!({
        "v": 1,
        "client_id": client_id,
    });
    send_frame(&mut stream, HANDSHAKE_OP, &handshake.to_string()).await?;

    let (op, _) = read_frame(&mut stream).await?;
    if op != FRAME_OP {
        return Err(format!("unexpected op {op} in handshake response"));
    }

    Ok(stream)
}

#[allow(clippy::too_many_arguments)]
async fn set_activity_inner(
    client_id: &str,
    details: &str,
    state: &str,
    large_image: Option<&str>,
    large_text: Option<&str>,
    small_image: Option<&str>,
    small_text: Option<&str>,
    start_ts: Option<i64>,
    end_ts: Option<i64>,
) -> Result<(), String> {
    let mut stream = connect_and_handshake(client_id).await?;

    let mut assets = serde_json::Map::new();
    if let Some(img) = large_image {
        assets.insert("large_image".into(), serde_json::Value::String(img.into()));
    }
    if let Some(txt) = large_text {
        assets.insert("large_text".into(), serde_json::Value::String(txt.into()));
    }
    if let Some(img) = small_image {
        assets.insert("small_image".into(), serde_json::Value::String(img.into()));
    }
    if let Some(txt) = small_text {
        assets.insert("small_text".into(), serde_json::Value::String(txt.into()));
    }

    let mut activity = serde_json::Map::new();
    if !details.is_empty() {
        activity.insert("details".into(), serde_json::Value::String(details.into()));
    }
    if !state.is_empty() {
        activity.insert("state".into(), serde_json::Value::String(state.into()));
    }
    if !assets.is_empty() {
        activity.insert("assets".into(), serde_json::Value::Object(assets));
    }

    let mut timestamps = serde_json::Map::new();
    if let Some(s) = start_ts {
        timestamps.insert("start".into(), serde_json::Value::Number(s.into()));
    }
    if let Some(e) = end_ts {
        timestamps.insert("end".into(), serde_json::Value::Number(e.into()));
    }
    if !timestamps.is_empty() {
        activity.insert("timestamps".into(), serde_json::Value::Object(timestamps));
    }

    let cmd = serde_json::json!({
        "cmd": "SET_ACTIVITY",
        "args": {
            "pid": std::process::id(),
            "activity": activity,
        },
        "nonce": next_nonce(),
    });

    send_frame(&mut stream, FRAME_OP, &cmd.to_string()).await?;

    let (op, _) = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        read_frame(&mut stream),
    )
    .await
    .map_err(|_| "discord: response timeout".to_string())?
    .map_err(|e| format!("discord: {e}"))?;

    if op == CLOSE_OP {
        return Err("discord: closed by client".into());
    }

    Ok(())
}

async fn clear_activity_inner(client_id: &str) -> Result<(), String> {
    let mut stream = connect_and_handshake(client_id).await?;

    let cmd = serde_json::json!({
        "cmd": "SET_ACTIVITY",
        "args": {
            "pid": std::process::id(),
        },
        "nonce": next_nonce(),
    });

    send_frame(&mut stream, FRAME_OP, &cmd.to_string()).await?;

    let _ = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        read_frame(&mut stream),
    )
    .await;

    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn set_presence(
    client_id: String,
    details: String,
    state: String,
    large_image: Option<String>,
    large_text: Option<String>,
    small_image: Option<String>,
    small_text: Option<String>,
    start_ts: Option<i64>,
    end_ts: Option<i64>,
) -> Result<(), String> {
    {
        let mut guard = instance().lock().await;
        *guard = Some(DiscordRpc {
            client_id: client_id.clone(),
        });
    }
    set_activity_inner(
        &client_id,
        &details,
        &state,
        large_image.as_deref(),
        large_text.as_deref(),
        small_image.as_deref(),
        small_text.as_deref(),
        start_ts,
        end_ts,
    )
    .await
}

pub async fn clear_presence() -> Result<(), String> {
    let client_id = {
        let guard = instance().lock().await;
        guard.as_ref().map(|d| d.client_id.clone())
    };
    if let Some(cid) = client_id {
        clear_activity_inner(&cid).await?;
    }
    {
        let mut guard = instance().lock().await;
        *guard = None;
    }
    Ok(())
}

pub async fn has_client_id() -> bool {
    let guard = instance().lock().await;
    guard.as_ref().is_some_and(|d| !d.client_id.is_empty())
}