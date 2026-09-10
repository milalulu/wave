import type { Playlist } from "../types";

export interface PlaylistGroup {
  folder: string | null;
  playlists: Playlist[];
}

/**
 * Группировка плейлистов по папкам: сначала без папки (как есть),
 * затем папки по алфавиту. Папки не схлопываются — только заголовки.
 */
export function groupPlaylistsByFolder(playlists: Playlist[]): PlaylistGroup[] {
  const ungrouped = playlists.filter((p) => !p.folder?.trim());
  const byFolder = new Map<string, Playlist[]>();
  for (const p of playlists) {
    const f = p.folder?.trim();
    if (!f) continue;
    const list = byFolder.get(f) ?? [];
    list.push(p);
    byFolder.set(f, list);
  }
  const out: PlaylistGroup[] = [];
  if (ungrouped.length > 0) out.push({ folder: null, playlists: ungrouped });
  for (const name of [...byFolder.keys()].sort((a, b) => a.localeCompare(b))) {
    out.push({ folder: name, playlists: byFolder.get(name) ?? [] });
  }
  return out;
}

/** Уникальные обложки треков плейлиста для выбора обложки. */
export function distinctCovers(tracks: { coverUrl?: string }[], limit = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tracks) {
    if (!t.coverUrl || seen.has(t.coverUrl)) continue;
    seen.add(t.coverUrl);
    out.push(t.coverUrl);
    if (out.length >= limit) break;
  }
  return out;
}
