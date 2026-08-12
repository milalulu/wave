use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;
use tokio::time::timeout;

/// Мост между Rust-стороной (axum HTTP API) и TS-ядром в webview.
///
/// Схема: HTTP-хендлер вызывает `Bridge::request(action, payload)`.
/// Rust эмитит событие `api-request` во frontend, TS-ядро обрабатывает
/// запрос и отвечает командой `api_respond(id, value)`, после чего
/// oneshot-канал разрешается и HTTP-хендлер возвращает JSON.
#[derive(Default)]
pub struct Bridge {
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, oneshot::Sender<Value>>>,
}

pub type BridgeHandle = Arc<Bridge>;

impl Bridge {
    pub fn new() -> BridgeHandle {
        Arc::new(Bridge {
            next_id: AtomicU64::new(1),
            pending: Mutex::new(HashMap::new()),
        })
    }

    pub async fn request(
        self: &BridgeHandle,
        app: &AppHandle,
        action: &str,
        payload: Value,
    ) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self
                .pending
                .lock()
                .map_err(|_| "bridge lock poisoned".to_string())?;
            pending.insert(id, tx);
        }
        let _ = app.emit(
            "api-request",
            serde_json::json!({ "id": id, "action": action, "payload": payload }),
        );
        match timeout(Duration::from_secs(10), rx).await {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(_)) => {
                self.remove(id);
                Err("frontend dropped the response channel".into())
            }
            Err(_) => {
                self.remove(id);
                Err(format!("bridge request timeout for action '{action}'"))
            }
        }
    }

    pub fn respond(&self, id: u64, value: Value) -> Result<(), String> {
        let tx = self
            .pending
            .lock()
            .map_err(|_| "bridge lock poisoned".to_string())?
            .remove(&id);
        match tx {
            Some(tx) => tx.send(value).map_err(|_| "receiver gone".into()),
            None => Err(format!("unknown bridge request id {id}")),
        }
    }

    fn remove(&self, id: u64) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(&id);
        }
    }
}
