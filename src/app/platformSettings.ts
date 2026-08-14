/** Настройки источников: какие площадки отключены и в каком порядке предпочтений. */

const BLOCKED_KEY = "wave-blocked-providers";
const PREFERRED_KEY = "wave-preferred-providers";
const BLOCKED_TRACKS_KEY = "wave-blocked-tracks";
const BLOCKED_ARTISTS_KEY = "wave-blocked-artists";

/** Известные площадки (для UI настроек и фильтрации). */
export const KNOWN_PROVIDERS = [
  "itunes",
  "deezer",
  "youtube",
  "soundcloud",
  "spotify",
  "vk",
  "lastfm",
  "musicbrainz",
  "local",
] as const;

export type ProviderId = (typeof KNOWN_PROVIDERS)[number];

function readArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeArray(key: string, ids: string[]): void {
  localStorage.setItem(key, JSON.stringify(ids));
}

export function getBlockedProviders(): string[] {
  return readArray(BLOCKED_KEY);
}

export function setBlockedProviders(ids: string[]): void {
  writeArray(BLOCKED_KEY, [...new Set(ids)]);
}

export function getPreferredProviders(): string[] {
  return readArray(PREFERRED_KEY);
}

export function setPreferredProviders(ids: string[]): void {
  writeArray(PREFERRED_KEY, [...new Set(ids)]);
}

export function isBlockedProvider(id: string): boolean {
  return getBlockedProviders().includes(id);
}

/** Отфильтровать список объектов провайдеров, убрав заблокированные. */
export function filterProviders<T extends { id: string }>(providers: T[]): T[] {
  const blocked = new Set(getBlockedProviders());
  return providers.filter((p) => !blocked.has(p.id));
}

/** Отсортировать провайдеров по предпочтениям (не указанные — в конце, в текущем порядке). */
export function orderProviders<T extends { id: string }>(providers: T[], preferred?: string[]): T[] {
  const order = preferred ?? getPreferredProviders();
  if (!order || order.length === 0) return [...providers];
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...providers].sort((a, b) => {
    const ra = rank.get(a.id);
    const rb = rank.get(b.id);
    if (ra === undefined && rb === undefined) return 0;
    if (ra === undefined) return 1;
    if (rb === undefined) return -1;
    return ra - rb;
  });
}

/** Список провайдеров с учётом блокировки и порядка предпочтений. */
export function activeProviders<T extends { id: string }>(providers: T[]): T[] {
  return orderProviders(filterProviders(providers));
}

/** Треки, которые нельзя включать в «Мою волну». */
export function getBlockedTrackIds(): string[] {
  return readArray(BLOCKED_TRACKS_KEY);
}

export function isTrackBlocked(id: string): boolean {
  return getBlockedTrackIds().includes(id);
}

/** Переключить блокировку трека в волне. Возвращает новое состояние (true = заблокирован). */
export function toggleBlockedTrack(id: string): boolean {
  const next = getBlockedTrackIds();
  const i = next.indexOf(id);
  let blocked: boolean;
  if (i >= 0) {
    next.splice(i, 1);
    blocked = false;
  } else {
    next.push(id);
    blocked = true;
  }
  writeArray(BLOCKED_TRACKS_KEY, next);
  return blocked;
}

/** Артисты, которых нельзя включать в «Мою волну» (нормализованы в lowercase). */
export function getBlockedArtists(): string[] {
  return readArray(BLOCKED_ARTISTS_KEY);
}

export function isArtistBlocked(name?: string): boolean {
  if (!name) return false;
  return getBlockedArtists().includes(name.trim().toLocaleLowerCase());
}

/** Переключить блокировку артиста в волне. Возвращает новое состояние (true = заблокирован). */
export function toggleBlockedArtist(name: string): boolean {
  const norm = name.trim().toLocaleLowerCase();
  if (!norm) return false;
  const next = getBlockedArtists();
  const i = next.indexOf(norm);
  let blocked: boolean;
  if (i >= 0) {
    next.splice(i, 1);
    blocked = false;
  } else {
    next.push(norm);
    blocked = true;
  }
  writeArray(BLOCKED_ARTISTS_KEY, next);
  return blocked;
}
