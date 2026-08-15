use serde::Serialize;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCheck {
    pub path: Option<String>,
    pub ready: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    pub app_version: String,
    pub platform: String,
    pub arch: String,
    pub android: bool,
    pub app_data_dir: String,
    pub tools_dir: String,
    pub db_path: Option<String>,
    pub db_size: Option<u64>,
    pub ytdlp: ToolCheck,
    pub ffmpeg: ToolCheck,
    pub network: bool,
}

fn db_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    [
        app.path().app_data_dir().ok(),
        app.path().app_local_data_dir().ok(),
    ]
    .into_iter()
    .flatten()
    .map(|dir| dir.join("wave.db"))
    .find(|p| p.is_file())
}

async fn net_ok() -> bool {
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(8))
        .user_agent(concat!("wave/", env!("CARGO_PKG_VERSION")))
        .build();
    let Ok(client) = client else {
        return false;
    };
    for url in [
        "https://www.gstatic.com/generate_204",
        "https://github.com/generate_204",
    ] {
        if let Ok(resp) = client.get(url).send().await {
            if resp.status().is_success() {
                return true;
            }
        }
    }
    false
}

#[tauri::command]
pub async fn diagnostics(app: tauri::AppHandle) -> Result<Diagnostics, String> {
    let tools = crate::tools::status(&app);
    let db = db_file(&app);
    let db_size = db.as_ref().and_then(|p| p.metadata().ok()).map(|m| m.len());
    Ok(Diagnostics {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        android: cfg!(target_os = "android"),
        app_data_dir: app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .to_string_lossy()
            .to_string(),
        tools_dir: crate::tools::tools_dir(&app).to_string_lossy().to_string(),
        db_path: db.as_ref().map(|p| p.to_string_lossy().to_string()),
        db_size,
        ytdlp: ToolCheck {
            path: tools.ytdlp_path,
            ready: tools.ytdlp_ready,
        },
        ffmpeg: ToolCheck {
            path: tools.ffmpeg_path,
            ready: tools.ffmpeg_ready,
        },
        network: net_ok().await,
    })
}
