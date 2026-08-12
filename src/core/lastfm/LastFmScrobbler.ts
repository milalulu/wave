import { invoke } from "@tauri-apps/api/core";
import type { PlayerEngine } from "../player/PlayerEngine";
import type { Track } from "../types";

const MIN_SCROBBLE_SECONDS = 30;
const NOW_PLAYING_DEBOUNCE_MS = 30_000;

interface Session {
  track: Track;
  startedAt: number;
  played: number;
  scrobbled: boolean;
  lastNowPlaying: number;
}

/**
 * Скробблинг Last.fm: подписка на события плеера.
 * - Now playing — при смене трека (с дебаунсом).
 * - Scrobble — по правилу Last.fm: >= 50% длительности ИЛИ >= 4 минут,
 *   при завершении трека или переходе на следующий.
 * Сама отправка происходит в Rust (подписанные запросы), здесь — только логика.
 */
export class LastFmScrobbler {
  private current: Session | null = null;
  private stopped = false;

  constructor(engine: PlayerEngine) {
    engine.on("track", (track) => this.onTrack(track));
    engine.on("ended", () => this.onEnded());
    engine.on("time", ({ position }) => this.onTime(position));
  }

  stop(): void {
    this.stopped = true;
  }

  private onTrack(track: Track | null): void {
    this.finalize(this.current);
    if (!track) {
      this.current = null;
      return;
    }
    this.current = {
      track,
      startedAt: Date.now(),
      played: 0,
      scrobbled: false,
      lastNowPlaying: 0,
    };
    void this.sendNowPlaying(this.current);
  }

  private onTime(position: number): void {
    const s = this.current;
    if (!s || s.scrobbled || !this.eligible(s)) return;
    s.played = Math.max(s.played, position);
    if (s.played >= this.threshold(s.track.duration!)) {
      s.scrobbled = true;
      void this.sendScrobble(s);
    }
  }

  private onEnded(): void {
    const s = this.current;
    if (!s || s.scrobbled) return;
    if (!this.eligible(s)) return;
    s.scrobbled = true;
    s.played = s.track.duration ?? s.played;
    void this.sendScrobble(s);
  }

  private finalize(s: Session | null): void {
    if (!s || s.scrobbled || !this.eligible(s)) return;
    if (s.played >= this.threshold(s.track.duration!)) {
      s.scrobbled = true;
      void this.sendScrobble(s);
    }
  }

  private eligible(s: Session): boolean {
    return !!s.track.duration && s.track.duration >= MIN_SCROBBLE_SECONDS;
  }

  private threshold(duration: number): number {
    return Math.min(duration, Math.max(240, duration / 2));
  }

  private async sendNowPlaying(s: Session): Promise<void> {
    if (this.stopped) return;
    const now = Date.now();
    if (now - s.lastNowPlaying < NOW_PLAYING_DEBOUNCE_MS) return;
    s.lastNowPlaying = now;
    try {
      await invoke("lastfm_update_now_playing", {
        title: s.track.title,
        artist: s.track.artist ?? null,
        album: s.track.album ?? null,
        duration: s.track.duration ?? null,
      });
    } catch (e) {
      console.warn("[lastfm] now playing", e);
    }
  }

  private async sendScrobble(s: Session): Promise<void> {
    if (this.stopped) return;
    try {
      await invoke("lastfm_scrobble", {
        title: s.track.title,
        artist: s.track.artist ?? null,
        album: s.track.album ?? null,
        duration: s.track.duration ?? null,
        timestamp: Math.floor(s.startedAt / 1000),
      });
    } catch (e) {
      console.warn("[lastfm] scrobble", e);
    }
  }
}
