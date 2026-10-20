use std::sync::OnceLock;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
#[cfg(windows)]
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeClient as Transport};
#[cfg(unix)]
use tokio::net::UnixStream as Transport;

const HANDSHAKE_OP: u32 = 0;
const FRAME_OP: u32 = 1;
const CLOSE_OP: u32 = 2;

fn next_nonce() -> String {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).expect("rng");
    bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()
}

pub struct DiscordRpc {
    client_id: String,
    stream: Transport,
}

static INSTANCE: OnceLock<tokio::sync::Mutex<Option<DiscordRpc>>> = OnceLock::new();

fn instance() -> &'static tokio::sync::Mutex<Option<DiscordRpc>> {
    INSTANCE.get_or_init(|| tokio::sync::Mutex::new(None))
}

#[cfg(unix)]
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
    None
}

async fn send_frame(stream: &mut Transport, op: u32, payload: &str) -> Result<(), String> {
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

async fn read_frame(stream: &mut Transport) -> Result<(u32, String), String> {
    let mut op_buf = [0u8; 4];
    stream
        .read_exact(&mut op_buf)
        .await
        .map_err(|e| format!("read op: {e}"))?;
    let op = u32::from_le_bytes(op_buf);
    let mut len_buf = [0u8; 4];
    stream
        .read_exact(&mut len_buf)
        .await
        .map_err(|e| format!("read len: {e}"))?;
    let len = u32::from_le_bytes(len_buf) as usize;
    if len > 1024 * 1024 {
        return Err("discord: frame too large".into());
    }
    let mut data = vec![0u8; len];
    stream
        .read_exact(&mut data)
        .await
        .map_err(|e| format!("read payload: {e}"))?;
    let payload = String::from_utf8_lossy(&data).to_string();
    Ok((op, payload))
}

async fn read_reply(stream: &mut Transport) -> Result<serde_json::Value, String> {
    loop {
        let (op, payload) = read_frame(stream).await?;
        match op {
            3 => send_frame(stream, 4, &payload).await?, // IPC ping/pong
            CLOSE_OP => return Err("discord: connection closed".into()),
            FRAME_OP => {
                let value: serde_json::Value =
                    serde_json::from_str(&payload).map_err(|e| e.to_string())?;
                if value["evt"] == "ERROR" {
                    return Err(format!("discord: {}", value["data"]["message"]));
                }
                return Ok(value);
            }
            _ => return Err(format!("discord: unexpected opcode {op}")),
        }
    }
}

async fn connect_and_handshake(client_id: &str) -> Result<Transport, String> {
    #[cfg(unix)]
    let mut stream = {
        let path = ipc_path().ok_or("Discord IPC socket not found")?;
        Transport::connect(&path).await.map_err(|e| e.to_string())?
    };
    #[cfg(windows)]
    let mut stream = {
        let mut connected = None;
        for index in 0..10 {
            if let Ok(pipe) = ClientOptions::new().open(format!(r"\\.\pipe\discord-ipc-{index}")) {
                connected = Some(pipe);
                break;
            }
        }
        connected.ok_or("Discord IPC pipe not found")?
    };

    let handshake = serde_json::json!({
        "v": 1,
        "client_id": client_id,
    });
    send_frame(&mut stream, HANDSHAKE_OP, &handshake.to_string()).await?;

    let ready = read_reply(&mut stream).await?;
    if ready["evt"] != "READY" {
        return Err("discord: expected READY during handshake".into());
    }

    Ok(stream)
}

#[allow(clippy::too_many_arguments)]
async fn set_activity_inner(
    stream: &mut Transport,
    details: &str,
    state: &str,
    large_image: Option<&str>,
    large_text: Option<&str>,
    small_image: Option<&str>,
    small_text: Option<&str>,
    start_ts: Option<i64>,
    end_ts: Option<i64>,
) -> Result<(), String> {
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

    send_frame(stream, FRAME_OP, &cmd.to_string()).await?;

    tokio::time::timeout(std::time::Duration::from_secs(2), read_reply(stream))
        .await
        .map_err(|_| "discord: response timeout".to_string())?
        .map_err(|e| format!("discord: {e}"))?;

    Ok(())
}

async fn clear_activity_inner(stream: &mut Transport) -> Result<(), String> {
    let cmd = serde_json::json!({
        "cmd": "SET_ACTIVITY",
        "args": { "pid": std::process::id(), "activity": null },
        "nonce": next_nonce(),
    });
    send_frame(stream, FRAME_OP, &cmd.to_string()).await?;
    tokio::time::timeout(std::time::Duration::from_secs(2), read_reply(stream))
        .await
        .map_err(|_| "discord: clear response timed out".to_string())??;
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
    let mut guard = instance().lock().await;
    if guard.as_ref().is_none_or(|rpc| rpc.client_id != client_id) {
        *guard = None;
        let stream = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            connect_and_handshake(&client_id),
        )
        .await
        .map_err(|_| "Discord handshake timed out".to_string())??;
        *guard = Some(DiscordRpc { client_id, stream });
    }
    let rpc = guard.as_mut().ok_or("Discord connection unavailable")?;
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        set_activity_inner(
            &mut rpc.stream,
            &details,
            &state,
            large_image.as_deref(),
            large_text.as_deref(),
            small_image.as_deref(),
            small_text.as_deref(),
            start_ts,
            end_ts,
        ),
    )
    .await
    .map_err(|_| "Discord update timed out".to_string())
    .and_then(|result| result);
    if result.is_err() {
        *guard = None;
    }
    result
}

pub async fn clear_presence() -> Result<(), String> {
    let mut guard = instance().lock().await;
    if let Some(mut rpc) = guard.take() {
        tokio::time::timeout(
            std::time::Duration::from_secs(3),
            clear_activity_inner(&mut rpc.stream),
        )
        .await
        .map_err(|_| "Discord clear timed out".to_string())??;
    }
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[tokio::test]
    async fn reply_handles_ping_and_keeps_the_connection_open() {
        let (mut client, mut server) = Transport::pair().unwrap();
        let peer = tokio::spawn(async move {
            send_frame(&mut server, 3, "ping").await.unwrap();
            assert_eq!(read_frame(&mut server).await.unwrap(), (4, "ping".into()));
            send_frame(&mut server, FRAME_OP, r#"{"evt":"READY"}"#)
                .await
                .unwrap();
            send_frame(&mut server, FRAME_OP, r#"{"nonce":"second"}"#)
                .await
                .unwrap();
        });
        assert_eq!(read_reply(&mut client).await.unwrap()["evt"], "READY");
        assert_eq!(read_reply(&mut client).await.unwrap()["nonce"], "second");
        peer.await.unwrap();
    }

    #[tokio::test]
    async fn oversized_frame_is_rejected_before_allocating_its_body() {
        let (mut client, mut server) = Transport::pair().unwrap();
        server.write_all(&FRAME_OP.to_le_bytes()).await.unwrap();
        server
            .write_all(&(2 * 1024 * 1024u32).to_le_bytes())
            .await
            .unwrap();
        assert!(read_frame(&mut client)
            .await
            .unwrap_err()
            .contains("too large"));
    }
}
