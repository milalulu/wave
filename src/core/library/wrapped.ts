import type { HistoryEntry } from "../types";

export type WrappedPeriod = "week" | "month" | "year" | "all";

const DAY_MS = 86400000;

export function filterWrappedPeriod(
  entries: HistoryEntry[],
  period: WrappedPeriod,
  now = Date.now(),
): HistoryEntry[] {
  if (period === "all") return entries;
  const ms = period === "week" ? 7 * DAY_MS : period === "month" ? 30 * DAY_MS : 365 * DAY_MS;
  return entries.filter((e) => now - e.playedAt <= ms);
}

export interface WrappedArtist {
  name: string;
  plays: number;
  minutes: number;
}

export interface WrappedTrack {
  title: string;
  artist: string;
  plays: number;
  coverUrl?: string;
}

export interface WrappedProvider {
  provider: string;
  minutes: number;
}

export interface WrappedStats {
  plays: number;
  minutes: number;
  activeDays: number;
  streakDays: number;
  topArtists: WrappedArtist[];
  topTracks: WrappedTrack[];
  providers: WrappedProvider[];
}

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

export function computeWrapped(entries: HistoryEntry[]): WrappedStats {
  const plays = entries.length;
  let seconds = 0;
  const days = new Set<string>();
  const artists = new Map<string, { plays: number; seconds: number }>();
  const tracks = new Map<string, { plays: number; title: string; artist: string; coverUrl?: string }>();
  const providers = new Map<string, number>();

  for (const e of entries) {
    const dur = e.track.duration ?? 0;
    seconds += dur;
    days.add(dayKey(e.playedAt));
    const artist = e.track.artist?.trim() || "?";
    const a = artists.get(artist) ?? { plays: 0, seconds: 0 };
    a.plays += 1;
    a.seconds += dur;
    artists.set(artist, a);
    const key = `${artist} — ${e.track.title}`;
    const tr = tracks.get(key) ?? {
      plays: 0,
      title: e.track.title,
      artist,
      coverUrl: e.track.coverUrl,
    };
    tr.plays += 1;
    if (!tr.coverUrl && e.track.coverUrl) tr.coverUrl = e.track.coverUrl;
    tracks.set(key, tr);
    if (e.track.provider) {
      providers.set(e.track.provider, (providers.get(e.track.provider) ?? 0) + dur);
    }
  }

  // Стрик: подряд идущие дни с прослушиваниями, считая сегодня/вчера.
  const daySet = days;
  let streakDays = 0;
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  if (!daySet.has(dayKey(cursor.getTime()))) cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (daySet.has(dayKey(cursor.getTime()))) {
    streakDays += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return {
    plays,
    minutes: Math.round(seconds / 60),
    activeDays: days.size,
    streakDays,
    topArtists: [...artists.entries()]
      .map(([name, v]) => ({ name, plays: v.plays, minutes: Math.round(v.seconds / 60) }))
      .sort((a, b) => b.plays - a.plays || b.minutes - a.minutes)
      .slice(0, 5),
    topTracks: [...tracks.values()]
      .sort((a, b) => b.plays - a.plays)
      .slice(0, 5),
    providers: [...providers.entries()]
      .map(([provider, s]) => ({ provider, minutes: Math.round(s / 60) }))
      .sort((a, b) => b.minutes - a.minutes),
  };
}

/** Минимальный 2d-контекст для отрисовки карточки (в тестах — фейк). */
export interface CardCtx {
  canvas: { width: number; height: number };
  fillStyle: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
}

export function drawWrappedCard(
  ctx: CardCtx,
  stats: WrappedStats,
  periodLabel: string,
  accent = "#00e5ff",
): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W, 24);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = accent;
  ctx.font = "700 44px system-ui, sans-serif";
  ctx.fillText("WAVE WRAPPED", W / 2, 120);
  ctx.fillStyle = "#ffffff";
  ctx.font = "400 36px system-ui, sans-serif";
  ctx.fillText(periodLabel, W / 2, 180);
  ctx.font = "800 120px system-ui, sans-serif";
  ctx.fillText(String(stats.minutes), W / 2, 330);
  ctx.font = "400 36px system-ui, sans-serif";
  ctx.fillText("minutes", W / 2, 410);
  ctx.font = "800 84px system-ui, sans-serif";
  ctx.fillText(String(stats.plays), W / 2, 540);
  ctx.font = "400 36px system-ui, sans-serif";
  ctx.fillText("plays", W / 2, 610);
  ctx.fillStyle = accent;
  ctx.font = "800 84px system-ui, sans-serif";
  ctx.fillText(String(stats.streakDays), W / 2, 740);
  ctx.fillStyle = "#ffffff";
  ctx.font = "400 36px system-ui, sans-serif";
  ctx.fillText("day streak", W / 2, 810);
  ctx.textAlign = "left";
  ctx.font = "700 40px system-ui, sans-serif";
  ctx.fillStyle = accent;
  ctx.fillText("TOP ARTISTS", 90, 930);
  ctx.fillStyle = "#ffffff";
  ctx.font = "400 38px system-ui, sans-serif";
  stats.topArtists.forEach((a, i) => {
    ctx.fillText(`${i + 1}. ${a.name} — ${a.plays}`, 90, 990 + i * 60);
  });
  ctx.fillStyle = accent;
  ctx.font = "700 40px system-ui, sans-serif";
  ctx.fillText("TOP TRACKS", 90, 1330);
  ctx.fillStyle = "#ffffff";
  ctx.font = "400 38px system-ui, sans-serif";
  stats.topTracks.forEach((t, i) => {
    const line = `${i + 1}. ${t.title} — ${t.artist}`.slice(0, 42);
    ctx.fillText(line, 90, 1390 + i * 60);
  });
}
