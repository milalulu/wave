//! Desktop-only model transport. No credentials, remote errors or raw HTTP bodies reach logs/UI.
use futures_util::StreamExt;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{sync::Mutex, time::Duration};
use tokio::sync::watch;

type Result<T> = std::result::Result<T, String>;
const INPUT_LIMIT: usize = 100_000;
const OUTPUT_LIMIT: usize = 65_536;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelConfig {
    mode: Mode,
    base_url: String,
    model: String,
    json_mode: bool,
    token_parameter: TokenParameter,
    cloud_consent: bool,
}
#[derive(Clone, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum Mode {
    Local,
    Cloud,
}
#[derive(Clone, Deserialize, Serialize)]
enum TokenParameter {
    #[serde(rename = "max_tokens")]
    Legacy,
    #[serde(rename = "max_completion_tokens")]
    Completion,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Message {
    role: String,
    content: String,
}

struct ActiveRequest {
    id: u64,
    started: bool,
    cancel: watch::Sender<bool>,
}
#[derive(Default)]
struct Requests {
    sequence: u64,
    active: Option<ActiveRequest>,
}
#[derive(Default)]
pub struct ModelState(Mutex<Requests>);

impl ModelState {
    fn begin(&self) -> Result<String> {
        let mut requests = self.0.lock().map_err(|_| "internal_error")?;
        if let Some(old) = requests.active.take() {
            let _ = old.cancel.send(true);
        }
        requests.sequence = requests.sequence.checked_add(1).ok_or("session_limit")?;
        let id = requests.sequence;
        let (cancel, _) = watch::channel(false);
        requests.active = Some(ActiveRequest {
            id,
            started: false,
            cancel,
        });
        Ok(id.to_string())
    }
    fn claim(&self, id: &str) -> Result<watch::Receiver<bool>> {
        let mut requests = self.0.lock().map_err(|_| "internal_error")?;
        let request = requests
            .active
            .as_mut()
            .filter(|r| r.id.to_string() == id && !r.started)
            .ok_or("cancelled")?;
        request.started = true;
        Ok(request.cancel.subscribe())
    }
    fn cancel(&self, id: &str) -> Result<()> {
        let mut requests = self.0.lock().map_err(|_| "internal_error")?;
        if requests
            .active
            .as_ref()
            .is_some_and(|r| r.id.to_string() == id)
        {
            if let Some(request) = requests.active.take() {
                let _ = request.cancel.send(true);
            }
        }
        Ok(())
    }
}

#[tauri::command]
pub fn agent_model_begin(state: tauri::State<'_, ModelState>) -> Result<String> {
    state.begin()
}

#[tauri::command]
pub fn agent_model_cancel(id: String, state: tauri::State<'_, ModelState>) -> Result<()> {
    state.cancel(&id)
}

/// Loopback literals only: DNS and environment proxies must not turn a local request into cloud traffic.
fn endpoint(base: &str, mode: &Mode) -> Result<Url> {
    if base.len() > 2048 {
        return Err("invalid_config".into());
    }
    let mut url = Url::parse(base).map_err(|_| "invalid_config")?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("invalid_config".into());
    }
    match mode {
        Mode::Local => {
            if url.scheme() != "http" || !matches!(url.host_str(), Some("127.0.0.1" | "[::1]")) {
                return Err("invalid_config".into());
            }
        }
        Mode::Cloud => {
            if url.scheme() != "https" || url.host_str().is_none() {
                return Err("invalid_config".into());
            }
        }
    }
    url.set_path(&format!(
        "{}/chat/completions",
        url.path().trim_end_matches('/')
    ));
    Ok(url)
}

fn validate(config: &ModelConfig, messages: &[Message]) -> Result<Url> {
    let url = endpoint(&config.base_url, &config.mode)?;
    if (config.mode == Mode::Cloud && !config.cloud_consent)
        || config.model.trim().is_empty()
        || config.model.len() > 200
        || config.model.chars().any(char::is_control)
        || messages.is_empty()
        || messages.len() > 80
        || messages.iter().any(|m| {
            !matches!(m.role.as_str(), "system" | "user" | "assistant") || m.content.is_empty()
        })
        || serde_json::to_vec(messages)
            .map_err(|_| "invalid_config")?
            .len()
            > INPUT_LIMIT
    {
        return Err("invalid_config".into());
    }
    Ok(url)
}

fn key_account(base_url: &str) -> Result<String> {
    // Include the full normalized API endpoint, not merely its host.
    let url = endpoint(base_url, &Mode::Cloud)?;
    Ok(format!(
        "cloud-{:x}",
        Sha256::digest(url.as_str().as_bytes())
    ))
}

fn key_entry(base_url: &str) -> Result<keyring::Entry> {
    keyring::Entry::new("com.wave.desktop.agent", &key_account(base_url)?)
        .map_err(|_| "key_store_unavailable".into())
}

#[tauri::command]
pub async fn agent_key_present(base_url: String) -> Result<bool> {
    tokio::task::spawn_blocking(move || match key_entry(&base_url)?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(_) => Err("key_store_unavailable".into()),
    })
    .await
    .map_err(|_| "key_store_unavailable")?
}

#[tauri::command]
pub async fn agent_key_save(base_url: String, key: String) -> Result<()> {
    if key.is_empty() || key.len() > 4096 || !key.bytes().all(|b| (33..=126).contains(&b)) {
        return Err("invalid_config".into());
    }
    tokio::task::spawn_blocking(move || {
        key_entry(&base_url)?
            .set_password(&key)
            .map_err(|_| "key_store_unavailable".into())
    })
    .await
    .map_err(|_| "key_store_unavailable")?
}

#[tauri::command]
pub async fn agent_key_delete(base_url: String) -> Result<()> {
    tokio::task::spawn_blocking(move || match key_entry(&base_url)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("key_store_unavailable".into()),
    })
    .await
    .map_err(|_| "key_store_unavailable")?
}

fn payload(config: &ModelConfig, messages: &[Message]) -> Value {
    let mut body = json!({ "model": config.model, "messages": messages, "stream": false });
    let field = match config.token_parameter {
        TokenParameter::Legacy => "max_tokens",
        TokenParameter::Completion => "max_completion_tokens",
    };
    body[field] = json!(1024);
    if config.json_mode {
        body["response_format"] = json!({ "type": "json_object" });
    }
    body
}

fn parse_response(bytes: &[u8]) -> Result<String> {
    let value: Value = serde_json::from_slice(bytes).map_err(|_| "invalid_response")?;
    let choices = value["choices"]
        .as_array()
        .filter(|a| a.len() == 1)
        .ok_or("invalid_response")?;
    let choice = &choices[0];
    // Reject truncated, refused and native tool-call responses; our protocol is a JSON decision in content.
    if choice["finish_reason"] != "stop"
        || !choice["message"]["refusal"].is_null()
        || !choice["message"]["tool_calls"].is_null()
    {
        return Err("invalid_response".into());
    }
    let text = choice["message"]["content"]
        .as_str()
        .filter(|s| !s.trim().is_empty() && s.len() <= 16_000)
        .ok_or("invalid_response")?;
    Ok(text.to_owned())
}

async fn complete(config: ModelConfig, messages: Vec<Message>) -> Result<String> {
    let url = validate(&config, &messages)?;
    let key = if config.mode == Mode::Cloud {
        let base_url = config.base_url.clone();
        Some(
            tokio::task::spawn_blocking(move || {
                key_entry(&base_url)?.get_password().map_err(|e| {
                    if matches!(e, keyring::Error::NoEntry) {
                        "key_missing".to_string()
                    } else {
                        "key_store_unavailable".to_string()
                    }
                })
            })
            .await
            .map_err(|_| "key_store_unavailable")??,
        )
    } else {
        None
    };
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|_| "connection_failed")?;
    let mut request = client.post(url).json(&payload(&config, &messages));
    if let Some(key) = key {
        request = request.bearer_auth(key);
    }
    let response = request.send().await.map_err(network_error)?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            401 | 403 => "authentication_failed",
            429 => "rate_limited",
            _ => "provider_error",
        }
        .into());
    }
    if response
        .content_length()
        .is_some_and(|n| n > OUTPUT_LIMIT as u64)
    {
        return Err("response_too_large".into());
    }
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(network_error)?;
        if bytes.len() + chunk.len() > OUTPUT_LIMIT {
            return Err("response_too_large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    parse_response(&bytes)
}

fn network_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "timeout"
    } else {
        "connection_failed"
    }
    .to_string()
}

#[tauri::command]
pub async fn agent_model_complete(
    id: String,
    config: ModelConfig,
    messages: Vec<Message>,
    state: tauri::State<'_, ModelState>,
) -> Result<String> {
    let mut cancel = state.claim(&id)?;
    let result = tokio::select! {
        biased;
        _ = cancel.changed() => Err("cancelled".into()),
        result = tokio::time::timeout(Duration::from_secs(65), complete(config, messages)) => result.unwrap_or_else(|_| Err("timeout".into())),
    };
    // A late completion must never cancel a newer request.
    state.cancel(&id)?;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn read_request(socket: &mut tokio::net::TcpStream) -> String {
        let mut bytes = Vec::new();
        loop {
            let mut chunk = [0; 1024];
            let size = socket.read(&mut chunk).await.unwrap();
            assert!(size > 0);
            bytes.extend_from_slice(&chunk[..size]);
            assert!(bytes.len() <= 8192);
            if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&bytes[..end]);
                let length = headers
                    .lines()
                    .find_map(|line| {
                        let (key, value) = line.split_once(':')?;
                        key.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().unwrap())
                    })
                    .unwrap_or(0);
                if bytes.len() >= end + 4 + length {
                    return String::from_utf8(bytes).unwrap();
                }
            }
        }
    }

    async fn fixture(response: String) -> (String, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            read_request(&mut socket).await;
            // A response-size rejection can close the connection before all chunks arrive.
            let _ = socket.write_all(response.as_bytes()).await;
        });
        (format!("http://{address}/v1"), task)
    }
    fn config(base_url: &str) -> ModelConfig {
        ModelConfig {
            mode: Mode::Local,
            base_url: base_url.into(),
            model: "fixture".into(),
            json_mode: true,
            token_parameter: TokenParameter::Legacy,
            cloud_consent: false,
        }
    }
    #[test]
    fn endpoints_reject_credential_leaks_and_nonlocal_hosts() {
        for url in [
            "http://example.com/v1",
            "http://localhost/v1",
            "http://127.0.0.1.evil.test/v1",
            "http://127.0.0.1/v1?key=x",
            "http://user:secret@127.0.0.1/v1",
            "file:///v1",
            "http://127.0.0.1/v1#x",
        ] {
            assert!(endpoint(url, &Mode::Local).is_err(), "{url}");
        }
        assert_eq!(
            endpoint("http://127.0.0.1:11434/v1/", &Mode::Local)
                .unwrap()
                .as_str(),
            "http://127.0.0.1:11434/v1/chat/completions"
        );
        assert!(endpoint("http://[::1]:8080/v1", &Mode::Local).is_ok());
        assert!(endpoint("http://cloud.test/v1", &Mode::Cloud).is_err());
        assert!(endpoint("https://cloud.test/v1", &Mode::Cloud).is_ok());
    }
    #[test]
    fn credentials_are_bound_to_the_normalized_api_url() {
        assert_eq!(
            key_account("https://cloud.test/v1").unwrap(),
            key_account("https://cloud.test:443/v1/").unwrap()
        );
        for other in [
            "https://other.test/v1",
            "https://cloud.test/v2",
            "https://cloud.test:8443/v1",
        ] {
            assert_ne!(
                key_account("https://cloud.test/v1").unwrap(),
                key_account(other).unwrap()
            );
        }
        assert!(key_account("http://cloud.test/v1").is_err());
    }
    #[test]
    fn validation_requires_cloud_opt_in_and_bounds_context() {
        let mut conf = config("https://cloud.test/v1");
        conf.mode = Mode::Cloud;
        let messages = vec![Message {
            role: "user".into(),
            content: "test".into(),
        }];
        assert!(validate(&conf, &messages).is_err());
        conf.cloud_consent = true;
        assert!(validate(&conf, &messages).is_ok());
        assert!(validate(&conf, &vec![messages[0].clone(); 81]).is_err());
        assert!(validate(
            &conf,
            &[Message {
                role: "user".into(),
                content: "я".repeat(60_000)
            }]
        )
        .is_err());
    }
    #[test]
    fn refuses_truncated_and_nontext_model_outputs() {
        let good = json!({ "choices": [{ "finish_reason": "stop", "message": { "content": "{\"type\":\"answer\",\"message\":\"ok\"}" } }] });
        assert!(parse_response(&serde_json::to_vec(&good).unwrap()).is_ok());
        for reason in ["length", "tool_calls", "content_filter"] {
            let mut bad = good.clone();
            bad["choices"][0]["finish_reason"] = json!(reason);
            assert!(parse_response(&serde_json::to_vec(&bad).unwrap()).is_err());
        }
        assert!(parse_response(b"not json").is_err());
    }
    #[test]
    fn cancellation_is_race_safe_and_does_not_cancel_next_request() {
        let state = ModelState::default();
        let early = state.begin().unwrap();
        state.cancel(&early).unwrap();
        assert!(state.claim(&early).is_err());
        let first = state.begin().unwrap();
        let receiver = state.claim(&first).unwrap();
        assert!(state.claim(&first).is_err());
        let second = state.begin().unwrap();
        assert!(*receiver.borrow());
        state.cancel(&first).unwrap();
        assert!(state.claim(&second).is_ok());
    }
    #[tokio::test]
    async fn local_transport_sends_protocol_without_auth_and_parses_response() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let request = read_request(&mut socket).await;
            assert!(request.starts_with("POST /v1/chat/completions HTTP/1.1"));
            assert!(!request.to_lowercase().contains("authorization:"));
            assert!(request.contains("\"max_tokens\":1024"));
            let body = r#"{"choices":[{"finish_reason":"stop","message":{"content":"ok"}}]}"#;
            socket
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
        });
        let result = complete(
            config(&format!("http://{address}/v1")),
            vec![Message {
                role: "user".into(),
                content: "test".into(),
            }],
        )
        .await
        .unwrap();
        assert_eq!(result, "ok");
        server.await.unwrap();
    }

    #[tokio::test]
    async fn rejects_redirects_oversized_bodies_and_sanitizes_http_errors() {
        let target = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let redirected = format!("HTTP/1.1 307 Temporary Redirect\r\nLocation: http://{}/stolen\r\nContent-Length: 0\r\n\r\n", target.local_addr().unwrap());
        let oversized = "x".repeat(OUTPUT_LIMIT + 1);
        let cases = [
            (redirected, "provider_error"),
            (
                "HTTP/1.1 401 Unauthorized\r\nContent-Length: 14\r\n\r\nprivate-secret".to_string(),
                "authentication_failed",
            ),
            (
                "HTTP/1.1 429 Too Many Requests\r\nContent-Length: 0\r\n\r\n".to_string(),
                "rate_limited",
            ),
            (
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n",
                    OUTPUT_LIMIT + 1
                ),
                "response_too_large",
            ),
            (
                format!(
                    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n{}\r\n0\r\n\r\n",
                    oversized.len(),
                    oversized
                ),
                "response_too_large",
            ),
        ];
        for (response, expected) in cases {
            let (base, server) = fixture(response).await;
            let result = complete(
                config(&base),
                vec![Message {
                    role: "user".into(),
                    content: "test".into(),
                }],
            )
            .await;
            assert_eq!(result.unwrap_err(), expected);
            server.await.unwrap();
        }
        assert!(
            tokio::time::timeout(Duration::from_millis(50), target.accept())
                .await
                .is_err()
        );
    }
}
