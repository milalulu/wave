import { SqliteStorage } from "./SqliteStorage";
import { MemoryStorage } from "../core/database/MemoryStorage";
import type { Storage } from "../core/database/Storage";

export type StorageBackend = "sqlite" | "memory";

/**
 * Выбор хранилища: пробуем SQLite, при любой ошибке (нет Tauri,
 * повреждённая БД) — in-memory фолбэк, чтобы приложение грузилось.
 */
export async function pickStorage(
  makeSqlite: () => Storage = () => new SqliteStorage(),
  makeMemory: () => Storage = () => new MemoryStorage(),
): Promise<{ storage: Storage; backend: StorageBackend }> {
  const sql = makeSqlite();
  try {
    await sql.init();
    return { storage: sql, backend: "sqlite" };
  } catch {
    const mem = makeMemory();
    await mem.init();
    return { storage: mem, backend: "memory" };
  }
}
