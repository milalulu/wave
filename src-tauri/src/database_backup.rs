//! SQLite snapshots include committed WAL data; restore never replaces an open database file.
use sqlx::{sqlite::SqliteConnectOptions, Connection, SqliteConnection};
use std::{path::Path, time::Duration};

const TABLES: [(&str, &str, bool); 7] = [
    ("liked_tracks", "id,track_json,liked_at", true),
    ("saved_albums", "id,album_json,saved_at", true),
    ("saved_artists", "id,artist_json,saved_at", true),
    ("history", "id,track_json,played_at", true),
    ("playlists", "id,playlist_json,created_at,updated_at", true),
    ("queue_state", "id,tracks_json,track_index,position", false),
    ("recording_preferences", "id,groups_json", false),
];

async fn connect(path: &Path, read_only: bool) -> Result<SqliteConnection, String> {
    SqliteConnection::connect_with(
        &SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(false)
            .read_only(read_only)
            .busy_timeout(Duration::from_secs(5)),
    )
    .await
    .map_err(|e| e.to_string())
}

async fn validate(db: &mut SqliteConnection) -> Result<Vec<bool>, String> {
    let checks: Vec<String> = sqlx::query_scalar("PRAGMA quick_check")
        .fetch_all(&mut *db)
        .await
        .map_err(|e| e.to_string())?;
    if checks != ["ok"] {
        return Err("database integrity check failed".into());
    }
    let mut present = Vec::new();
    for (table, columns, required) in TABLES {
        let found: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .bind(table)
        .fetch_one(&mut *db)
        .await
        .map_err(|e| e.to_string())?;
        if found == 0 && required {
            return Err(format!("database is missing table: {table}"));
        }
        if found != 0 {
            sqlx::query(&format!("SELECT {columns} FROM {table} LIMIT 0"))
                .execute(&mut *db)
                .await
                .map_err(|e| e.to_string())?;
            for column in columns.split(',').filter(|c| c.ends_with("_json")) {
                let invalid: i64 = sqlx::query_scalar(&format!(
                    "SELECT count(*) FROM {table} WHERE NOT json_valid({column})"
                ))
                .fetch_one(&mut *db)
                .await
                .map_err(|e| e.to_string())?;
                if invalid != 0 {
                    return Err(format!("invalid JSON in {table}"));
                }
            }
        }
        present.push(found != 0);
    }
    Ok(present)
}

pub async fn backup(source: &Path, destination: &Path) -> Result<(), String> {
    if destination.canonicalize().ok().as_deref() == Some(source) {
        return Err("backup destination is the active database".into());
    }
    let mut db = connect(source, true).await?;
    validate(&mut db).await?;
    let temp = tempfile::NamedTempFile::new_in(
        destination
            .parent()
            .ok_or("missing destination directory")?,
    )
    .map_err(|e| e.to_string())?;
    sqlx::query("VACUUM INTO ?")
        .bind(temp.path().to_string_lossy().as_ref())
        .execute(&mut db)
        .await
        .map_err(|e| e.to_string())?;
    temp.persist(destination).map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn restore(source: &Path, destination: &Path) -> Result<(), String> {
    if source == destination {
        return Err("cannot restore the active database into itself".into());
    }
    // Work from a validated immutable snapshot, including any WAL in the imported DB.
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let snapshot = dir.path().join("restore.db");
    backup(source, &snapshot).await?;
    let mut imported = connect(&snapshot, true).await?;
    let present = validate(&mut imported).await?;
    imported.close().await.map_err(|e| e.to_string())?;
    let mut live = connect(destination, false).await?;
    sqlx::query("ATTACH DATABASE ? AS wave_restore")
        .bind(snapshot.to_string_lossy().as_ref())
        .execute(&mut live)
        .await
        .map_err(|e| e.to_string())?;
    let mut tx = live.begin().await.map_err(|e| e.to_string())?;
    for ((table, columns, _), exists) in TABLES.into_iter().zip(present) {
        sqlx::query(&format!("DELETE FROM main.{table}"))
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        if exists {
            sqlx::query(&format!(
                "INSERT INTO main.{table} ({columns}) SELECT {columns} FROM wave_restore.{table}"
            ))
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    live.close().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn fixture(path: &Path) -> SqliteConnection {
        let mut db = SqliteConnection::connect_with(
            &SqliteConnectOptions::new()
                .filename(path)
                .create_if_missing(true),
        )
        .await
        .unwrap();
        for (table, columns, _) in TABLES {
            let definitions = columns
                .split(',')
                .map(|c| format!("{c} TEXT NOT NULL"))
                .collect::<Vec<_>>()
                .join(",");
            sqlx::query(&format!("CREATE TABLE {table} ({definitions})"))
                .execute(&mut db)
                .await
                .unwrap();
        }
        sqlx::query("PRAGMA journal_mode=WAL")
            .execute(&mut db)
            .await
            .unwrap();
        sqlx::query("PRAGMA wal_autocheckpoint=0")
            .execute(&mut db)
            .await
            .unwrap();
        sqlx::query("INSERT INTO liked_tracks VALUES ('original','{}','1')")
            .execute(&mut db)
            .await
            .unwrap();
        db
    }

    #[tokio::test]
    async fn snapshot_includes_wal_and_restores_through_an_open_connection() {
        let dir = tempfile::tempdir().unwrap();
        let live = dir.path().join("live.db");
        let saved = dir.path().join("saved.db");
        let mut open = fixture(&live).await;
        backup(&live, &saved).await.unwrap();
        sqlx::query("DELETE FROM liked_tracks")
            .execute(&mut open)
            .await
            .unwrap();
        restore(&saved, &live).await.unwrap();
        let id: String = sqlx::query_scalar("SELECT id FROM liked_tracks")
            .fetch_one(&mut open)
            .await
            .unwrap();
        assert_eq!(id, "original");
        assert!(backup(&live, &live).await.is_err());
        assert!(restore(&live, &live).await.is_err());
    }

    #[tokio::test]
    async fn rejects_non_database_and_invalid_json_without_touching_live_data() {
        let dir = tempfile::tempdir().unwrap();
        let live = dir.path().join("live.db");
        let bad = dir.path().join("bad.db");
        let mut open = fixture(&live).await;
        std::fs::write(
            &bad,
            b"SQLite format 3\0liked_tracks saved_albums saved_artists history playlists",
        )
        .unwrap();
        assert!(restore(&bad, &live).await.is_err());
        std::fs::remove_file(&bad).unwrap();
        let mut invalid = fixture(&bad).await;
        sqlx::query("UPDATE liked_tracks SET track_json='broken'")
            .execute(&mut invalid)
            .await
            .unwrap();
        assert!(restore(&bad, &live).await.is_err());
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM liked_tracks")
            .fetch_one(&mut open)
            .await
            .unwrap();
        assert_eq!(count, 1);
    }
}
