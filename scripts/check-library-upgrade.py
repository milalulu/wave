"""Verify that the released 0.6.0 SQLite migrations still upgrade in place."""

import hashlib
import re
import sqlite3
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SOURCE = "src-tauri/src/lib.rs"
MIGRATION = re.compile(r'version: (\d+),\s*description: "[^"]+",\s*sql: "([^"]+)"')


def apply(db, source):
    applied = dict(db.execute("SELECT version, checksum FROM _sqlx_migrations"))
    migrations = MIGRATION.findall(source)
    assert len(migrations) >= 8, "Could not read SQLite migrations"
    for version, sql in migrations:
        version = int(version)
        checksum = hashlib.sha384(sql.encode()).digest()
        if version in applied:
            assert applied[version] == checksum, f"Released migration {version} changed"
            continue
        db.executescript(sql)
        db.execute("INSERT INTO _sqlx_migrations VALUES (?, ?)", (version, checksum))
        db.commit()
    assert set(applied) <= {int(version) for version, _ in migrations}, "Released migration was removed"


def main():
    old_source = subprocess.check_output(
        ["git", "-c", f"safe.directory={ROOT.as_posix()}", "show", f"v0.6.0:{SOURCE}"], cwd=ROOT
    ).decode()
    new_source = (ROOT / SOURCE).read_text(encoding="utf-8")
    with tempfile.TemporaryDirectory() as folder:
        db = sqlite3.connect(Path(folder) / "wave.db")
        try:
            db.execute("CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY, checksum BLOB NOT NULL)")
            apply(db, old_source)
            entries = {
                "liked_tracks": ("sc:1", '{"title":"Example"}', 17),
                "saved_albums": ("a:1", '{}', 10),
                "saved_artists": ("s:1", '{}', 13),
                "history": (1, '{"id":"sc:1"}', 14),
                "playlists": ("p:1", '{"trackIds":["sc:1","sc:1"]}', 15, 16),
                "queue_state": ("current", '[{"id":"sc:1"}]', 0, 42.5),
            }
            for table, record in entries.items():
                placeholders = ",".join("?" for _ in record)
                db.execute(f"INSERT INTO {table} VALUES ({placeholders})", record)
            db.commit()
            for _ in range(2):
                apply(db, new_source)
            for table, record in entries.items():
                assert db.execute(f"SELECT * FROM {table}").fetchall() == [record], table
            assert db.execute("SELECT * FROM recording_preferences").fetchall() == []
            assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        finally:
            db.close()
    print("Wave 0.6.0 SQLite library and queue survive upgrade and reopening")


if __name__ == "__main__":
    main()
