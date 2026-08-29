use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Listener, Manager};

fn menu(app: &AppHandle) -> tauri::menu::Menu<tauri::Wry> {
    let show = MenuItemBuilder::with_id("show", "Show / Hide Wave")
        .build(app)
        .unwrap();
    let previous = MenuItemBuilder::with_id("previous", "Previous")
        .build(app)
        .unwrap();
    let playpause = MenuItemBuilder::with_id("playpause", "Play / Pause")
        .build(app)
        .unwrap();
    let next = MenuItemBuilder::with_id("next", "Next").build(app).unwrap();
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app).unwrap();
    let separator = PredefinedMenuItem::separator(app).unwrap();
    MenuBuilder::new(app)
        .item(&show)
        .separator()
        .items(&[&previous, &playpause, &next])
        .item(&separator)
        .item(&quit)
        .build()
        .unwrap()
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn start(app: &tauri::App) {
    let handle = app.handle().clone();
    let mut builder = TrayIconBuilder::with_id("wave-tray")
        .tooltip("Wave")
        .menu(&menu(app.handle()))
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let action = event.id.as_ref();
            if action == "show" {
                show_main(app);
                return;
            }
            let _ = app.emit("tray-command", serde_json::json!({ "action": action }));
            if action == "quit" {
                let app = app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(600));
                    app.exit(0);
                });
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    let _tray = builder.build(app);

    let tray_handle = handle.clone();
    let _ = handle.listen("tray-state", move |event| {
        let Ok(payload) = serde_json::from_str::<serde_json::Value>(event.payload()) else {
            return;
        };
        let title = payload.get("title").and_then(|v| v.as_str()).unwrap_or("");
        let artist = payload.get("artist").and_then(|v| v.as_str()).unwrap_or("");
        let tooltip = if title.is_empty() {
            "Wave".to_string()
        } else {
            let state = payload
                .get("playing")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let glyph = if state { "▶" } else { "⏸" };
            if artist.is_empty() {
                format!("Wave — {glyph} {title}")
            } else {
                format!("Wave — {glyph} {title} — {artist}")
            }
        };
        if let Some(tray) = tray_handle.tray_by_id("wave-tray") {
            let _ = tray.set_tooltip(Some(&tooltip));
        }
    });
}

