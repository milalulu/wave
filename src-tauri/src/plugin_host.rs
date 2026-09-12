use mlua::{Lua, Table, Value};
use serde::Serialize;
use serde_json::json;
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const EXAMPLE_PLUGIN: &str = r#"-- ============================================================
-- Hello Wave — пример плагина для Wave.
-- Файл лежит в папке плагинов (Plugins -> Open plugins folder).
-- Включи его в настройках (Plugins -> toggle) и перезагрузи.
-- ============================================================

wave_plugin = {
  name = "Hello Wave",
  version = "1.0.0",
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

-- Запуск внешней команды.
-- wave.exec("echo", {"hello from wave"}, function(res)
--     wave.log("exec code=" .. (res.code or "?"))
-- end)

-- Поиск треков (результаты приходят в обратный вызов).
-- wave.search("Daft Punk Da Funk", function(results)
--     local first = (results and results[1] and results[1].title) or "none"
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
        plugin: String,
        id: u64,
        url: String,
        headers: HashMap<String, String>,
    },
    Exec {
        plugin: String,
        id: u64,
        cmd: String,
        args: Vec<String>,
    },
    Search {
        plugin: String,
        id: u64,
        query: String,
        provider: Option<String>,
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
}

struct Registry {
    app: AppHandle,
    plugins: HashMap<String, PluginEntry>,
    order: Vec<String>,
    states: HashMap<String, bool>,
    states_path: PathBuf,
    req_owner: HashMap<u64, String>,
    logs: HashMap<String, VecDeque<String>>,
    client: reqwest::blocking::Client,
}

impl Registry {
    fn app_handle(&self) -> AppHandle {
        self.app.clone()
    }

    fn worker_tx(&mut self, id: u64) -> Option<Sender<WorkerMsg>> {
        let plugin = self.req_owner.remove(&id)?;
        self.plugins.get(&plugin).and_then(|e| e.tx.clone())
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
            let status_text = resp
                .status()
                .canonical_reason()
                .unwrap_or("")
                .to_string();
            let mut hdr = serde_json::Map::new();
            for (k, v) in resp.headers() {
                if let Ok(vs) = v.to_str() {
                    hdr.insert(k.to_string(), serde_json::Value::String(vs.to_string()));
                }
            }
            let body = resp.bytes().unwrap_or_else(|_| Vec::new().into());
            const MAX_BODY: usize = 2_000_000;
            let slice = &body[..body.len().min(MAX_BODY)];
            json!({
                "status": status,
                "statusText": status_text,
                "headers": serde_json::Value::Object(hdr),
                "body": String::from_utf8_lossy(slice),
                "truncated": body.len() > MAX_BODY,
            })
        }
        Err(e) => json!({ "error": e.to_string() }),
    }
}

fn pump_loop(rx: Receiver<HostMsg>, registry: Arc<Mutex<Registry>>) {
    loop {
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
                    let _ = g.app_handle().emit(
                        "wave-plugin-control",
                        json!({ "method": method, "args": args }),
                    );
                }
            }
            HostMsg::Notify { title, body } => {
                if let Ok(g) = registry.lock() {
                    let _ = g.app_handle().emit(
                        "wave-plugin-notify",
                        json!({ "title": title, "body": body }),
                    );
                }
            }
            HostMsg::Http {
                plugin,
                id,
                url,
                headers,
            } => {
                {
                    if let Ok(mut g) = registry.lock() {
                        g.req_owner.insert(id, plugin);
                    }
                }
                let client = registry
                    .lock()
                    .map(|g| g.client.clone())
                    .unwrap_or_else(|_| reqwest::blocking::Client::new());
                let (tx_out, rx_out) = channel::<serde_json::Value>();
                let url_c = url.clone();
                let headers_c = headers.clone();
                std::thread::spawn(move || {
                    let _ = tx_out.send(do_http(&client, &url_c, &headers_c));
                });
                let value = match rx_out.recv_timeout(Duration::from_secs(20)) {
                    Ok(v) => Some(v),
                    Err(_) => Some(json!({ "error": "http timeout" })),
                };
                if let Ok(mut g) = registry.lock() {
                    if let Some(tx) = g.worker_tx(id) {
                        g.push(&tx, WorkerMsg::AsyncResult { id, value });
                    }
                }
            }
            HostMsg::Exec {
                plugin,
                id,
                cmd,
                args,
            } => {
                {
                    if let Ok(mut g) = registry.lock() {
                        g.req_owner.insert(id, plugin);
                    }
                }
                let value = std::process::Command::new(&cmd)
                    .args(&args)
                    .output()
                    .map(|out| {
                        json!({
                            "code": out.status.code(),
                            "stdout": String::from_utf8_lossy(&out.stdout),
                            "stderr": String::from_utf8_lossy(&out.stderr),
                        })
                    })
                    .unwrap_or_else(|e| json!({ "error": e.to_string() }));
                if let Ok(mut g) = registry.lock() {
                    if let Some(tx) = g.worker_tx(id) {
                        g.push(&tx, WorkerMsg::AsyncResult {
                            id,
                            value: Some(value),
                        });
                    }
                }
            }
            HostMsg::Search {
                plugin,
                id,
                query,
                provider,
            } => {
                if let Ok(mut g) = registry.lock() {
                    g.req_owner.insert(id, plugin);
                    let _ = g.app_handle().emit(
                        "wave-plugin-search",
                        json!({
                            "reqId": id,
                            "query": query,
                            "provider": provider,
                        }),
                    );
                }
            }
        }
    }
}

fn store_pending(lua: &Lua, id: u64, cb: Value) -> mlua::Result<()> {
    let globals = lua.globals();
    let t: Table = match globals.get::<Option<Table>>("wave_pending")? {
        Some(t) => t,
        None => {
            let t = lua.create_table()?;
            globals.set("wave_pending", t.clone())?;
            t
        }
    };
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
) -> mlua::Result<()> {
    if let Value::Function(f) = function {
        let result = match arg {
            Some(a) => f.call::<Value>(a),
            None => f.call::<Value>(()),
        };
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
        let _ = call_handler(function, arg, tx, plugin);
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

pub struct PluginHost {
    dir: PathBuf,
    registry: Arc<Mutex<Registry>>,
    host_tx: Sender<HostMsg>,
}

impl PluginHost {
    pub fn new(app: AppHandle, dir: PathBuf) -> PluginHost {
        let states_path = dir.join("plugin-states.json");
        let states = std::fs::read_to_string(&states_path)
            .ok()
            .and_then(|s| serde_json::from_str::<HashMap<String, bool>>(&s).ok())
            .unwrap_or_default();

        let client = reqwest::blocking::Client::builder()
            .user_agent("wave-plugin-host")
            .build()
            .unwrap_or_else(|_| reqwest::blocking::Client::new());

        let registry = Arc::new(Mutex::new(Registry {
            app,
            plugins: HashMap::new(),
            order: Vec::new(),
            states,
            states_path,
            req_owner: HashMap::new(),
            logs: HashMap::new(),
            client,
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
        };
        host.ensure_dir();
        host.reload();
        host
    }

    fn ensure_dir(&self) {
        if std::fs::create_dir_all(&self.dir).is_err() {
            return;
        }
        if let Ok(read) = std::fs::read_dir(&self.dir) {
            let has_lua = read.filter_map(|e| e.ok()).any(|e| {
                e.file_type().map(|t| t.is_file()).unwrap_or(false)
                    && e.path()
                        .extension()
                        .map(|x| x == "lua")
                        .unwrap_or(false)
            });
            if !has_lua {
                let example = self.dir.join("hello_wave.lua");
                let _ = std::fs::write(&example, EXAMPLE_PLUGIN);
            }
        }
    }

    fn load_one(&self, path: PathBuf, id: String) {
        let Some(source) = std::fs::read_to_string(&path).ok().filter(|s| !s.is_empty())
        else {
            return;
        };
        let tx = self.host_tx.clone();
        let (worker_tx, worker_rx) = channel::<WorkerMsg>();
        let (meta_tx, meta_rx) = channel::<(String, String)>();
        let req_counter = Arc::new(AtomicU64::new(1));

        let id_c = id.clone();
        let thread = std::thread::Builder::new()
            .name(format!("wave-plugin:{id}"))
            .spawn(move || {
                let lua = Lua::new();
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

                    let tx_c = tx.clone();
                    let req_c = Arc::clone(&req_counter);
                    let id_p1 = id_c.clone();
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
                            let id = req_c.fetch_add(1, Ordering::Relaxed);
                            store_pending(lua, id, cb)?;
                            let _ = tx_c.send(HostMsg::Http {
                                plugin: id_p1.clone(),
                                id,
                                url,
                                headers,
                            });
                            Ok(())
                        })?,
                    )?;

                    let tx_c = tx.clone();
                    let req_c = Arc::clone(&req_counter);
                    let id_p2 = id_c.clone();
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
                            let id = req_c.fetch_add(1, Ordering::Relaxed);
                            store_pending(lua, id, cb)?;
                            let _ = tx_c.send(HostMsg::Search {
                                plugin: id_p2.clone(),
                                id,
                                query,
                                provider,
                            });
                            Ok(())
                        })?,
                    )?;

                    let tx_c = tx.clone();
                    let req_c = Arc::clone(&req_counter);
                    let id_p3 = id_c.clone();
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
                            let id = req_c.fetch_add(1, Ordering::Relaxed);
                            store_pending(lua, id, cb)?;
                            let _ = tx_c.send(HostMsg::Exec {
                                plugin: id_p3.clone(),
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
                    lua.load(&source)
                        .set_name(format!("{id_c}.lua"))
                        .exec()
                }) {
                    let _ = tx.send(HostMsg::Log {
                        plugin: id_c.clone(),
                        line: format!("load error: {e}"),
                    });
                    let _ = meta_tx.send((id_c.clone(), String::new()));
                    return;
                }
                let (name, version) = extract_meta(&lua, &id_c);
                let _ = meta_tx.send((name, version));

                loop {
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
                            dispatch_event(&lua, &events, "state", Some(&value), &tx, &id_c);
                        }
                        Ok(WorkerMsg::Event { name, payload }) => {
                            dispatch_event(&lua, &events, &name, payload.as_ref(), &tx, &id_c);
                        }
                        Ok(WorkerMsg::AsyncResult { id, value }) => {
                            if let Ok(function) = take_pending(&lua, id) {
                                let arg = value.as_ref().and_then(|v| json_to_lua(&lua, v).ok());
                                let _ = call_handler(function, arg, &tx, &id_c);
                            }
                        }
                        Err(_) => break,
                    }
                }
            })
            .ok();

        let (name, version) = meta_rx
            .recv_timeout(Duration::from_secs(5))
            .unwrap_or_else(|_| (id.clone(), String::new()));

        let mut reg = match self.registry.lock() {
            Ok(g) => g,
            Err(e) => e.into_inner(),
        };
        if !reg.order.contains(&id) {
            reg.order.push(id.clone());
        }
        let enabled = reg.states.get(&id).copied().unwrap_or(true);
        let error = thread
            .as_ref()
            .is_none()
            .then(|| "failed to start thread".to_string());
        reg.plugins.insert(
            id.clone(),
            PluginEntry {
                id,
                name,
                version,
                enabled,
                loaded: thread.is_some(),
                error,
                tx: Some(worker_tx),
                thread,
            },
        );
    }

    fn shutdown_all(&self) {
        let mut reg = match self.registry.lock() {
            Ok(g) => g,
            Err(e) => e.into_inner(),
        };
        for entry in reg.plugins.values_mut() {
            if let Some(tx) = entry.tx.take() {
                let _ = tx.send(WorkerMsg::Shutdown);
            }
            if let Some(thread) = entry.thread.take() {
                let _ = thread.join();
            }
        }
        reg.plugins.clear();
        reg.order.clear();
    }

    pub fn reload(&self) {
        self.shutdown_all();
        if let Ok(read) = std::fs::read_dir(&self.dir) {
            let mut files: Vec<PathBuf> = read
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| {
                    p.extension().map(|x| x == "lua").unwrap_or(false) && p.is_file()
                })
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

    pub fn set_enabled(&self, id: &str, enabled: bool) {
        {
            let mut reg = match self.registry.lock() {
                Ok(g) => g,
                Err(e) => e.into_inner(),
            };
            reg.states.insert(id.to_string(), enabled);
            let _ = std::fs::write(
                &reg.states_path,
                serde_json::to_string_pretty(&reg.states).unwrap_or_else(|_| "{}".into()),
            );
            if !enabled {
                if let Some(entry) = reg.plugins.get_mut(id) {
                    entry.enabled = false;
                    entry.loaded = false;
                    entry.error = Some("disabled".into());
                    if let Some(tx) = entry.tx.take() {
                        let _ = tx.send(WorkerMsg::Shutdown);
                    }
                    if let Some(thread) = entry.thread.take() {
                        let _ = thread.join();
                    }
                }
            }
        }
        if enabled {
            if let Ok(read) = std::fs::read_dir(&self.dir) {
                if let Some(file) = read
                    .filter_map(|e| e.ok())
                    .map(|e| e.path())
                    .find(|p| {
                        p.extension().map(|x| x == "lua").unwrap_or(false)
                            && p.file_stem().map(|s| s == id).unwrap_or(false)
                    })
                {
                    self.load_one(file, id.to_string());
                }
            }
        }
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
        let reg = match self.registry.lock() {
            Ok(g) => g,
            Err(e) => e.into_inner(),
        };
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

    pub fn open_dir(&self, app: &AppHandle) {
        let _ = app;
        let _ = std::fs::create_dir_all(&self.dir);
        #[cfg(not(target_os = "android"))]
        {
            let _ = tauri_plugin_opener::open_path(&self.dir, None::<&str>);
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

    fn fake_wave(lua: &Lua) -> mlua::Result<()> {
        let wave = lua.create_table()?;
        let events = lua.create_table()?;
        lua.globals().set("wave_events", events.clone())?;
        wave.set(
            "log",
            lua.create_function(|_lua, _msg: String| Ok(()))?,
        )?;
        wave.set(
            "notify",
            lua.create_function(|_lua, (_t, _b): (String, String)| Ok(()))?,
        )?;
        let mk = |name: &str| {
            let events = events.clone();
            let n = name.to_string();
            lua.create_function(move |lua, handler: Value| register_handler(lua, &events, &n, handler))
        };
        for name in [
            "track", "play", "pause", "state", "queue", "volume", "shuffle", "repeat",
            "ended", "skip",
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
        for m in ["play", "pause", "stop", "toggle", "next", "prev", "seek", "jump", "set_volume", "set_shuffle", "set_repeat"] {
            wave.set(m, lua.create_function(|_lua, _: mlua::MultiValue| Ok(()))?)?;
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