import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CROSSFADE_MS,
  EQ_FREQUENCIES,
  MEDIA_ELEMENT_PROBE_MS,
  MEDIA_ELEMENT_READY_PROBE_MS,
  PROXY_BASE,
  WebAudioAdapter,
} from "./WebAudioAdapter";
import type { PlayerState } from "../types";

class FakeParam {
  value: number;
  ramps: number[] = [];
  constructor(v: number) {
    this.value = v;
  }
  setTargetAtTime(v: number): void {
    this.ramps.push(v);
    this.value = v;
  }
  setValueAtTime(v: number): void {
    this.value = v;
  }
  linearRampToValueAtTime(v: number): void {
    this.value = v;
  }
  cancelScheduledValues(): void {
    /* noop */
  }
}

class FakeBiquad {
  type = "";
  frequency = { value: 0 };
  Q = { value: 0 };
  gain = new FakeParam(0);
  connect(): void {
    /* noop */
  }
}

class FakeGain {
  gain = new FakeParam(1);
  connect(): void {
    /* noop */
  }
}

class FakeAnalyser {
  fftSize = 256;
  connect(): void {
    /* noop */
  }
  getByteFrequencyData(data: Uint8Array): void {
    data.fill(42);
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state = "suspended";
  currentTime = 0;
  destination = {};
  elementSources: unknown[] = [];
  sourcesPaused: boolean[] = [];
  biquads: FakeBiquad[] = [];
  gains: FakeGain[] = [];
  analyser!: FakeAnalyser;
  bufferSources: FakeBufferSource[] = [];
  decodeCalls = 0;
  resumeCount = 0;
  closed = false;

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createMediaElementSource(el: { paused: boolean }): { connect: () => void } {
    this.elementSources.push(el);
    this.sourcesPaused.push(el.paused);
    return { connect: () => undefined };
  }

  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }

  createBiquadFilter(): FakeBiquad {
    const f = new FakeBiquad();
    this.biquads.push(f);
    return f;
  }

  createAnalyser(): FakeAnalyser {
    this.analyser = new FakeAnalyser();
    return this.analyser;
  }

  createBufferSource(): FakeBufferSource {
    const s = new FakeBufferSource();
    this.bufferSources.push(s);
    return s;
  }

  decodeAudioData(_bytes: ArrayBuffer): Promise<FakeDecodedBuffer> {
    this.decodeCalls += 1;
    return Promise.resolve(new FakeDecodedBuffer());
  }

  resume(): Promise<void> {
    this.resumeCount += 1;
    this.state = "running";
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

class FakeDecodedBuffer {
  duration = 120;
}

class FakeBufferSource {
  buffer: FakeDecodedBuffer | null = null;
  playbackRate = new FakeParam(1);
  offset: number | null = null;
  stopCalls: number[] = [];
  onended: (() => void) | null = null;
  connect(): void {
    /* noop */
  }
  start(_when: number, offset: number): void {
    this.offset = offset;
  }
  stop(when?: number): void {
    this.stopCalls.push(when ?? -1);
  }
}

class FakeAudioElement {
  static instances: FakeAudioElement[] = [];
  static broken = false;
  /** Элемент принял источник, но метаданные так и не пришли (readyState 0). */
  static stuckMetadata = false;
  src = "";
  currentSrc = "";
  readyState = 0;
  currentTime = 0;
  duration = 100;
  volume = 1;
  playbackRate = 1;
  preload = "none";
  paused = true;
  ended = false;
  error: { code: number } | null = null;
  onplay: (() => void) | null = null;
  onpause: (() => void) | null = null;
  onwaiting: (() => void) | null = null;
  onplaying: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeupdate: (() => void) | null = null;
  onloadedmetadata: (() => void) | null = null;
  ondurationchange: (() => void) | null = null;
  playCalls = 0;
  loadCount = 0;

  constructor() {
    FakeAudioElement.instances.push(this);
  }

  load(): void {
    this.loadCount += 1;
    // Сломанный `<audio>` (WebKitGTK баг) молча не принимает источник.
    if (!FakeAudioElement.broken) this.currentSrc = this.src;
    if (!FakeAudioElement.broken && !FakeAudioElement.stuckMetadata) this.readyState = 1;
  }

  play(): Promise<void> {
    this.playCalls += 1;
    this.paused = false;
    this.ended = false;
    this.onplay?.();
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
    this.onpause?.();
  }

  removeAttribute(name: string): void {
    if (name === "src") {
      this.src = "";
      this.currentSrc = "";
    }
  }
}

function lastCtx(): FakeAudioContext {
  const ctx = FakeAudioContext.instances[FakeAudioContext.instances.length - 1];
  if (!ctx) throw new Error("no AudioContext created");
  return ctx;
}

function instances(): FakeAudioElement[] {
  return FakeAudioElement.instances;
}

function resetGlobals(overrides: { noCtx?: boolean; throwOnSource?: boolean } = {}): void {
  const Ctx = class extends FakeAudioContext {
    createMediaElementSource(el: { paused: boolean }): { connect: () => void } {
      if (overrides.throwOnSource) throw new Error("boom");
      return super.createMediaElementSource(el);
    }
  };
  const w = { AudioContext: overrides.noCtx ? undefined : Ctx } as unknown as Window;
  (globalThis as unknown as { window: Window }).window = w;
  (globalThis as unknown as { Audio: typeof FakeAudioElement }).Audio = FakeAudioElement;
}

beforeEach(() => {
  FakeAudioContext.instances = [];
  FakeAudioElement.instances = [];
  FakeAudioElement.broken = false;
  FakeAudioElement.stuckMetadata = false;
  vi.useFakeTimers();
  resetGlobals();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WebAudioAdapter", () => {
  it("строит граф на свежих (не игравших) элементах до play", () => {
    const adapter = new WebAudioAdapter();
    adapter.load("a.mp3");
    const ctx = lastCtx();
    expect(ctx.elementSources.length).toBe(2);
    expect(ctx.sourcesPaused).toEqual([true, true]);
    expect(ctx.biquads.length).toBe(EQ_FREQUENCIES.length);
    expect(ctx.gains.length).toBe(2);
    expect(ctx.analyser).toBeDefined();
    adapter.destroy();
  });

  it("EQ не пересоздаёт граф и де-зиппит через setTargetAtTime", () => {
    const adapter = new WebAudioAdapter();
    adapter.load("a.mp3");
    const before = FakeAudioContext.instances.length;
    const elementsBefore = instances().length;

    adapter.setEqualizer([4, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    adapter.setEqualizer([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

    expect(FakeAudioContext.instances.length).toBe(before);
    expect(instances().length).toBe(elementsBefore);
    const ctx = lastCtx();
    expect(ctx.biquads[0].gain.value).toBe(0);
    expect(ctx.biquads[0].gain.ramps).toContain(4);
    adapter.destroy();
  });

  it("клиппит gain в диапазон ±12", () => {
    const adapter = new WebAudioAdapter();
    adapter.load("a.mp3");
    const gains = new Array(EQ_FREQUENCIES.length).fill(0) as number[];
    gains[0] = 99;
    gains[1] = -99;
    adapter.setEqualizer(gains);
    const ctx = lastCtx();
    expect(ctx.biquads[0].gain.value).toBe(12);
    expect(ctx.biquads[1].gain.value).toBe(-12);
    adapter.destroy();
  });

  it("при игре смена трека делает кроссфейд на второй элемент", async () => {
    const adapter = new WebAudioAdapter();
    adapter.load("a.mp3");
    await adapter.play();
    expect(instances()[0].paused).toBe(false);

    adapter.load("b.mp3");
    await adapter.play();
    const ctx = lastCtx();
    expect(ctx.gains[0].gain.value).toBe(0);
    expect(ctx.gains[1].gain.value).toBe(1);
    expect(instances()[1].src).toBe("b.mp3");
    expect(instances()[1].paused).toBe(false);

    vi.advanceTimersByTime(CROSSFADE_MS + 100);
    expect(instances()[0].paused).toBe(true);
    adapter.destroy();
  });

  it("после кроссфейда активным становится новый элемент", async () => {
    const states: PlayerState[] = [];
    const adapter = new WebAudioAdapter();
    adapter.onStateChange((s) => states.push(s));
    adapter.load("a.mp3");
    await adapter.play();
    adapter.load("b.mp3");
    await adapter.play();
    vi.advanceTimersByTime(CROSSFADE_MS + 100);
    expect(states[states.length - 1]).toBe("playing");
    expect(adapter.getPosition()).toBe(0);
    adapter.destroy();
  });

  it("preload подогревает неактивный элемент и не перезагружает повторно", async () => {
    const adapter = new WebAudioAdapter();
    adapter.load("a.mp3");
    await adapter.play();
    adapter.preload("b.mp3");
    expect(instances()[1].src).toBe("b.mp3");
    adapter.preload("b.mp3");
    expect(instances()[1].loadCount).toBe(1);
    adapter.load("b.mp3");
    await adapter.play();
    expect(instances()[1].loadCount).toBe(1);
    expect(instances()[1].src).toBe("b.mp3");
    vi.advanceTimersByTime(CROSSFADE_MS + 100);
    adapter.destroy();
  });

  it("не предзагружает, пока неактивный элемент играет (кроссфейд)", async () => {
    const adapter = new WebAudioAdapter();
    adapter.load("a.mp3");
    await adapter.play();
    adapter.load("b.mp3");
    await adapter.play();
    // во время кроссфейда неактивный элемент (el1) уже играет b.mp3
    expect(instances()[1].paused).toBe(false);
    adapter.preload("c.mp3");
    expect(instances()[1].src).toBe("b.mp3");
    vi.advanceTimersByTime(CROSSFADE_MS + 100);
    adapter.destroy();
  });

  it("getSpectrum возвращает данные анализатора или нули без графа", () => {
    const adapter = new WebAudioAdapter();
    adapter.load("a.mp3");
    const data = new Uint8Array(16);
    adapter.getSpectrum(data);
    expect([...data].every((v) => v === 42)).toBe(true);

    adapter.destroy();
    const data2 = new Uint8Array(16);
    adapter.getSpectrum(data2);
    expect([...data2].every((v) => v === 0)).toBe(true);
  });

  it("события приходят только от активного элемента", async () => {
    const states: PlayerState[] = [];
    const adapter = new WebAudioAdapter();
    adapter.onStateChange((s) => states.push(s));
    adapter.load("a.mp3");
    await adapter.play();
    const before = states.length;
    instances()[1].play();
    instances()[1].onplaying?.();
    expect(states.length).toBe(before);

    const ended: number[] = [];
    adapter.onEnded(() => ended.push(1));
    instances()[0].onended?.();
    instances()[1].onended?.();
    expect(ended.length).toBe(1);
    adapter.destroy();
  });

  it("seek применяется по loadedmetadata", () => {
    const adapter = new WebAudioAdapter();
    adapter.load("a.mp3");
    adapter.seek(30);
    instances()[0].onloadedmetadata?.();
    expect(instances()[0].currentTime).toBe(30);
    adapter.destroy();
  });

  it("resume() контекста вызывается при play", async () => {
    const adapter = new WebAudioAdapter();
    adapter.load("a.mp3");
    expect(lastCtx().state).toBe("suspended");
    await adapter.play();
    expect(lastCtx().resumeCount).toBeGreaterThan(0);
    expect(lastCtx().state).toBe("running");
    adapter.destroy();
  });

  it("при естественном окончании использует подогретый preload элемент", async () => {
    const adapter = new WebAudioAdapter();
    adapter.load("a.mp3");
    await adapter.play();
    adapter.preload("b.mp3");
    expect(instances()[1].loadCount).toBe(1);

    instances()[0].ended = true;
    instances()[0].pause();
    adapter.load("b.mp3");
    expect(instances()[1].loadCount).toBe(1);
    await adapter.play();
    expect(instances()[1].paused).toBe(false);
    expect(adapter.getPosition()).toBe(0);
    adapter.destroy();
  });

  it("после кроссфейда load() активирует предзагруженный элемент с gain 1", async () => {
    const adapter = new WebAudioAdapter();
    adapter.load("a.mp3");
    await adapter.play();
    // Кроссфейд a → b: el1 активен (gain 1), el0 в неактиве с gain 0.
    adapter.load("b.mp3");
    await adapter.play();
    vi.advanceTimersByTime(CROSSFADE_MS + 100);
    const ctx = lastCtx();
    expect(ctx.gains[1].gain.value).toBe(1);

    // Пауза + предзагрузка следующего (c) в el0.
    adapter.pause();
    adapter.preload("c.mp3");
    // Переключение на предзагруженный c через load()-swap (без кроссфейда).
    adapter.load("c.mp3");
    await adapter.play();
    // Бывший неактивный (gain 0) стал активным — gain обязан вернуться к 1.
    expect(ctx.gains[0].gain.value).toBe(1);
    expect(ctx.gains[1].gain.value).toBe(0);
    expect(instances()[0].paused).toBe(false);
    adapter.destroy();
  });

  it("фолбэк без AudioContext: звук через элемент, спектр нули", async () => {
    resetGlobals({ noCtx: true });
    const adapter = new WebAudioAdapter();
    adapter.load("a.mp3");
    await adapter.play();
    expect(instances()[0].paused).toBe(false);
    adapter.setEqualizer([3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const data = new Uint8Array(8);
    adapter.getSpectrum(data);
    expect([...data].every((v) => v === 0)).toBe(true);
    adapter.destroy();
  });

  it("фолбэк при падении createMediaElementSource: элементы пересоздаются", async () => {
    resetGlobals({ throwOnSource: true });
    const adapter = new WebAudioAdapter();
    adapter.load("a.mp3");
    await adapter.play();
    expect(instances().length).toBe(4);
    expect(instances()[2].paused).toBe(false);
    adapter.destroy();
  });
});

describe("WebAudioAdapter: буферный фолбэк (сломанный <audio>)", () => {
  const media = (bytes = 16): Response =>
    ({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(bytes)) }) as Response;

  const stubFetch = (): ReturnType<typeof vi.fn> => {
    const f = vi.fn((url: unknown): Promise<Response> => {
      if (String(url).startsWith(PROXY_BASE)) return Promise.resolve(media());
      return Promise.reject(new Error("CORS blocked"));
    });
    vi.stubGlobal("fetch", f as never);
    return f;
  };

  it("сломанный элемент → переключение на WebAudio-буфер и воспроизведение", async () => {
    const fetchMock = stubFetch();
    const states: PlayerState[] = [];
    const adapter = new WebAudioAdapter();
    adapter.onStateChange((s) => states.push(s));
    FakeAudioElement.broken = true;

    await adapter.load("a.mp3");
    await adapter.play();

    // Элемент так и не принял источник — через probe-интервал переключаемся.
    await vi.advanceTimersByTimeAsync(MEDIA_ELEMENT_PROBE_MS + 100);

    const ctx = lastCtx();
    expect(ctx.elementSources.length).toBe(0); // элементный граф разобран
    expect(ctx.bufferSources.length).toBe(1);
    expect(ctx.bufferSources[0].offset).toBe(0);
    expect(ctx.decodeCalls).toBe(1);
    expect(adapter.getDuration()).toBe(120);
    expect(states).toContain("playing");
    // Прямой fetch заблокирован CORS — идём через встроенный прокси.
    expect(String(fetchMock.mock.calls[1][0])).toContain(`${PROXY_BASE}/audio?url=`);
    adapter.destroy();
  });

  it("пауза/возобновление в буферном режиме сохраняют позицию", async () => {
    stubFetch();
    FakeAudioElement.broken = true;
    const adapter = new WebAudioAdapter();
    await adapter.load("a.mp3");
    await adapter.play();
    await vi.advanceTimersByTimeAsync(MEDIA_ELEMENT_PROBE_MS + 100);

    const ctx = lastCtx();
    ctx.currentTime = 5;
    expect(adapter.getPosition()).toBeCloseTo(5);

    adapter.pause();
    expect(adapter.getPosition()).toBeCloseTo(5);
    const sourcesAfterPause = ctx.bufferSources.length;

    await adapter.play();
    expect(ctx.bufferSources.length).toBe(sourcesAfterPause + 1);
    expect(ctx.bufferSources[sourcesAfterPause].offset).toBeCloseTo(5);
    expect(adapter.getPosition()).toBeCloseTo(5);
    adapter.destroy();
  });

  it("seek во время игры перезапускает источник с нужной позиции", async () => {
    stubFetch();
    FakeAudioElement.broken = true;
    const adapter = new WebAudioAdapter();
    await adapter.load("a.mp3");
    await adapter.play();
    await vi.advanceTimersByTimeAsync(MEDIA_ELEMENT_PROBE_MS + 100);

    const ctx = lastCtx();
    const before = ctx.bufferSources.length;
    adapter.seek(30);
    expect(ctx.bufferSources.length).toBe(before + 1);
    expect(ctx.bufferSources[before].offset).toBe(30);
    expect(adapter.getPosition()).toBe(30);
    adapter.destroy();
  });

  it("эквалайзер и спектр работают в буферном режиме", async () => {
    stubFetch();
    FakeAudioElement.broken = true;
    const adapter = new WebAudioAdapter();
    await adapter.load("a.mp3");
    await adapter.play();
    await vi.advanceTimersByTimeAsync(MEDIA_ELEMENT_PROBE_MS + 100);

    const ctx = lastCtx();
    const gains = new Array(EQ_FREQUENCIES.length).fill(0) as number[];
    gains[0] = 4;
    adapter.setEqualizer(gains);
    expect(ctx.biquads[0].gain.value).toBe(4);

    const data = new Uint8Array(8);
    adapter.getSpectrum(data);
    expect([...data].every((v) => v === 42)).toBe(true);
    adapter.destroy();
  });

  it("preload в буферном режиме переиспользуется без повторной загрузки", async () => {
    const fetchMock = stubFetch();
    FakeAudioElement.broken = true;
    const adapter = new WebAudioAdapter();
    await adapter.load("a.mp3");
    await adapter.play();
    await vi.advanceTimersByTimeAsync(MEDIA_ELEMENT_PROBE_MS + 100);

    adapter.preload("b.mp3");
    await vi.advanceTimersByTimeAsync(0);
    const fetches = fetchMock.mock.calls.length;

    await adapter.load("b.mp3");
    await adapter.play();
    expect(fetchMock.mock.calls.length).toBe(fetches); // буфер не грузился заново
    expect(adapter.getDuration()).toBe(120);
    adapter.destroy();
  });

  it("окончание буфера эмитит ended", async () => {
    stubFetch();
    FakeAudioElement.broken = true;
    const adapter = new WebAudioAdapter();
    const ended = vi.fn();
    adapter.onEnded(ended);
    await adapter.load("a.mp3");
    await adapter.play();
    await vi.advanceTimersByTimeAsync(MEDIA_ELEMENT_PROBE_MS + 100);

    const src = lastCtx().bufferSources[0];
    src.onended?.();
    expect(ended).toHaveBeenCalled();
    expect(adapter.getDuration()).toBe(120);
    adapter.destroy();
  });

  it("здоровый элемент не переключается в буферный режим", async () => {
    stubFetch();
    const adapter = new WebAudioAdapter();
    await adapter.load("a.mp3");
    await adapter.play();
    await vi.advanceTimersByTimeAsync(MEDIA_ELEMENT_READY_PROBE_MS + 100);

    const ctx = lastCtx();
    expect(ctx.elementSources.length).toBe(2);
    expect(ctx.bufferSources.length).toBe(0);
    expect(adapter.getDuration()).toBe(100);
    adapter.destroy();
  });

  it("элемент без метаданных (readyState 0) переключается на буфер второй пробой", async () => {
    stubFetch();
    FakeAudioElement.stuckMetadata = true;
    const adapter = new WebAudioAdapter();
    await adapter.load("a.mp3");
    await adapter.play();
    // Первая проба: currentSrc принят — не переключается.
    await vi.advanceTimersByTimeAsync(MEDIA_ELEMENT_PROBE_MS + 100);
    expect(lastCtx().elementSources.length).toBe(2);
    expect(lastCtx().bufferSources.length).toBe(0);
    // Вторая проба: метаданные так и не пришли — уходим на буфер.
    await vi.advanceTimersByTimeAsync(MEDIA_ELEMENT_READY_PROBE_MS - MEDIA_ELEMENT_PROBE_MS);
    const ctx = lastCtx();
    expect(ctx.elementSources.length).toBe(0);
    expect(ctx.bufferSources.length).toBe(1);
    expect(ctx.decodeCalls).toBe(1);
    expect(adapter.getDuration()).toBe(120);
    adapter.destroy();
  });

  it("LRU-кеш буферов: повторная загрузка источника без fetch и декодирования", async () => {
    const fetchMock = stubFetch();
    FakeAudioElement.broken = true;
    const adapter = new WebAudioAdapter();
    await adapter.load("a.mp3");
    await adapter.play();
    await vi.advanceTimersByTimeAsync(MEDIA_ELEMENT_PROBE_MS + 100);
    const fetches = fetchMock.mock.calls.length;
    const decodes = lastCtx().decodeCalls;

    adapter.pause();
    await adapter.load("a.mp3");
    await adapter.play();

    expect(fetchMock.mock.calls.length).toBe(fetches);
    expect(lastCtx().decodeCalls).toBe(decodes);
    expect(adapter.getDuration()).toBe(120);
    adapter.destroy();
  });

  it("LRU-кеш ограничен и вытесняет старые буферы", async () => {
    const fetchMock = stubFetch();
    FakeAudioElement.broken = true;
    const adapter = new WebAudioAdapter();
    // Первый трек — элементный режим; проба переводит в буферный и кеширует его.
    await adapter.load("a.mp3");
    await adapter.play();
    await vi.advanceTimersByTimeAsync(MEDIA_ELEMENT_PROBE_MS + 100);
    // Дальше всё грузится уже буферным путём (LRU пополняется).
    for (const u of ["b.mp3", "c.mp3", "d.mp3", "e.mp3", "f.mp3"]) {
      await adapter.load(u);
      await adapter.play();
    }
    const fetchesAfterFill = fetchMock.mock.calls.length;

    // "a.mp3" вытеснен (в кеше c,d,e,f) — источник грузится заново.
    await adapter.load("a.mp3");
    await adapter.play();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(fetchesAfterFill);

    // "f.mp3" ещё в кеше — повторный fetch не нужен.
    const fetchesAfterReload = fetchMock.mock.calls.length;
    await adapter.load("f.mp3");
    await adapter.play();
    expect(fetchMock.mock.calls.length).toBe(fetchesAfterReload);
    adapter.destroy();
  });
});
