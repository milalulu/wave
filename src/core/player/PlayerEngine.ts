import { EventEmitter } from "../util/EventEmitter";
import type { PlayerSnapshot, PlayerState, RepeatMode, Track } from "../types";
import type { AudioAdapter } from "./PlayerAdapter";
import { Queue } from "../queue/Queue";

export interface PlayerEvents {
  state: PlayerState;
  track: Track | null;
  time: { position: number; duration: number };
  queue: { queue: Track[]; index: number; history: Track[] };
  volume: number;
  speed: number;
  equalizer: number[];
  shuffle: boolean;
  repeat: RepeatMode;
  error: string;
  ended: void;
}

/** Сколько ждать данных в состоянии "loading", прежде чем пере-резолвить поток. */
export const STALL_TIMEOUT_MS = 12000;

/** Сколько ждать разрешения adapter.play(), прежде чем двигаться дальше.
 *  HTML5-адаптер может висеть на play() бесконечно (мёртвый стрим) —
 *  движок не должен блокироваться на этом навсегда. */
export const PLAY_START_TIMEOUT_MS = 10000;

interface PlayerEngineOptions {
  rng?: () => number;
  /** Ленивое разрешение playable-URL (например, YouTube-поток). */
  resolveUri?: (track: Track) => Promise<string>;
  /** Сколько раз пере-резолвить поток при ошибке (по умолчанию 1). */
  retries?: number;
  /** Автоплей: вызывается в конце очереди, чтобы дозаполнить её. */
  onQueueEnd?: () => Promise<Track[]> | Track[];
}

/**
 * Стейт-машина плеера: очередь, shuffle/repeat, seek/volume/position,
 * автопереход по завершении трека. Не зависит от платформы —
 * аудио инжектируется через AudioAdapter.
 */
export class PlayerEngine extends EventEmitter<PlayerEvents> {
  private adapter: AudioAdapter;
  private queue: Queue;
  private state: PlayerState = "idle";
  private volume = 1;
  private speed = 1;
  private equalizer: number[] = [];
  private repeat: RepeatMode = "off";
  private duration = 0;
  private detach: (() => void)[] = [];
  private resolveUri?: (track: Track) => Promise<string>;
  private onQueueEnd?: () => Promise<Track[]> | Track[];
  private defaultFiller?: () => Promise<Track[]> | Track[];
  private retries = 0;
  private maxRetries: number;
  private playSeq = 0;
  private preloadCache = new Map<string, string>();
  private preloadedId: string | null = null;
  private stallTimer: number | undefined;
  /** Авто-фолбэк на вариант (другой источник) при ошибке воспроизведения. */
  private fallback?: () => Track | null;
  private fallbackUsed = false;
  /** Загружен ли источник в адаптер (иначе play() сначала резолвит URI). */
  private hasSource = false;

  constructor(adapter: AudioAdapter, options: PlayerEngineOptions = {}) {
    super();
    this.adapter = adapter;
    this.resolveUri = options.resolveUri;
    this.onQueueEnd = options.onQueueEnd;
    this.defaultFiller = options.onQueueEnd;
    this.maxRetries = Math.max(0, options.retries ?? 1);
    this.queue = new Queue({ rng: options.rng });
    this.attachAdapter();
  }

  private attachAdapter(): void {
    this.detach.push(
      this.adapter.onStateChange((s) => this.setState(s)),
      this.adapter.onTimeUpdate((position, duration) => {
        this.duration = duration;
        this.emit("time", { position, duration });
        const remaining = duration - position;
        if (remaining < 30 && remaining > 0) {
          void this.preloadNext();
        }
      }),
      this.adapter.onEnded(() => this.onTrackEnded()),
      this.adapter.onError((message) => this.onLoadError(message, this.playSeq)),
    );
  }

  private setState(state: PlayerState): void {
    if (this.state === state) return;
    this.state = state;
    if (state === "loading") {
      this.startStallTimer();
    } else {
      this.clearStallTimer();
    }
    this.emit("state", state);
  }

  /** Если в "loading" долго нет данных (URL протух, стрим замёрз) — пере-резолвим. */
  private startStallTimer(): void {
    this.clearStallTimer();
    this.stallTimer = globalThis.setTimeout(() => {
      this.onLoadError("stream stalled", this.playSeq);
    }, STALL_TIMEOUT_MS);
  }

  private clearStallTimer(): void {
    if (this.stallTimer !== undefined) {
      globalThis.clearTimeout(this.stallTimer);
      this.stallTimer = undefined;
    }
  }

  get snapshot(): PlayerSnapshot {
    const current = this.queue.current();
    return {
      state: this.state,
      current,
      position: this.adapter.getPosition(),
      duration: current?.duration ?? this.duration,
      volume: this.volume,
      speed: this.speed,
      equalizer: [...this.equalizer],
      shuffle: this.queue.isShuffle,
      repeat: this.repeat,
      queue: this.queue.tracksList,
      queueIndex: this.queue.currentIndex(),
      history: this.queue.historyList,
    };
  }

  /** Заменить очередь и играть с указанного индекса. */
  async playTracks(tracks: Track[], startIndex = 0): Promise<void> {
    if (tracks.length === 0) return;
    this.queue.replace(tracks, startIndex);
    this.fallbackUsed = false;
    await this.playCurrent();
  }

  /**
   * Восстановить очередь после перезапуска: текущий трек подгружается
   * и позиция восстанавливается, но воспроизведение НЕ начинается.
   * Прямой uri (local/деезер/itunes) прелоадится сразу, yt-поток резолвится
   * при первом play(), чтобы не тормозить старт приложения.
   */
  async restoreQueue(queue: Track[], index: number, position = 0): Promise<void> {
    if (queue.length === 0) return;
    const clamped = Math.min(Math.max(index, 0), queue.length - 1);
    this.queue.replace(queue, clamped);
    this.fallbackUsed = false;
    const track = this.queue.current();
    if (!track) return;
    this.setState("paused");
    this.duration = track.duration ?? 0;
    const uri = this.directUri(track);
    if (uri) {
      try {
        this.adapter.load(uri);
        this.hasSource = true;
        if (position > 0) this.adapter.seek(position);
      } catch {
        // пере-резолвится при play()
        this.hasSource = false;
      }
    }
    this.emit("track", track);
    this.emitQueue();
  }

  private directUri(track: Track): string {
    const u = track.uri;
    if (!u) return "";
    return u.startsWith("http://") || u.startsWith("https://") || u.startsWith("asset://") ? u : "";
  }

  async playTrack(track: Track): Promise<void> {
    await this.playTracks([track], 0);
  }

  /** Переключить текущий трек на вариант (другая площадка) без потери истории. */
  playVariant(track: Track): void {
    if (!this.queue.replaceCurrent(track)) return;
    this.emitQueue();
    void this.playCurrent();
  }

  async play(): Promise<void> {
    if (!this.queue.current()) return;
    if (this.state === "paused") {
      this.setState("loading");
    }
    try {
      // После restore у треков без прямого uri (yt/soundcloud/lastfm) источника
      // в адаптере нет — резолвим и загружаем его перед play().
      if (this.hasSource) {
        await this.playWithGuard();
      } else {
        await this.playCurrent();
      }
    } catch (err) {
      // play() упал (протухший/неверный src) — сразу пере-резолвим поток,
      // не дожидаясь stall-таймера.
      this.onLoadError(err instanceof Error ? err.message : String(err), this.playSeq);
    }
  }

  pause(): void {
    this.adapter.pause();
  }

  async togglePlay(): Promise<void> {
    if (this.state === "playing") {
      this.pause();
    } else {
      await this.play();
    }
  }

  async next(): Promise<void> {
    const nextTrack = this.queue.next();
    if (nextTrack) {
      await this.playCurrent();
    } else if (this.repeat === "all" && this.queue.length > 0) {
      this.queue.restart();
      await this.playCurrent();
    } else if (this.onQueueEnd) {
      const oldLength = this.queue.length;
      try {
        const more = await this.onQueueEnd();
        if (more.length > 0) {
          for (const t of more) this.queue.append(t);
          const orderPos = this.queue.positionOf(oldLength);
          if (orderPos >= 0) this.queue.jumpToOrderPos(orderPos);
          await this.playCurrent();
          return;
        }
      } catch {
        // autoplay источник недоступен — просто останавливаемся
      }
      this.stopAtEnd();
    } else {
      this.stopAtEnd();
    }
  }

  private stopAtEnd(): void {
    this.adapter.pause();
    this.hasSource = false;
    this.queue.clear();
    this.emit("queue", { queue: [], index: -1, history: [] });
  }

  async previous(): Promise<void> {
    const prev = this.queue.previous();
    if (prev) {
      await this.playCurrent();
    } else {
      this.adapter.seek(0);
    }
  }

  seek(seconds: number): void {
    this.adapter.seek(seconds);
  }

  setVolume(volume: number): void {
    this.volume = Math.min(Math.max(volume, 0), 1);
    this.adapter.setVolume(this.volume);
    this.emit("volume", this.volume);
  }

  setPlaybackRate(rate: number): void {
    this.speed = Math.min(Math.max(rate, 0.5), 2);
    this.adapter.setPlaybackRate(this.speed);
    this.emit("speed", this.speed);
  }

  setEqualizer(gains: number[]): void {
    this.equalizer = [...gains];
    this.adapter.setEqualizer(this.equalizer);
    this.emit("equalizer", this.equalizer);
  }

  setCrossfadeMs(ms: number): void {
    this.adapter.setCrossfadeMs(ms);
  }

  /** Данные спектра для визуализатора. */
  getSpectrum(data: Uint8Array): void {
    this.adapter.getSpectrum(data);
  }

  setShuffle(on: boolean): void {
    this.queue.setShuffle(on);
    this.emit("shuffle", on);
    this.emitQueue();
  }

  setRepeat(mode: RepeatMode): void {
    this.repeat = mode;
    this.emit("repeat", mode);
  }

  /** Подменить источник дозаполнения очереди (радио) или вернуть дефолт (null). */
  setAutoFill(fn: (() => Promise<Track[]> | Track[]) | null): void {
    this.onQueueEnd = fn ?? this.defaultFiller;
  }

  /** Установить функцию авто-фолбэка на вариант при ошибке воспроизведения. */
  setFallback(fn: (() => Track | null) | null): void {
    this.fallback = fn ?? undefined;
    this.fallbackUsed = false;
  }

  addToQueue(track: Track, play = false): void {
    this.queue.append(track);
    if (play) {
      const trackIndex = this.queue.length - 1;
      const pos = this.queue.positionOf(trackIndex);
      if (pos >= 0) this.queue.jumpToOrderPos(pos);
      void this.playCurrent();
    }
    this.emitQueue();
  }

  removeFromQueue(trackIndex: number): void {
    this.queue.removeAt(trackIndex);
    this.emitQueue();
  }

  moveInQueue(fromIndex: number, toIndex: number): void {
    this.queue.move(fromIndex, toIndex);
    this.emitQueue();
  }

  clearQueue(): void {
    this.queue.clear();
    this.hasSource = false;
    this.adapter.pause();
    this.setState("idle");
    this.emit("track", null);
    this.emitQueue();
  }

  destroy(): void {
    this.clearStallTimer();
    this.detach.forEach((d) => d());
    this.detach = [];
    this.adapter.destroy();
  }

  private async playCurrent(): Promise<void> {
    const track = this.queue.current();
    if (!track) return;
    this.playSeq += 1;
    this.retries = 0;
    await this.startTrack(this.playSeq);
  }

  /** Ошибка загрузки/стрима: пере-резолв (срок жизни URL истекает), затем error. */
  private onLoadError(message: string, seq: number): void {
    if (seq !== this.playSeq || !this.queue.current()) return;
    // Ошибка в паузе — это фоновая (например, восстановление очереди после
    // рестарта с протухшим uri). Не трогаем машину и не начинаем играть сами.
    if (this.state === "paused") return;
    if (this.resolveUri && this.retries < this.maxRetries) {
      this.retries += 1;
      void this.startTrack(seq);
      return;
    }
    // Источник недоступен — пробуем вариант на другой площадке (один раз за трек).
    if (this.fallback && !this.fallbackUsed) {
      this.fallbackUsed = true;
      const fb = this.fallback();
      if (fb && this.queue.replaceCurrent(fb)) {
        this.emitQueue();
        void this.playCurrent();
        return;
      }
    }
    this.fallbackUsed = false;
    this.clearStallTimer();
    this.emit("error", message);
    // Трек не воспроизводим (URL протух, файл удалён) — пропускаем его,
    // чтобы плейлист не зависал в "loading" навсегда.
    void this.next();
  }

  private async startTrack(seq: number): Promise<void> {
    const track = this.queue.current();
    if (!track || seq !== this.playSeq) return;
    this.setState("loading");
    this.startStallTimer();
    this.emit("track", track);
    try {
      const cached = this.preloadCache.get(track.id);
      if (cached) {
        this.preloadCache.delete(track.id);
      }
      const uri = cached ?? (this.resolveUri ? await this.resolveUri(track) : track.uri);
      if (seq !== this.playSeq) return;
      this.adapter.load(uri);
      this.hasSource = true;
      this.duration = track.duration ?? 0;
      await this.playWithGuard();
    } catch (err) {
      this.onLoadError(err instanceof Error ? err.message : String(err), seq);
    }
    this.emitQueue();
  }

  /**
   * Обёртка над adapter.play(): зависший play() (мёртвый стрим в webkit)
   * не должен блокировать движок. Быстрый reject пробрасывается наверх
   * (движок пере-резолвит поток), а таймаут просто пропускаем —
   * фактическое состояние приходит через onStateChange, восстановление
   * берёт на себя stall-таймер.
   */
  private async playWithGuard(): Promise<void> {
    let settled = false;
    let timer: number | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = globalThis.setTimeout(() => {
        settled = true;
        resolve();
      }, PLAY_START_TIMEOUT_MS);
    });
    const play = this.adapter.play().then(
      () => {
        if (timer !== undefined) globalThis.clearTimeout(timer);
      },
      (err: unknown) => {
        if (timer !== undefined) globalThis.clearTimeout(timer);
        if (settled) return;
        throw err;
      },
    );
    await Promise.race([play, timeout]);
  }

  /** Предзагрузить URI следующего трека для бесперебойного переключения. */
  private async preloadNext(): Promise<void> {
    if (!this.resolveUri) return;
    const next = this.queue.peekNext();
    if (!next || this.preloadedId === next.id) return;
    if (next.uri) {
      this.preloadedId = next.id;
      try {
        const uri = await this.resolveUri(next);
        if (this.preloadedId === next.id) {
          this.preloadCache.set(next.id, uri);
          this.adapter.preload(uri);
        }
      } catch {
        // предзагрузка не критична
      }
    }
  }

  private async onTrackEnded(): Promise<void> {
    this.emit("ended", undefined);
    if (this.repeat === "one") {
      this.adapter.seek(0);
      await this.play();
      return;
    }
    await this.next();
  }

  private emitQueue(): void {
    this.emit("queue", {
      queue: this.queue.tracksList,
      index: this.queue.currentIndex(),
      history: this.queue.historyList,
    });
  }
}
