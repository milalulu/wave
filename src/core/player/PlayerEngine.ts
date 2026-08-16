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
  /**
   * Авто-апгрейд превью: если загруженный поток заметно короче заявленной
   * длительности трека (30-секундные превью iTunes/Deezer/Spotify), движок
   * вызывает колбэк, чтобы получить полную версию (например, с YouTube),
   * и переигрывает трек заново. null/ошибка — оставить превью как есть.
   */
  upgradePreview?: (track: Track) => Promise<Track | null>;
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
  private upgradePreview?: (track: Track) => Promise<Track | null>;
  /** id трека, для которого уже пытались/успешно сделали апгрейд превью. */
  private upgradedTrackId: string | null = null;
  private retries = 0;
  private maxRetries: number;
  private playSeq = 0;
  private preloadCache = new Map<string, string>();
  private preloadedId: string | null = null;
  private stallTimer: number | undefined;
  /** Авто-фолбэк на вариант (другой источник) при ошибке воспроизведения. */
  private fallback?: () => Track | null;
  private fallbackUsed = false;
  /** id трека, который "съел" фолбэк: для новой записи фолбэк разрешается снова. */
  private fallbackTrackId: string | null = null;
  /** Таймер сна «после трека»: остановить по завершении текущего трека. */
  private pauseAtEnd = false;
  /** Загружен ли источник в адаптер (иначе play() сначала резолвит URI). */
  private hasSource = false;
  /**
   * Восстановленная позиция для первого play() трека после restoreQueue.
   * У треков без прямого uri (yt/soundcloud) адаптер.load() сбрасывает
   * pendingSeek — позицию нужно применить заново после загрузки источника.
   */
  private restorePos = 0;
  private restorePosTrackId: string | null = null;

  constructor(adapter: AudioAdapter, options: PlayerEngineOptions = {}) {
    super();
    this.adapter = adapter;
    this.resolveUri = options.resolveUri;
    this.onQueueEnd = options.onQueueEnd;
    this.defaultFiller = options.onQueueEnd;
    this.upgradePreview = options.upgradePreview;
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
        if (remaining < 60 && remaining > 0) {
          void this.preloadNext();
        }
        void this.maybeUpgradePreview(duration);
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
    // Старая очередь сброшена: предзагруженные URI следующего трека недействительны.
    this.preloadCache.clear();
    this.preloadedId = null;
    this.fallbackUsed = false;
    this.fallbackTrackId = null;
    this.upgradedTrackId = null;
    // Новая очередь — восстановленная позиция не применяется.
    this.restorePos = 0;
    this.restorePosTrackId = null;
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
    this.preloadCache.clear();
    this.preloadedId = null;
    this.fallbackUsed = false;
    this.fallbackTrackId = null;
    this.upgradedTrackId = null;
    const track = this.queue.current();
    if (!track) return;
    this.setState("paused");
    this.duration = track.duration ?? 0;
    const uri = this.directUri(track);
    if (uri) {
      this.adapter.load(uri).catch(() => {
        // пере-резолвится при play()
        this.hasSource = false;
      });
      this.hasSource = true;
    }
    // Позиция применяется адаптером по загрузке метаданных (pendingSeek).
    // У треков без прямого uri адаптер.load() при первом play() сбросит
    // pendingSeek — поэтому запоминаем позицию и применяем её в startTrack.
    if (position > 0) {
      this.restorePos = position;
      this.restorePosTrackId = track.id;
      try {
        this.adapter.seek(position);
      } catch {
        // позиция не критична — просто начинаем с 0
      }
    }
    this.emit("track", track);
    this.emitQueue();
  }

  private directUri(track: Track): string {
    const u = track.uri;
    if (!u) return "";
    if (!(u.startsWith("http://") || u.startsWith("https://") || u.startsWith("asset://"))) return "";
    // Страница YouTube — это не поток: загрузка её в <audio> гарантированно
    // падает с ошибкой и триггерит CORS-teardown в WebAudioAdapter, который
    // навсегда отключает EQ-граф. Настоящий поток резолвится при первом play().
    if (this.isYouTubePage(u)) return "";
    return u;
  }

  private isYouTubePage(u: string): boolean {
    return (
      /^https?:\/\/(?:www\.|m\.|music\.)?youtube\.com\/(?:watch|embed|shorts|live)\b/i.test(u) ||
      /^https?:\/\/(?:www\.)?youtu\.be\//i.test(u)
    );
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

  /** Остановить воспроизведение после завершения текущего трека (таймер сна). */
  setPauseAfterTrack(on: boolean): void {
    this.pauseAtEnd = on;
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

  /** Обновить метаданные трека в очереди/текущем треке (редактирование тегов). */
  updateTrack(id: string, patch: Partial<Track>): void {
    if (this.queue.replaceTrackFields(id, patch)) this.emitQueue();
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
    // Новый трек (другой id) — фолбэк можно использовать снова (раз за трек).
    // Вариант того же трека не получит второй шанс — фолбэк уже был потрачен.
    if (track.id !== this.fallbackTrackId) {
      this.fallbackUsed = false;
    }
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
    const current = this.queue.current();
    if (this.fallback && !this.fallbackUsed && current) {
      this.fallbackUsed = true;
      this.fallbackTrackId = current.id;
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
      // Резолв playable-URL (yt-dlp) может занять несколько секунд — не даём
      // stall-таймеру сработать в это время (ложный "stream stalled"), иначе
      // движок повторно резолвит поток и трек стартует ещё дольше. Таймер
      // перезапускаем уже после загрузки источника.
      this.clearStallTimer();
      const uri = cached ?? (this.resolveUri ? await this.resolveUri(track) : track.uri);
      if (seq !== this.playSeq) return;
      // В буферном (WebAudio) режиме load() ждёт завершения декодирования —
      // до этого ничего не играет.
      await this.adapter.load(uri);
      if (seq !== this.playSeq) return;
      this.hasSource = true;
      this.startStallTimer();
      this.duration = track.duration ?? 0;
      // restoreQueue для трека без прямого uri: load() сбросил pendingSeek —
      // возвращаем восстановленную позицию.
      if (this.restorePosTrackId === track.id && this.restorePos > 0) {
        try {
          this.adapter.seek(this.restorePos);
        } catch {
          // позиция не критична — просто начинаем с 0
        }
        this.restorePosTrackId = null;
        this.restorePos = 0;
      }
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

  /**
   * Авто-апгрейд 30-секундного превью до полной версии: если стрим заметно
   * короче заявленной длительности трека, спрашиваем колбэк и переигрываем
   * полную версию с начала. Превью продолжает играть, пока идёт поиск.
   */
  private async maybeUpgradePreview(streamDuration: number): Promise<void> {
    if (!this.upgradePreview) return;
    if (this.state !== "playing" && this.state !== "loading") return;
    const track = this.queue.current();
    if (!track || track.id === this.upgradedTrackId) return;
    const declared = track.duration ?? 0;
    if (declared <= 0) return;
    if (!Number.isFinite(streamDuration) || streamDuration <= 0) return;
    // Превью: реальный поток ≤ 60 с и заметно короче заявленного трека.
    if (!(streamDuration <= 60 && declared - streamDuration >= 30)) return;
    this.upgradedTrackId = track.id;
    try {
      const full = await this.upgradePreview(track);
      if (!full) return;
      const cur = this.queue.current();
      if (!cur || cur.id !== track.id) return;
      if (this.state !== "playing" && this.state !== "loading") return;
      if (this.queue.replaceCurrent(full)) {
        this.emitQueue();
        await this.playCurrent();
      }
    } catch {
      // Превью остаётся как есть.
    }
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
    // Флаг читаем до emit: обработчики (таймер сна) могут его сбросить.
    const stop = this.pauseAtEnd;
    this.emit("ended", undefined);
    if (stop) {
      this.pauseAtEnd = false;
      this.adapter.pause();
      // У завершённого элемента pause() не эмитит событие — ставим явно.
      this.setState("paused");
      return;
    }
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
