use crate::plugin_support::{
    self, join_worker, limited_lua, next_request_id, read_limited, run_limited, validate_source,
    write_atomic, MAX_BODY, MAX_SOURCE, REQUEST_TIMEOUT,
};
use mlua::{Lua, LuaSerdeExt, Table, Value};
use serde::Serialize;
use serde_json::json;
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const PLUGIN_DATA_TIMEOUT: Duration = Duration::from_secs(5);

const EXAMPLE_PLUGIN: &str = r#"-- ============================================================
-- Hello Wave — пример плагина для Wave.
-- Файл лежит в папке плагинов (Plugins -> Open plugins folder).
-- Включи его в настройках (Plugins -> toggle) и перезагрузи.
-- ============================================================

wave_plugin = {
  name = "Hello Wave",
  version = "1.0.0",
  allowed_commands = { "echo" },
}

wave.log("Hello Wave plugin loaded!")

-- Хук: трек сменился.
wave.on_track_change(function(track)
    if track then
        wave.log("Now playing: " .. (track.title or "?") .. (track.artist and " - " .. track.artist or ""))
    end
end)

-- Хук: плеер запущен / поставлен на паузу.
wave.on_play(function()
    wave.notify("Wave", "Playback started")
end)
wave.on_pause(function() end)

-- Хук: любой апдейт состояния плеера.
wave.on_state(function(state)
    -- state: { state, position, duration, volume, shuffle, repeat, current=track, queueLength, queueIndex }
end)

-- Управление плеером, раскомментируй чтобы поиграться:
-- wave.play()
-- wave.pause()
-- wave.next()
-- wave.prev()
-- wave.seek(30)          -- перемотать на 30 секунду
-- wave.jump(-10)         -- на 10 секунд назад
-- wave.set_volume(0.8)   -- 0..1
-- wave.set_shuffle(true)
-- wave.set_repeat("all") -- "off" | "one" | "all"

-- Асинхронный HTTP (ответ в обратном вызове).
-- wave.http_get("https://example.com/api/meta", function(res)
--     wave.log("HTTP " .. (res.status or "?") .. " len=" .. #(res.body or ""))
-- end)

-- Запуск внешней команды (только команды из wave_plugin.allowed_commands).
-- wave.exec("echo", {"hello from wave"}, function(res)
--     wave.log("exec code=" .. (res.code or "?"))
-- end)

-- Персистентная конфигурация плагина (хранится на диске).
-- wave.set_config("greeting", "добро пожаловать")
-- wave.log("greeting = " .. tostring(wave.get_config("greeting", "default value")))

-- Доступ к библиотеке пользователя.
-- wave.log("playlists = " .. #(wave.get_playlists() or {}))
-- wave.log("liked = " .. #(wave.get_liked() or {}))
-- wave.log("history = " .. #(wave.get_history() or {}))

-- Поиск треков (результаты приходят в обратный вызов).
-- wave.search("Daft Punk Da Funk", function(results)
--     local group = results and results.results and results.results[1]
--     local first = (group and group.tracks and group.tracks[1] and group.tracks[1].title) or "none"
--     wave.log("Search done, first hit: " .. tostring(first))
-- end)
"#;

#[derive(Serialize, Clone)]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub enabled: bool,
    pub loaded: bool,
    pub error: Option<String>,
    pub log: Vec<String>,
}

enum WorkerMsg {
    Event {
        name: String,
        payload: Option<serde_json::Value>,
    },
    AsyncResult {
        id: u64,
        value: Option<serde_json::Value>,
    },
    State(serde_json::Value),
    Shutdown,
}

enum HostMsg {
    Log {
        plugin: String,
        line: String,
    },
    Control {
        method: String,
        args: serde_json::Value,
    },
    Notify {
        title: String,
        body: String,
    },
    Http {
        reply: Sender<WorkerMsg>,
        id: u64,
        url: String,
        headers: HashMap<String, String>,
    },
    Exec {
        reply: Sender<WorkerMsg>,
        id: u64,
        cmd: String,
        args: Vec<String>,
    },
    Search {
        reply: Sender<WorkerMsg>,
        id: u64,
        query: String,
        provider: Option<String>,
    },
    DataGet {
        kind: String,
        req_id: u64,
        reply: Sender<Option<serde_json::Value>>,
    },
}

struct PluginEntry {
    id: String,
    name: String,
    version: String,
    enabled: bool,
    loaded: bool,
    error: Option<String>,
    tx: Option<Sender<WorkerMsg>>,
    thread: Option<std::thread::JoinHandle<()>>,
    cancelled: Arc<AtomicBool>,
}

type EventSink = Arc<dyn Fn(&str, serde_json::Value) -> Result<(), String> + Send + Sync>;

struct Registry {
    emit: EventSink,
    plugins: HashMap<String, PluginEntry>,
    order: Vec<String>,
    states: HashMap<String, bool>,
    states_path: PathBuf,
    configs: HashMap<String, serde_json::Value>,
    configs_path: PathBuf,
    req_owner: HashMap<u64, (Sender<WorkerMsg>, Instant)>,
    data_pending: HashMap<u64, (Sender<Option<serde_json::Value>>, Instant)>,
    logs: HashMap<String, VecDeque<String>>,
    client: reqwest::blocking::Client,
    latest_state: Option<serde_json::Value>,
}

impl Registry {
    fn worker_tx(&mut self, id: u64) -> Option<Sender<WorkerMsg>> {
        self.req_owner.remove(&id).map(|(tx, _)| tx)
    }

    fn push(&mut self, tx: &Sender<WorkerMsg>, msg: WorkerMsg) {
        let _ = tx.send(msg);
    }
}

fn json_to_lua(lua: &Lua, value: &serde_json::Value) -> mlua::Result<Value> {
    match value {
        serde_json::Value::Null => Ok(Value::Nil),
        serde_json::Value::Bool(b) => Ok(Value::Boolean(*b)),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Ok(Value::Integer(i))
            } else if let Some(f) = n.as_f64() {
                Ok(Value::Number(f))
            } else {
                Ok(Value::Nil)
            }
        }
        serde_json::Value::String(s) => Ok(Value::String(lua.create_string(s)?)),
        serde_json::Value::Array(items) => {
            let t = lua.create_table()?;
            for (i, item) in items.iter().enumerate() {
                t.set(i + 1, json_to_lua(lua, item)?)?;
            }
            Ok(Value::Table(t))
        }
        serde_json::Value::Object(map) => {
            let t = lua.create_table()?;
            for (k, v) in map {
                t.set(k.as_str(), json_to_lua(lua, v)?)?;
            }
            Ok(Value::Table(t))
        }
    }
}

fn do_http(
    client: &reqwest::blocking::Client,
    url: &str,
    headers: &HashMap<String, String>,
) -> serde_json::Value {
    let mut req = client.get(url).timeout(Duration::from_secs(15));
    for (k, v) in headers {
        req = req.header(k, v);
    }
    match req.send() {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let status_text = resp.status().canonical_reason().unwrap_or("").to_string();
            let mut hdr = serde_json::Map::new();
            for (k, v) in resp.headers() {
                if let Ok(vs) = v.to_str() {
                    hdr.insert(k.to_string(), serde_json::Value::String(vs.to_string()));
                }
            }
            match read_limited(resp, MAX_BODY) {
                Ok(body) => {
                    json!({ "status": status, "statusText": status_text, "headers": hdr, "body": String::from_utf8_lossy(&body) })
                }
                Err(error) => json!({ "error": error }),
            }
        }
        Err(e) => json!({ "error": e.to_string() }),
    }
}

fn pump_loop(rx: Receiver<HostMsg>, registry: Arc<Mutex<Registry>>) {
    let slots = Arc::new(tokio::sync::Semaphore::new(8));
    loop {
        if let Ok(mut g) = registry.lock() {
            let now = Instant::now();
            g.req_owner.retain(|id, (tx, deadline)| {
                if now < *deadline {
                    return true;
                }
                let _ = tx.send(WorkerMsg::AsyncResult {
                    id: *id,
                    value: Some(json!({"error": "request timeout"})),
                });
                false
            });
            g.data_pending.retain(|_, (reply, deadline)| {
                if now < *deadline {
                    return true;
                }
                let _ = reply.send(None);
                false
            });
        }
        let msg = match rx.recv_timeout(Duration::from_millis(400)) {
            Ok(m) => m,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        };
        match msg {
            HostMsg::Log { plugin, line } => {
                if let Ok(mut g) = registry.lock() {
                    let q = g.logs.entry(plugin).or_default();
                    q.push_back(line);
                    if q.len() > 40 {
                        q.pop_front();
                    }
                }
            }
            HostMsg::Control { method, args } => {
                if let Ok(g) = registry.lock() {
                    let _ = (g.emit)(
                        "wave-plugin-control",
                        json!({ "method": method, "args": args }),
                    );
                }
            }
            HostMsg::Notify { title, body } => {
                if let Ok(g) = registry.lock() {
                    let _ = (g.emit)(
                        "wave-plugin-notify",
                        json!({ "title": title, "body": body }),
                    );
                }
            }
            HostMsg::Http {
                reply,
                id,
                url,
                headers,
            } => match Arc::clone(&slots).try_acquire_owned() {
                Ok(permit) => {
                    let client = registry
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .client
                        .clone();
                    tauri::async_runtime::spawn_blocking(move || {
                        let _permit = permit;
                        let value = do_http(&client, &url, &headers);
                        let _ = reply.send(WorkerMsg::AsyncResult {
                            id,
                            value: Some(value),
                        });
                    });
                }
                Err(_) => {
                    let _ = reply.send(WorkerMsg::AsyncResult {
                        id,
                        value: Some(json!({"error": "too many plugin operations"})),
                    });
                }
            },
            HostMsg::Exec {
                reply,
                id,
                cmd,
                args,
            } => match Arc::clone(&slots).try_acquire_owned() {
                Ok(permit) => {
                    tauri::async_runtime::spawn(async move {
                        let _permit = permit;
                        let value = plugin_support::execute(&cmd, &args).await;
                        let _ = reply.send(WorkerMsg::AsyncResult {
                            id,
                            value: Some(value),
                        });
                    });
                }
                Err(_) => {
                    let _ = reply.send(WorkerMsg::AsyncResult {
                        id,
                        value: Some(json!({"error": "too many plugin operations"})),
                    });
                }
            },
            HostMsg::Search {
                reply,
                id,
                query,
                provider,
            } => {
                if let Ok(mut g) = registry.lock() {
                    g.req_owner
                        .insert(id, (reply, Instant::now() + REQUEST_TIMEOUT));
                    if (g.emit)(
                        "wave-plugin-search",
                        json!({"reqId": id, "query": query, "provider": provider}),
                    )
                    .is_err()
                    {
                        g.req_owner.remove(&id);
                    }
                }
            }
            HostMsg::DataGet {
                kind,
                req_id,
                reply,
            } => {
                if let Ok(mut g) = registry.lock() {
                    g.data_pending
                        .insert(req_id, (reply, Instant::now() + PLUGIN_DATA_TIMEOUT));
                    if (g.emit)("wave-plugin-data", json!({"reqId": req_id, "kind": kind})).is_err()
                    {
                        g.data_pending.remove(&req_id);
                    }
                }
            }
        }
    }
}

fn config_lookup(g: &Registry, plugin: &str, args: &serde_json::Value) -> serde_json::Value {
    let key = args.get("key").and_then(|v| v.as_str()).unwrap_or("");
    let default = args
        .get("default")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    g.configs
        .get(plugin)
        .and_then(|map| map.get(key))
        .cloned()
        .unwrap_or(default)
}

fn plugin_filename(url: &str) -> Result<String, String> {
    let no_query = url.split(['?', '#']).next().unwrap_or(url);
    let raw = no_query.rsplit('/').next().unwrap_or_default();
    if raw.is_empty() || raw.contains("..") {
        return Err("cannot derive a safe plugin filename from URL".into());
    }
    let sanitized: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        .collect();
    if sanitized.is_empty() {
        return Err("cannot derive a safe plugin filename from URL".into());
    }
    let mut name = sanitized;
    if !name.ends_with(".lua") {
        name.push_str(".lua");
    }
    Ok(name)
}

fn store_pending(lua: &Lua, id: u64, cb: Value) -> mlua::Result<()> {
    if !matches!(cb, Value::Function(_)) {
        return Err(callback_error("callback expected"));
    }
    let globals = lua.globals();
    let t: Table = match globals.get::<Option<Table>>("wave_pending")? {
        Some(t) => t,
        None => {
            let t = lua.create_table()?;
            globals.set("wave_pending", t.clone())?;
            t
        }
    };
    if t.clone().pairs::<Value, Value>().count() >= 64 {
        return Err(callback_error("too many pending callbacks"));
    }
    t.raw_set(id, cb)
}

fn take_pending(lua: &Lua, id: u64) -> mlua::Result<Value> {
    let globals = lua.globals();
    let Some(t) = globals.get::<Option<Table>>("wave_pending")? else {
        return Ok(Value::Nil);
    };
    let v: Value = t.raw_get(id)?;
    t.raw_set(id, Value::Nil)?;
    Ok(v)
}

fn register_handler(lua: &Lua, events: &Table, event: &str, handler: Value) -> mlua::Result<()> {
    let arr = match events.get::<Option<Table>>(event)? {
        Some(t) => t,
        None => {
            let t = lua.create_table()?;
            events.set(event, t.clone())?;
            t
        }
    };
    let len = arr.raw_len();
    arr.raw_set(len + 1, handler)
}

fn call_handler(
    function: Value,
    arg: Option<Value>,
    tx: &Sender<HostMsg>,
    plugin: &str,
    budget: &AtomicU64,
) -> mlua::Result<()> {
    budget.store(0, Ordering::Relaxed);
    if let Value::Function(f) = function {
        let result = run_limited(|| match arg {
            Some(a) => f.call::<Value>(a),
            None => f.call::<Value>(()),
        });
        if let Err(e) = result {
            let _ = tx.send(HostMsg::Log {
                plugin: plugin.to_string(),
                line: format!("handler error: {e}"),
            });
        }
    }
    Ok(())
}

fn dispatch_event(
    lua: &Lua,
    events: &Table,
    name: &str,
    payload: Option<&serde_json::Value>,
    tx: &Sender<HostMsg>,
    plugin: &str,
    budget: &AtomicU64,
) {
    let Ok(Some(arr)) = events.get::<Option<Table>>(name) else {
        return;
    };
    let converted = payload.map(|v| json_to_lua(lua, v));
    for item in arr.sequence_values::<Value>() {
        let Ok(function) = item else { continue };
        let arg = match &converted {
            Some(Ok(v)) => Some(v.clone()),
            _ => None,
        };
        let _ = call_handler(function, arg, tx, plugin, budget);
    }
}

fn extract_meta(lua: &Lua, fallback: &str) -> (String, String) {
    let mut name = fallback.to_string();
    let mut version = String::new();
    if let Ok(Value::Table(meta)) = lua.globals().get::<Value>("wave_plugin") {
        if let Ok(Some(n)) = meta.get::<Option<String>>("name") {
            name = n;
        }
        if let Ok(Some(v)) = meta.get::<Option<String>>("version") {
            version = v;
        }
    }
    (name, version)
}

#[derive(Clone)]
pub struct PluginHost {
    dir: PathBuf,
    registry: Arc<Mutex<Registry>>,
    host_tx: Sender<HostMsg>,
    lifecycle: Arc<Mutex<()>>,
    retiring: Arc<Mutex<HashMap<String, std::thread::JoinHandle<()>>>>,
}

impl PluginHost {
    pub fn new(app: AppHandle, dir: PathBuf) -> PluginHost {
        Self::with_events(
            dir,
            Arc::new(move |name, value| app.emit(name, value).map_err(|e| e.to_string())),
        )
    }

    fn with_events(dir: PathBuf, emit: EventSink) -> PluginHost {
        let states_path = dir.join("plugin-states.json");
        let states = std::fs::read_to_string(&states_path)
            .ok()
            .and_then(|s| serde_json::from_str::<HashMap<String, bool>>(&s).ok())
            .unwrap_or_default();

        let configs_path = dir.join("plugin-configs.json");
        let configs: HashMap<String, serde_json::Value> = std::fs::read_to_string(&configs_path)
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .map(|v| match v {
                serde_json::Value::Object(map) => map.into_iter().collect(),
                _ => HashMap::new(),
            })
            .unwrap_or_default();

        let client = reqwest::blocking::Client::builder()
            .user_agent("wave-plugin-host")
            .build()
            .unwrap_or_else(|_| reqwest::blocking::Client::new());

        let registry = Arc::new(Mutex::new(Registry {
            emit,
            plugins: HashMap::new(),
            order: Vec::new(),
            states,
            states_path,
            configs,
            configs_path,
            req_owner: HashMap::new(),
            data_pending: HashMap::new(),
            logs: HashMap::new(),
            client,
            latest_state: None,
        }));

        let (host_tx, host_rx) = channel::<HostMsg>();
        {
            let registry = Arc::clone(&registry);
            std::thread::Builder::new()
                .name("wave-plugin-pump".into())
                .spawn(move || pump_loop(host_rx, registry))
                .ok();
        }
        let host = PluginHost {
            dir,
            registry,
            host_tx,
            lifecycle: Arc::new(Mutex::new(())),
            retiring: Arc::new(Mutex::new(HashMap::new())),
        };
        host.ensure_dir();
        // Frontend calls plugin_ready after its event listeners are installed.
        host
    }

    fn ensure_dir(&self) {
        if std::fs::create_dir_all(&self.dir).is_err() {
            return;
        }
        if let Ok(read) = std::fs::read_dir(&self.dir) {
            let has_lua = read.filter_map(|e| e.ok()).any(|e| {
                e.file_type().map(|t| t.is_file()).unwrap_or(false)
                    && e.path().extension().map(|x| x == "lua").unwrap_or(false)
            });
            if !has_lua {
                let example = self.dir.join("hello_wave.lua");
                let _ = std::fs::write(&example, EXAMPLE_PLUGIN);
            }
        }
    }

    fn load_one(&self, path: PathBuf, id: String) {
        self.stop_one(&id);
        let enabled = self
            .registry
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .states
            .get(&id)
            .copied()
            .unwrap_or(false);
        let previous_stopping = {
            let mut retiring = self.retiring.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(worker) = retiring.remove(&id) {
                if let Some(worker) = join_worker(worker, Duration::from_millis(100)) {
                    retiring.insert(id.clone(), worker);
                    true
                } else {
                    false
                }
            } else {
                false
            }
        };
        let source = if previous_stopping {
            Err("previous plugin worker is still stopping; retry reload".to_string())
        } else {
            std::fs::File::open(&path)
                .map_err(|e| e.to_string())
                .and_then(|file| read_limited(file, MAX_SOURCE))
                .and_then(|bytes| validate_source(&bytes).map(str::to_owned))
        };
        if !enabled || source.is_err() {
            let mut reg = self.registry.lock().unwrap_or_else(|e| e.into_inner());
            if !reg.order.contains(&id) {
                reg.order.push(id.clone());
            }
            reg.plugins.insert(
                id.clone(),
                PluginEntry {
                    id: id.clone(),
                    name: id,
                    version: String::new(),
                    enabled,
                    loaded: false,
                    error: source.err(),
                    tx: None,
                    thread: None,
                    cancelled: Arc::new(AtomicBool::new(false)),
                },
            );
            return;
        }
        let source = source.expect("validated source");
        let tx = self.host_tx.clone();
        let (worker_tx, worker_rx) = channel::<WorkerMsg>();
        let (meta_tx, meta_rx) = channel::<Result<(String, String), String>>();
        let worker_reply = worker_tx.clone();
        let registry = Arc::clone(&self.registry);
        let cancelled = Arc::new(AtomicBool::new(false));
        let worker_cancelled = Arc::clone(&cancelled);

        let id_c = id.clone();
        let thread = std::thread::Builder::new()
            .name(format!("wave-plugin:{id}"))
            .spawn(move || {
                let budget = Arc::new(AtomicU64::new(0));
                let lua = match limited_lua(Arc::clone(&worker_cancelled), Arc::clone(&budget)) {
                    Ok(lua) => lua,
                    Err(error) => { let _ = meta_tx.send(Err(error.to_string())); return; }
                };
                let events = match lua.create_table() {
                    Ok(t) => t,
                    Err(e) => {
                        let _ = tx.send(HostMsg::Log {
                            plugin: id_c.clone(),
                            line: format!("lua init error: {e}"),
                        });
                        return;
                    }
                };
                let state: Arc<Mutex<Option<serde_json::Value>>> = Arc::new(Mutex::new(None));
                if let Err(e) = lua.globals().set("wave_events", events.clone()) {
                    let _ = tx.send(HostMsg::Log {
                        plugin: id_c.clone(),
                        line: format!("lua init error: {e}"),
                    });
                    return;
                }

                let set_api = |lua: &Lua| -> mlua::Result<()> {
                    let wave = lua.create_table()?;

                    let tx_c = tx.clone();
                    let id_p = id_c.clone();
                    wave.set(
                        "log",
                        lua.create_function(move |_lua, msg: String| {
                            let _ = tx_c.send(HostMsg::Log {
                                plugin: id_p.clone(),
                                line: msg,
                            });
                            Ok(())
                        })?,
                    )?;

                    let tx_c = tx.clone();
                    wave.set(
                        "notify",
                        lua.create_function(move |_lua, (title, body): (String, String)| {
                            let _ = tx_c.send(HostMsg::Notify { title, body });
                            Ok(())
                        })?,
                    )?;

                    let mk_hook = |name: &str| {
                        let events_c = events.clone();
                        let n = name.to_string();
                        lua.create_function(move |lua, handler: Value| {
                            register_handler(lua, &events_c, &n, handler)
                        })
                    };
                    let mut hooks: HashMap<&str, mlua::Function> = HashMap::new();
                    for name in [
                        "track",
                        "play",
                        "pause",
                        "state",
                        "queue",
                        "volume",
                        "shuffle",
                        "repeat",
                        "ended",
                        "skip",
                    ] {
                        let hook = mk_hook(name)?;
                        wave.set(format!("on_{name}"), hook.clone())?;
                        hooks.insert(name, hook);
                    }
                    for (alias, target) in [
                        ("on_track_change", "track"),
                        ("on_queue_change", "queue"),
                        ("on_volume_change", "volume"),
                        ("on_shuffle_change", "shuffle"),
                        ("on_repeat_change", "repeat"),
                        ("on_track_end", "ended"),
                    ] {
                        if let Some(hook) = hooks.get(target) {
                            wave.set(alias, hook.clone())?;
                        }
                    }
                    let events_c = events.clone();
                    wave.set(
                        "on",
                        lua.create_function(move |lua, (event, handler): (String, Value)| {
                            register_handler(lua, &events_c, &event, handler)
                        })?,
                    )?;

                    let state_c = Arc::clone(&state);
                    wave.set(
                        "get_state",
                        lua.create_function(move |lua, _: ()| -> mlua::Result<Value> {
                            let value = state_c.lock().unwrap_or_else(|e| e.into_inner()).clone();
                            match value {
                                Some(v) => json_to_lua(lua, &v),
                                None => Ok(Value::Table(lua.create_table()?)),
                            }
                        })?,
                    )?;

                    let noarg = |method: &str| {
                        let tx_c = tx.clone();
                        let m = method.to_string();
                        lua.create_function(move |_lua, _: ()| {
                            let _ = tx_c.send(HostMsg::Control {
                                method: m.clone(),
                                args: json!([]),
                            });
                            Ok(())
                        })
                    };
                    for m in ["play", "pause", "stop", "toggle", "next", "prev"] {
                        wave.set(m, noarg(m)?)?;
                    }

                    let numarg = |method: &str| {
                        let tx_c = tx.clone();
                        let m = method.to_string();
                        lua.create_function(move |_lua, value: f64| {
                            let _ = tx_c.send(HostMsg::Control {
                                method: m.clone(),
                                args: serde_json::json!([value]),
                            });
                            Ok(())
                        })
                    };
                    for m in ["seek", "jump", "set_volume"] {
                        wave.set(m, numarg(m)?)?;
                    }

                    let tx_c = tx.clone();
                    wave.set(
                        "set_shuffle",
                        lua.create_function(move |_lua, value: bool| {
                            let _ = tx_c.send(HostMsg::Control {
                                method: "set_shuffle".into(),
                                args: serde_json::json!([value]),
                            });
                            Ok(())
                        })?,
                    )?;

                    let tx_c = tx.clone();
                    wave.set(
                        "set_repeat",
                        lua.create_function(move |_lua, mode: String| {
                            let _ = tx_c.send(HostMsg::Control {
                                method: "set_repeat".into(),
                                args: serde_json::json!([mode]),
                            });
                            Ok(())
                        })?,
                    )?;

                    let config_registry = Arc::clone(&registry);
                    let config_id = id_c.clone();
                    wave.set("get_config", lua.create_function(move |lua, (key, default): (String, Option<Value>)| {
                        let default = default.map(|value| lua.from_value::<serde_json::Value>(value)).transpose()?.unwrap_or(serde_json::Value::Null);
                        let reg = config_registry.lock().unwrap_or_else(|e| e.into_inner());
                        json_to_lua(lua, &config_lookup(&reg, &config_id, &json!({"key":key,"default":default})))
                    })?)?;
                    let config_registry = Arc::clone(&registry);
                    let config_id = id_c.clone();
                    wave.set("set_config", lua.create_function(move |lua, (key, value): (String, Value)| {
                        let value: serde_json::Value = lua.from_value(value)?;
                        let mut reg = config_registry.lock().unwrap_or_else(|e| e.into_inner());
                        let mut next = reg.configs.clone();
                        let config = next.entry(config_id.clone()).or_insert_with(|| json!({}));
                        config.as_object_mut().ok_or_else(|| mlua::Error::RuntimeError("invalid plugin config".into()))?.insert(key, value);
                        let bytes = serde_json::to_vec_pretty(&next).map_err(mlua::Error::external)?;
                        if bytes.len() as u64 > MAX_SOURCE { return Err(mlua::Error::RuntimeError("plugin config is too large".into())); }
                        write_atomic(&reg.configs_path, &bytes, true).map_err(mlua::Error::external)?;
                        reg.configs = next;
                        Ok(())
                    })?)?;

                    let mk_data_get = |kind: &str| {
                        let tx_c = tx.clone();
                        let k = kind.to_string();
                        lua.create_function(
                            move |lua, _: ()| -> mlua::Result<Value> {
                                let (reply_tx, reply_rx) = channel::<Option<serde_json::Value>>();
                                let req_id = next_request_id();
                                let _ = tx_c.send(HostMsg::DataGet {
                                    kind: k.clone(),
                                    req_id,
                                    reply: reply_tx,
                                });
                                match reply_rx.recv_timeout(PLUGIN_DATA_TIMEOUT) {
                                    Ok(Some(v)) => json_to_lua(lua, &v),
                                    _ => Ok(Value::Nil),
                                }
                            },
                        )
                    };
                    for kind in ["playlists", "liked", "history"] {
                        let f = mk_data_get(kind)?;
                        wave.set(format!("get_{kind}"), f)?;
                    }

                    let tx_c = tx.clone();
                    let reply1 = worker_reply.clone();
                    wave.set(
                        "http_get",
                        lua.create_function(move |lua, args: mlua::Variadic<Value>| {
                            let mut it = args.into_iter();
                            let Some(url) = str_from_value(it.next().unwrap_or(Value::Nil))?
                            else {
                                return Err(callback_error("http_get: url is required"));
                            };
                            let mut headers = HashMap::new();
                            let cb = match it.next().unwrap_or(Value::Nil) {
                                Value::Function(f) => Value::Function(f),
                                Value::Table(t) => {
                                    for (k, v) in t.clone().pairs::<String, String>().flatten() {
                                        {

                                            headers.insert(k, v);
                                        }
                                    }
                                    it.next().unwrap_or(Value::Nil)
                                }
                                other => other,
                            };
                            if !matches!(cb, Value::Function(_)) {
                                return Err(callback_error("http_get: callback expected"));
                            }
                            let id = next_request_id();
                            store_pending(lua, id, cb)?;
                            let _ = tx_c.send(HostMsg::Http {
                                reply: reply1.clone(),
                                id,
                                url,
                                headers,
                            });
                            Ok(())
                        })?,
                    )?;

                    let tx_c = tx.clone();
                    let reply2 = worker_reply.clone();
                    wave.set(
                        "search",
                        lua.create_function(move |lua, args: mlua::Variadic<Value>| {
                            let mut it = args.into_iter();
                            let Some(query) = str_from_value(it.next().unwrap_or(Value::Nil))?
                            else {
                                return Err(callback_error("search: query is required"));
                            };
                            let mut provider = None;
                            let cb = match it.next().unwrap_or(Value::Nil) {
                                Value::Function(f) => Value::Function(f),
                                Value::String(p) => {
                                    provider = Some(p.to_str()?.to_string());
                                    it.next().unwrap_or(Value::Nil)
                                }
                                other => other,
                            };
                            let id = next_request_id();
                            store_pending(lua, id, cb)?;
                            let _ = tx_c.send(HostMsg::Search {
                                reply: reply2.clone(),
                                id,
                                query,
                                provider,
                            });
                            Ok(())
                        })?,
                    )?;

                    let tx_c = tx.clone();
                    let reply3 = worker_reply.clone();
                    wave.set(
                        "exec",
                        lua.create_function(move |lua, args: mlua::Variadic<Value>| {
                            let mut it = args.into_iter();
                            let Some(cmd) = str_from_value(it.next().unwrap_or(Value::Nil))?
                            else {
                                return Err(callback_error("exec: command is required"));
                            };
                            let mut exec_args = Vec::new();
                            let cb = match it.next().unwrap_or(Value::Nil) {
                                Value::Table(t) => {
                                    for v in t.clone().sequence_values::<Value>().flatten() {
                                        if let Ok(Some(s)) = str_from_value(v) {
                                            exec_args.push(s);
                                        }
                                    }
                                    it.next().unwrap_or(Value::Nil)
                                }
                                other => other,
                            };
                            let allowed: Vec<String> =
                                match lua.globals().get::<Table>("wave_plugin") {
                                    Ok(t) => match t.get::<Option<Vec<String>>>("allowed_commands")? {
                                        Some(list) => list,
                                        None => {
                                            return Err(mlua::Error::RuntimeError(
                                                "exec disabled: add allowed_commands = {...} to wave_plugin table"
                                                    .into(),
                                            ))
                                        }
                                    },
                                    Err(_) => {
                                        return Err(mlua::Error::RuntimeError(
                                            "exec disabled: wave_plugin table with allowed_commands is required"
                                                .into(),
                                        ))
                                    }
                                };
                            if !allowed.contains(&cmd) {
                                return Err(mlua::Error::RuntimeError(format!(
                                    "exec: '{cmd}' is not in allowed_commands"
                                )));
                            }
                            let id = next_request_id();
                            store_pending(lua, id, cb)?;
                            let _ = tx_c.send(HostMsg::Exec {
                                reply: reply3.clone(),
                                id,
                                cmd,
                                args: exec_args,
                            });
                            Ok(())
                        })?,
                    )?;

                    lua.globals().set("wave", wave)?;
                    Ok(())
                };

                if let Err(e) = set_api(&lua).and_then(|_| {
                    budget.store(0, Ordering::Relaxed);
                    run_limited(|| lua.load(&source)
                        .set_name(format!("{id_c}.lua"))
                        .exec())
                }) {
                    let _ = tx.send(HostMsg::Log {
                        plugin: id_c.clone(),
                        line: format!("load error: {e}"),
                    });
                    let _ = meta_tx.send(Err(e.to_string()));
                    return;
                }
                let (name, version) = extract_meta(&lua, &id_c);
                let _ = meta_tx.send(Ok((name, version)));

                while !worker_cancelled.load(Ordering::Relaxed) {
                    match worker_rx.recv() {
                        Ok(WorkerMsg::Shutdown) => {
                            let _ = tx.send(HostMsg::Log {
                                plugin: id_c.clone(),
                                line: "plugin stopped".into(),
                            });
                            break;
                        }
                        Ok(WorkerMsg::State(value)) => {
                            if let Ok(mut s) = state.lock() {
                                *s = Some(value.clone());
                            }
                            dispatch_event(&lua, &events, "state", Some(&value), &tx, &id_c, &budget);
                        }
                        Ok(WorkerMsg::Event { name, payload }) => {
                            dispatch_event(&lua, &events, &name, payload.as_ref(), &tx, &id_c, &budget);
                        }
                        Ok(WorkerMsg::AsyncResult { id, value }) => {
                            if let Ok(function) = take_pending(&lua, id) {
                                let arg = value.as_ref().and_then(|v| json_to_lua(&lua, v).ok());
                                let _ = call_handler(function, arg, &tx, &id_c, &budget);
                            }
                        }
                        Err(_) => break,
                    }
                }
            })
            .ok();

        let loaded_meta = meta_rx
            .recv_timeout(Duration::from_secs(6))
            .unwrap_or_else(|_| Err("plugin load timed out".into()));
        let (name, version, error) = match loaded_meta {
            Ok((name, version)) => (name, version, None),
            Err(error) => {
                cancelled.store(true, Ordering::Relaxed);
                (id.clone(), String::new(), Some(error))
            }
        };
        let loaded = error.is_none() && thread.is_some();
        let mut reg = self.registry.lock().unwrap_or_else(|e| e.into_inner());
        if !reg.order.contains(&id) {
            reg.order.push(id.clone());
        }
        if loaded {
            if let Some(value) = reg.latest_state.clone() {
                let _ = worker_tx.send(WorkerMsg::State(value));
            }
        }
        reg.plugins.insert(
            id.clone(),
            PluginEntry {
                id,
                name,
                version,
                enabled,
                loaded,
                error,
                tx: Some(worker_tx),
                thread,
                cancelled,
            },
        );
    }

    fn stop_one(&self, id: &str) {
        let entry = self
            .registry
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .plugins
            .remove(id);
        if let Some(mut entry) = entry {
            entry.cancelled.store(true, Ordering::Relaxed);
            if let Some(tx) = entry.tx.take() {
                let _ = tx.send(WorkerMsg::Shutdown);
            }
            // Never wait while holding the registry mutex: a worker may be reading config.
            if let Some(thread) = entry.thread.take() {
                if let Some(thread) = join_worker(thread, Duration::from_millis(100)) {
                    self.retiring
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .insert(id.to_string(), thread);
                }
            }
        }
    }

    fn shutdown_all(&self) {
        let ids = {
            let mut reg = self.registry.lock().unwrap_or_else(|e| e.into_inner());
            reg.req_owner.clear();
            reg.data_pending.clear();
            reg.order.clear();
            reg.plugins.keys().cloned().collect::<Vec<_>>()
        };
        for id in ids {
            self.stop_one(&id);
        }
    }

    pub fn reload(&self) {
        let _lifecycle = self.lifecycle.lock().unwrap_or_else(|e| e.into_inner());
        self.shutdown_all();
        if let Ok(read) = std::fs::read_dir(&self.dir) {
            let mut files: Vec<PathBuf> = read
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.extension().map(|x| x == "lua").unwrap_or(false) && p.is_file())
                .collect();
            files.sort();
            for file in files {
                let id = file
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                if id.is_empty() {
                    continue;
                }
                self.load_one(file, id);
            }
        }
    }

    pub fn list(&self) -> Vec<PluginInfo> {
        let reg = match self.registry.lock() {
            Ok(g) => g,
            Err(e) => e.into_inner(),
        };
        let mut out = Vec::new();
        for id in &reg.order {
            if let Some(entry) = reg.plugins.get(id) {
                let log = reg
                    .logs
                    .get(id)
                    .map(|q| q.iter().cloned().collect())
                    .unwrap_or_default();
                out.push(PluginInfo {
                    id: entry.id.clone(),
                    name: entry.name.clone(),
                    version: entry.version.clone(),
                    enabled: entry.enabled,
                    loaded: entry.loaded,
                    error: entry.error.clone(),
                    log,
                });
            }
        }
        out
    }

    pub fn set_enabled(&self, id: &str, enabled: bool) -> Result<(), String> {
        let _lifecycle = self.lifecycle.lock().unwrap_or_else(|e| e.into_inner());
        {
            let mut reg = self.registry.lock().unwrap_or_else(|e| e.into_inner());
            if !reg.plugins.contains_key(id) {
                return Err("unknown plugin".into());
            }
            let mut states = reg.states.clone();
            states.insert(id.to_string(), enabled);
            write_atomic(
                &reg.states_path,
                &serde_json::to_vec_pretty(&states).map_err(|e| e.to_string())?,
                true,
            )?;
            reg.states = states;
        }
        self.load_one(self.dir.join(format!("{id}.lua")), id.to_string());
        Ok(())
    }

    pub fn push_event(&self, name: &str, value: Option<serde_json::Value>) {
        let reg = match self.registry.lock() {
            Ok(g) => g,
            Err(e) => e.into_inner(),
        };
        for entry in reg.plugins.values() {
            if !entry.enabled || !entry.loaded {
                continue;
            }
            if let Some(tx) = &entry.tx {
                let _ = tx.send(WorkerMsg::Event {
                    name: name.to_string(),
                    payload: value.clone(),
                });
            }
        }
    }

    pub fn push_state(&self, value: serde_json::Value) {
        let mut reg = match self.registry.lock() {
            Ok(g) => g,
            Err(e) => e.into_inner(),
        };
        reg.latest_state = Some(value.clone());
        for entry in reg.plugins.values() {
            if !entry.enabled || !entry.loaded {
                continue;
            }
            if let Some(tx) = &entry.tx {
                let _ = tx.send(WorkerMsg::State(value.clone()));
            }
        }
    }

    pub fn search_result(&self, req_id: u64, value: serde_json::Value) {
        if let Ok(mut g) = self.registry.lock() {
            if let Some(tx) = g.worker_tx(req_id) {
                g.push(
                    &tx,
                    WorkerMsg::AsyncResult {
                        id: req_id,
                        value: Some(value),
                    },
                );
            }
        }
    }

    pub fn data_result(&self, req_id: u64, value: serde_json::Value) {
        if let Ok(mut g) = self.registry.lock() {
            if let Some((reply, _)) = g.data_pending.remove(&req_id) {
                let _ = reply.send(Some(value));
            }
        }
    }

    pub fn install(&self, url: &str) -> Result<String, String> {
        let parsed = reqwest::Url::parse(url).map_err(|e| e.to_string())?;
        if parsed.scheme() != "https" {
            return Err("plugin URL must use HTTPS".into());
        }
        let name = plugin_filename(url)?;
        let client = self
            .registry
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .client
            .clone();
        let resp = client
            .get(url)
            .timeout(REQUEST_TIMEOUT)
            .send()
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?;
        let body = read_limited(resp, MAX_SOURCE)?;
        validate_source(&body)?;
        let _lifecycle = self.lifecycle.lock().unwrap_or_else(|e| e.into_inner());
        let path = self.dir.join(&name);
        // New downloads are inactive until explicitly enabled. Existing plugins are preserved.
        let id = name.trim_end_matches(".lua").to_string();
        {
            let mut reg = self.registry.lock().unwrap_or_else(|e| e.into_inner());
            let mut states = reg.states.clone();
            states.insert(id.clone(), false);
            if path.exists() {
                return Err("plugin already exists; choose a different filename".into());
            }
            write_atomic(
                &reg.states_path,
                &serde_json::to_vec_pretty(&states).map_err(|e| e.to_string())?,
                true,
            )?;
            reg.states = states;
        }
        write_atomic(&path, &body, false)?;
        self.load_one(path, id);
        Ok(name)
    }

    pub fn open_dir(&self, app: &AppHandle) {
        let _ = app;
        let _ = std::fs::create_dir_all(&self.dir);
        #[cfg(not(target_os = "android"))]
        {
            let _ = tauri_plugin_opener::open_path(&self.dir, None::<&str>);
        }
    }
}

impl Drop for PluginHost {
    fn drop(&mut self) {
        if Arc::strong_count(&self.lifecycle) == 1 {
            self.shutdown_all();
        }
    }
}

fn callback_error(msg: &str) -> mlua::Error {
    mlua::Error::SyntaxError {
        message: msg.to_string(),
        incomplete_input: false,
    }
}

fn str_from_value(value: Value) -> mlua::Result<Option<String>> {
    match value {
        Value::String(s) => Ok(Some(s.to_str()?.to_string())),
        Value::Nil | Value::Boolean(_) | Value::Number(_) => Ok(None),
        other => Ok(Some(other.to_string()?)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn host_with_scripts(
        scripts: &[(&str, &str)],
    ) -> (
        tempfile::TempDir,
        PluginHost,
        Receiver<(String, serde_json::Value)>,
    ) {
        let dir = tempfile::tempdir().unwrap();
        for (name, source) in scripts {
            std::fs::write(dir.path().join(format!("{name}.lua")), source).unwrap();
        }
        let (tx, rx) = channel();
        let host = PluginHost::with_events(
            dir.path().to_owned(),
            Arc::new(move |name, value| {
                tx.send((name.to_string(), value))
                    .map_err(|e| e.to_string())
            }),
        );
        host.reload();
        (dir, host, rx)
    }

    #[test]
    fn a_still_stopping_worker_cannot_be_replaced() {
        let (_dir, host, _events) = host_with_scripts(&[("slow", "wave_plugin = {name='Slow'}")]);
        let (tx, rx) = channel();
        let worker = std::thread::spawn(move || {
            let _ = rx.recv();
        });
        host.retiring.lock().unwrap().insert("slow".into(), worker);
        host.set_enabled("slow", true).unwrap();
        let info = host.list().into_iter().find(|p| p.id == "slow").unwrap();
        assert!(!info.loaded);
        assert!(info.error.unwrap().contains("still stopping"));
        tx.send(()).unwrap();
        host.reload();
        assert!(host.list().iter().any(|p| p.id == "slow" && p.loaded));
        host.shutdown_all();
    }

    #[test]
    fn protected_infinite_loop_is_reported_as_a_load_failure() {
        let (_dir, host, _events) = host_with_scripts(&[(
            "loop",
            "while true do pcall(function() while true do end end) end",
        )]);
        host.set_enabled("loop", true).unwrap();
        let info = host.list().into_iter().find(|p| p.id == "loop").unwrap();
        assert!(!info.loaded);
        assert!(info.error.unwrap().contains("instruction budget"));
        host.set_enabled("loop", false).unwrap();
        host.shutdown_all();
    }

    #[test]
    fn disabled_plugins_never_execute_on_reload() {
        let (_dir, host, events) =
            host_with_scripts(&[("inactive", "wave.notify('test', 'executed')")]);
        assert!(!host.list()[0].loaded);
        assert!(events.try_recv().is_err());
        host.set_enabled("inactive", true).unwrap();
        assert_eq!(
            events.recv_timeout(Duration::from_secs(1)).unwrap().0,
            "wave-plugin-notify"
        );
        host.set_enabled("inactive", false).unwrap();
        host.reload();
        assert!(!host.list()[0].enabled);
        assert!(!host.list()[0].loaded);
        assert!(events.recv_timeout(Duration::from_millis(50)).is_err());
    }

    #[test]
    fn runtime_load_errors_are_reported_as_failures() {
        let (_dir, host, _) = host_with_scripts(&[("broken", "error('intentional load failure')")]);
        host.set_enabled("broken", true).unwrap();
        let entry = &host.list()[0];
        assert!(!entry.loaded);
        assert!(entry
            .error
            .as_ref()
            .unwrap()
            .contains("intentional load failure"));
    }

    #[test]
    fn real_config_api_persists_across_worker_restarts() {
        let (dir, host, events) = host_with_scripts(&[(
            "config",
            r#"
            local count = wave.get_config("count", 0)
            wave.set_config("count", count + 1)
            wave.notify("count", tostring(wave.get_config("count", 0)))
        "#,
        )]);
        host.set_enabled("config", true).unwrap();
        assert_eq!(
            events.recv_timeout(Duration::from_secs(1)).unwrap().1["body"],
            "1"
        );
        host.reload();
        assert_eq!(
            events.recv_timeout(Duration::from_secs(1)).unwrap().1["body"],
            "2"
        );
        let persisted: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.path().join("plugin-configs.json")).unwrap())
                .unwrap();
        assert_eq!(persisted["config"]["count"], 2);
    }

    #[test]
    fn two_plugins_receive_their_own_search_replies_in_reverse_order() {
        let (_dir, host, events) = host_with_scripts(&[
            (
                "a",
                r#"wave.search("a", function(r) wave.notify("a", r.query) end)"#,
            ),
            (
                "b",
                r#"wave.search("b", function(r) wave.notify("b", r.query) end)"#,
            ),
        ]);
        host.set_enabled("a", true).unwrap();
        host.set_enabled("b", true).unwrap();
        let a = events.recv_timeout(Duration::from_secs(1)).unwrap().1;
        let b = events.recv_timeout(Duration::from_secs(1)).unwrap().1;
        assert_ne!(a["reqId"], b["reqId"]);
        host.search_result(b["reqId"].as_u64().unwrap(), json!({"query": b["query"]}));
        host.search_result(a["reqId"].as_u64().unwrap(), json!({"query": a["query"]}));
        for _ in 0..2 {
            let (name, reply) = events.recv_timeout(Duration::from_secs(1)).unwrap();
            assert_eq!(name, "wave-plugin-notify");
            assert_eq!(reply["title"], reply["body"]);
        }
    }

    #[test]
    fn stale_search_response_is_not_delivered_to_reloaded_worker() {
        let (_dir, host, events) = host_with_scripts(&[(
            "a",
            r#"wave.search("a", function(r) wave.notify("result", r.query) end)"#,
        )]);
        host.set_enabled("a", true).unwrap();
        let old = events.recv_timeout(Duration::from_secs(1)).unwrap().1["reqId"]
            .as_u64()
            .unwrap();
        host.reload();
        let new = events.recv_timeout(Duration::from_secs(1)).unwrap().1["reqId"]
            .as_u64()
            .unwrap();
        host.search_result(old, json!({"query":"stale"}));
        host.search_result(new, json!({"query":"current"}));
        assert_eq!(
            events.recv_timeout(Duration::from_secs(1)).unwrap().1["body"],
            "current"
        );
        assert!(events.recv_timeout(Duration::from_millis(50)).is_err());
    }

    fn fake_wave(lua: &Lua) -> mlua::Result<()> {
        let wave = lua.create_table()?;
        let events = lua.create_table()?;
        lua.globals().set("wave_events", events.clone())?;
        wave.set("log", lua.create_function(|_lua, _msg: String| Ok(()))?)?;
        wave.set(
            "notify",
            lua.create_function(|_lua, (_t, _b): (String, String)| Ok(()))?,
        )?;
        let mk = |name: &str| {
            let events = events.clone();
            let n = name.to_string();
            lua.create_function(move |lua, handler: Value| {
                register_handler(lua, &events, &n, handler)
            })
        };
        for name in [
            "track", "play", "pause", "state", "queue", "volume", "shuffle", "repeat", "ended",
            "skip",
        ] {
            wave.set(format!("on_{name}"), mk(name)?)?;
        }
        for (alias, target) in [
            ("on_track_change", "track"),
            ("on_queue_change", "queue"),
            ("on_volume_change", "volume"),
            ("on_shuffle_change", "shuffle"),
            ("on_repeat_change", "repeat"),
            ("on_track_end", "ended"),
        ] {
            wave.set(alias, mk(target)?)?;
        }
        let events = events.clone();
        wave.set(
            "on",
            lua.create_function(move |lua, (event, handler): (String, Value)| {
                register_handler(lua, &events, &event, handler)
            })?,
        )?;
        wave.set(
            "get_state",
            lua.create_function(|lua, _: ()| Ok(Value::Table(lua.create_table()?)))?,
        )?;
        for m in [
            "play",
            "pause",
            "stop",
            "toggle",
            "next",
            "prev",
            "seek",
            "jump",
            "set_volume",
            "set_shuffle",
            "set_repeat",
        ] {
            wave.set(m, lua.create_function(|_lua, _: mlua::MultiValue| Ok(()))?)?;
        }
        for m in [
            "get_config",
            "set_config",
            "get_playlists",
            "get_liked",
            "get_history",
        ] {
            wave.set(
                m,
                lua.create_function(|_lua, _: mlua::MultiValue| Ok(Value::Nil))?,
            )?;
        }
        lua.globals().set("wave", wave)?;
        Ok(())
    }

    #[test]
    fn example_plugin_loads() {
        let lua = Lua::new();
        fake_wave(&lua).expect("api setup");
        lua.load(EXAMPLE_PLUGIN)
            .set_name("hello_wave.lua")
            .exec()
            .expect("example plugin should load and register hooks");
    }
}
