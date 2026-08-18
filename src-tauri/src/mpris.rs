use serde_json::Value as JsonValue;
use std::collections::HashMap;
use std::sync::{Arc, OnceLock, RwLock};
use tauri::{AppHandle, Emitter};
use zbus::zvariant::{Array, ObjectPath, Value};
use zbus::{interface, Connection};

#[derive(Clone, Default)]
pub struct MprisState {
    pub playing: bool,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub art_url: Option<String>,
    pub duration: u64,
    pub position: u64,
    pub volume: f64,
    pub shuffle: bool,
    pub loop_status: String,
    pub can_next: bool,
    pub can_prev: bool,
}

static STATE: OnceLock<Arc<RwLock<MprisState>>> = OnceLock::new();
static CONN: OnceLock<Connection> = OnceLock::new();
static APP: OnceLock<AppHandle> = OnceLock::new();

fn state_arc() -> Arc<RwLock<MprisState>> {
    STATE
        .get_or_init(|| Arc::new(RwLock::new(MprisState::default())))
        .clone()
}

fn read_state() -> MprisState {
    state_arc().read().map(|g| g.clone()).unwrap_or_default()
}

fn loop_status(state: &MprisState) -> &str {
    match state.loop_status.as_str() {
        "one" => "Track",
        "all" => "Playlist",
        _ => "None",
    }
}

fn playback_status(state: &MprisState) -> &str {
    if state.playing {
        "Playing"
    } else if !state.title.is_empty() {
        "Paused"
    } else {
        "Stopped"
    }
}

fn length_usec(state: &MprisState) -> i64 {
    (state.duration.saturating_mul(1_000_000)).min(i64::MAX as u64) as i64
}

fn position_usec(state: &MprisState) -> i64 {
    (state.position.saturating_mul(1_000_000)).min(i64::MAX as u64) as i64
}

fn var<T: Into<Value<'static>>>(value: T) -> Value<'static> {
    Value::Value(Box::new(value.into()))
}

fn str_var(s: String) -> Value<'static> {
    var(Value::Str(s.into()))
}

fn metadata(state: &MprisState) -> HashMap<String, Value<'static>> {
    let mut md: HashMap<String, Value<'static>> = HashMap::new();
    if let Ok(track_id) = ObjectPath::try_from("/com/wave/Track/1") {
        md.insert("mpris:trackid".into(), var(track_id));
    }
    md.insert("xesam:title".into(), str_var(state.title.clone()));
    if let Some(artist) = &state.artist {
        md.insert(
            "xesam:artist".into(),
            var(Array::from(vec![artist.clone()])),
        );
    }
    if let Some(album) = &state.album {
        md.insert("xesam:album".into(), str_var(album.clone()));
    }
    if state.duration > 0 {
        md.insert("mpris:length".into(), var(Value::I64(length_usec(state))));
    }
    if let Some(url) = &state.art_url {
        md.insert("mpris:artUrl".into(), str_var(url.clone()));
    }
    md
}

fn changed_props(state: &MprisState) -> HashMap<String, Value<'static>> {
    let mut changed: HashMap<String, Value<'static>> = HashMap::new();
    changed.insert(
        "PlaybackStatus".into(),
        str_var(playback_status(state).into()),
    );
    changed.insert("LoopStatus".into(), str_var(loop_status(state).into()));
    changed.insert("Shuffle".into(), var(Value::Bool(state.shuffle)));
    changed.insert("Volume".into(), var(Value::F64(state.volume)));
    changed.insert("Metadata".into(), var(Value::Dict(metadata(state).into())));
    changed.insert("CanGoNext".into(), var(Value::Bool(state.can_next)));
    changed.insert("CanGoPrevious".into(), var(Value::Bool(state.can_prev)));
    changed
}

struct MprisRoot;

#[interface(name = "org.mpris.MediaPlayer2")]
impl MprisRoot {
    #[zbus(property)]
    fn identity(&self) -> String {
        "Wave".into()
    }

    #[zbus(property)]
    fn can_quit(&self) -> bool {
        true
    }

    #[zbus(property)]
    fn can_raise(&self) -> bool {
        false
    }

    #[zbus(property)]
    fn has_track_list(&self) -> bool {
        false
    }

    #[zbus(property)]
    fn supported_uri_schemes(&self) -> Vec<String> {
        vec![]
    }

    #[zbus(property)]
    fn supported_mime_types(&self) -> Vec<String> {
        vec![]
    }
}

struct MprisPlayer;

#[interface(name = "org.mpris.MediaPlayer2.Player")]
impl MprisPlayer {
    #[zbus(property)]
    fn playback_status(&self) -> String {
        playback_status(&read_state()).into()
    }

    #[zbus(property)]
    fn loop_status(&self) -> String {
        loop_status(&read_state()).into()
    }

    #[zbus(property)]
    fn rate(&self) -> f64 {
        1.0
    }

    #[zbus(property)]
    fn shuffle(&self) -> bool {
        read_state().shuffle
    }

    #[zbus(property)]
    fn metadata(&self) -> HashMap<String, Value<'static>> {
        metadata(&read_state())
    }

    #[zbus(property)]
    fn volume(&self) -> f64 {
        read_state().volume
    }

    #[zbus(property)]
    fn position(&self) -> i64 {
        position_usec(&read_state())
    }

    #[zbus(property)]
    fn minimum_rate(&self) -> f64 {
        0.5
    }

    #[zbus(property)]
    fn maximum_rate(&self) -> f64 {
        2.0
    }

    #[zbus(property)]
    fn can_go_next(&self) -> bool {
        read_state().can_next
    }

    #[zbus(property)]
    fn can_go_previous(&self) -> bool {
        read_state().can_prev
    }

    #[zbus(property)]
    fn can_play(&self) -> bool {
        true
    }

    #[zbus(property)]
    fn can_pause(&self) -> bool {
        true
    }

    #[zbus(property)]
    fn can_seek(&self) -> bool {
        true
    }

    #[zbus(property)]
    fn can_control(&self) -> bool {
        true
    }

    fn play(&self) {
        emit("play");
    }

    fn pause(&self) {
        emit("pause");
    }

    fn play_pause(&self) {
        emit("playpause");
    }

    fn stop(&self) {
        emit("stop");
    }

    fn next(&self) {
        emit("next");
    }

    fn previous(&self) {
        emit("previous");
    }

    fn seek(&self, offset_usec: i64) {
        emit_num("seek", offset_usec);
    }

    fn set_position(&self, _track_id: zbus::zvariant::OwnedObjectPath, position_usec: i64) {
        emit_num("setPosition", position_usec);
    }

    fn set_volume(&self, volume: f64) {
        emit_num("setVolume", volume);
    }
}

fn emit(action: &str) {
    if let Some(app) = APP.get() {
        let _ = app.emit("mpris-command", serde_json::json!({ "action": action }));
    }
}

fn emit_num<T: serde::Serialize>(action: &str, value: T) {
    if let Some(app) = APP.get() {
        let _ = app.emit(
            "mpris-command",
            serde_json::json!({ "action": action, "value": value }),
        );
    }
}

pub fn start(app: AppHandle) {
    let _ = APP.set(app);
    std::thread::Builder::new()
        .name("wave-mpris".into())
        .spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("failed to build mpris runtime");
            rt.block_on(async move {
                let builder = match zbus::ConnectionBuilder::session() {
                    Ok(b) => b,
                    Err(e) => {
                        eprintln!("[mpris] session bus unavailable: {e}");
                        return;
                    }
                };
                let builder = match builder.name("org.mpris.MediaPlayer2.Wave") {
                    Ok(b) => b,
                    Err(e) => {
                        eprintln!("[mpris] name request failed: {e}");
                        return;
                    }
                };
                let builder = match builder.serve_at("/org/mpris/MediaPlayer2", MprisRoot) {
                    Ok(b) => b,
                    Err(e) => {
                        eprintln!("[mpris] serve root failed: {e}");
                        return;
                    }
                };
                let builder = match builder.serve_at("/org/mpris/MediaPlayer2", MprisPlayer) {
                    Ok(b) => b,
                    Err(e) => {
                        eprintln!("[mpris] serve player failed: {e}");
                        return;
                    }
                };
                let conn = match builder.build().await {
                    Ok(conn) => conn,
                    Err(e) => {
                        eprintln!("[mpris] failed to start: {e}");
                        return;
                    }
                };
                let _ = CONN.set(conn);
                eprintln!("[mpris] registered org.mpris.MediaPlayer2.Wave");
                std::future::pending::<()>().await;
            });
        })
        .expect("failed to spawn wave-mpris thread");
}

pub async fn mpris_update(
    app: tauri::AppHandle,
    state_json: serde_json::Value,
) -> Result<(), String> {
    let _ = APP.set(app);
    {
        let arc = state_arc();
        let mut guard = arc
            .write()
            .map_err(|_| "mpris state lock poisoned".to_string())?;
        let st = &mut *guard;
        st.playing = state_json
            .get("playing")
            .and_then(JsonValue::as_bool)
            .unwrap_or(false);
        st.title = state_json
            .get("title")
            .and_then(JsonValue::as_str)
            .unwrap_or("")
            .to_string();
        st.artist = state_json
            .get("artist")
            .and_then(JsonValue::as_str)
            .map(|v| v.to_string());
        st.album = state_json
            .get("album")
            .and_then(JsonValue::as_str)
            .map(|v| v.to_string());
        st.art_url = state_json
            .get("artUrl")
            .and_then(JsonValue::as_str)
            .map(|v| v.to_string());
        st.duration = state_json
            .get("duration")
            .and_then(JsonValue::as_u64)
            .unwrap_or(0);
        st.position = state_json
            .get("position")
            .and_then(JsonValue::as_u64)
            .unwrap_or(0);
        st.volume = state_json
            .get("volume")
            .and_then(JsonValue::as_f64)
            .unwrap_or(1.0);
        st.shuffle = state_json
            .get("shuffle")
            .and_then(JsonValue::as_bool)
            .unwrap_or(false);
        st.loop_status = state_json
            .get("loopStatus")
            .and_then(JsonValue::as_str)
            .unwrap_or("off")
            .to_string();
        st.can_next = state_json
            .get("canNext")
            .and_then(JsonValue::as_bool)
            .unwrap_or(false);
        st.can_prev = state_json
            .get("canPrev")
            .and_then(JsonValue::as_bool)
            .unwrap_or(false);
    }

    if let Some(conn) = CONN.get() {
        let cur = read_state();
        let body = (
            "org.mpris.MediaPlayer2.Player",
            changed_props(&cur),
            Vec::<String>::new(),
        );
        let _ = conn
            .emit_signal(
                None::<&str>,
                "/org/mpris/MediaPlayer2",
                "org.freedesktop.DBus.Properties",
                "PropertiesChanged",
                &body,
            )
            .await;
    }
    Ok(())
}
