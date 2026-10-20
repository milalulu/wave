//! Transport-independent limits and persistence for the Lua host.
use mlua::{HookTriggers, Lua, VmState};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncReadExt;

pub const MAX_SOURCE: u64 = 1024 * 1024;
pub const MAX_BODY: u64 = 2 * 1024 * 1024;
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
static REQUEST_ID: AtomicU64 = AtomicU64::new(1);

pub fn next_request_id() -> u64 {
    REQUEST_ID.fetch_add(1, Ordering::Relaxed)
}

pub fn limited_lua(cancelled: Arc<AtomicBool>, budget: Arc<AtomicU64>) -> mlua::Result<Lua> {
    let lua = Lua::new();
    lua.set_memory_limit(32 * 1024 * 1024)?;
    // Plugins use the host's bounded APIs for I/O. Lua's native APIs can block
    // outside instruction hooks and would prevent orderly shutdown.
    for key in [
        "io", "os", "package", "require", "dofile", "loadfile", "debug",
    ] {
        lua.globals().set(key, mlua::Value::Nil)?;
    }
    lua.set_hook(
        HookTriggers::new().every_nth_instruction(10_000),
        move |_, _| {
            if cancelled.load(Ordering::Relaxed) || budget.fetch_add(1, Ordering::Relaxed) >= 500 {
                Err(mlua::Error::RuntimeError(
                    "plugin stopped or instruction budget exceeded".into(),
                ))
            } else {
                Ok(VmState::Continue)
            }
        },
    );
    Ok(lua)
}

pub fn read_limited(reader: impl Read, limit: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err(format!("response exceeds {limit} bytes"));
    }
    Ok(bytes)
}

pub fn write_atomic(path: &Path, bytes: &[u8], replace: bool) -> Result<(), String> {
    let parent = path.parent().ok_or("missing parent directory")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    file.write_all(bytes).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    if replace {
        file.persist(path).map_err(|e| e.to_string())?;
    } else {
        file.persist_noclobber(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn validate_source(bytes: &[u8]) -> Result<&str, String> {
    if bytes.len() as u64 > MAX_SOURCE {
        return Err("plugin is too large".into());
    }
    let source = std::str::from_utf8(bytes).map_err(|e| e.to_string())?;
    let lua = Lua::new();
    lua.set_memory_limit(32 * 1024 * 1024)
        .map_err(|e| e.to_string())?;
    lua.load(source)
        .into_function()
        .map_err(|e| e.to_string())?;
    Ok(source)
}

pub async fn execute(cmd: &str, args: &[String]) -> serde_json::Value {
    use std::process::Stdio;
    let operation = async {
        let mut child = tokio::process::Command::new(cmd)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| e.to_string())?;
        let stdout = child.stdout.take().ok_or("stdout unavailable")?;
        let stderr = child.stderr.take().ok_or("stderr unavailable")?;
        async fn capture(pipe: impl tokio::io::AsyncRead + Unpin) -> Result<Vec<u8>, String> {
            let mut bytes = Vec::new();
            pipe.take(MAX_BODY + 1)
                .read_to_end(&mut bytes)
                .await
                .map_err(|e| e.to_string())?;
            if bytes.len() as u64 > MAX_BODY {
                return Err("command output is too large".into());
            }
            Ok(bytes)
        }
        let (status, stdout, stderr) = tokio::try_join!(
            async { child.wait().await.map_err(|e| e.to_string()) },
            capture(stdout),
            capture(stderr),
        )?;
        Ok::<_, String>(serde_json::json!({
            "code": status.code(),
            "stdout": String::from_utf8_lossy(&stdout),
            "stderr": String::from_utf8_lossy(&stderr),
        }))
    };
    match tokio::time::timeout(REQUEST_TIMEOUT, operation).await {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => serde_json::json!({ "error": error }),
        Err(_) => serde_json::json!({ "error": "command timeout" }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ids_are_unique_across_workers() {
        let workers: Vec<_> = (0..8)
            .map(|_| std::thread::spawn(|| (0..100).map(|_| next_request_id()).collect::<Vec<_>>()))
            .collect();
        let ids: std::collections::HashSet<_> = workers
            .into_iter()
            .flat_map(|w| w.join().unwrap())
            .collect();
        assert_eq!(ids.len(), 800);
    }
    #[test]
    fn loops_are_interrupted_and_native_io_is_unavailable() {
        let lua = limited_lua(
            Arc::new(AtomicBool::new(false)),
            Arc::new(AtomicU64::new(0)),
        )
        .unwrap();
        assert!(lua.load("while true do end").exec().is_err());
        assert!(lua
            .load("assert(os == nil and io == nil and require == nil)")
            .exec()
            .is_ok());
    }

    #[test]
    fn memory_and_cancellation_limits_apply_to_real_lua() {
        let cancel = Arc::new(AtomicBool::new(false));
        let lua = limited_lua(Arc::clone(&cancel), Arc::new(AtomicU64::new(0))).unwrap();
        assert!(lua
            .load("local large = string.rep('x', 40 * 1024 * 1024)")
            .exec()
            .is_err());
        cancel.store(true, Ordering::Relaxed);
        assert!(lua
            .load("local n = 0; for i=1,100000 do n=n+i end")
            .exec()
            .is_err());
    }
    #[test]
    fn install_validation_never_executes_code_or_overwrites_existing_files() {
        assert!(validate_source(b"while true do end").is_ok());
        assert!(validate_source(b"this is not lua").is_err());
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.lua");
        write_atomic(&path, b"old", false).unwrap();
        assert!(write_atomic(&path, b"new", false).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"old");
        write_atomic(&path, b"updated", true).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"updated");
    }
    #[test]
    fn response_limit_is_enforced_during_reading() {
        assert!(read_limited(&b"12345"[..], 4).is_err());
        assert_eq!(read_limited(&b"1234"[..], 4).unwrap(), b"1234");
    }
}
