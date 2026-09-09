// Адаптивное выравнивание громкости (voice-recorder style AGC для музыки):
// измеренный RMS-уровень трека плавно подтягивается к целевому gain'ом.
// Чистые функции + маленький stateful Leveler; AudioContext не требуется.

export interface LevelingOptions {
  /** Целевой уровень, дБ (типично −14). */
  targetDb: number;
  /** Максимальное усиление, дБ (защита от накачки тишины/шума). */
  maxGainDb: number;
  /** Максимальное ослабление, дБ. */
  minGainDb: number;
  /** Скорость нарастания усиления, дБ/с. */
  attackDbPerSec: number;
  /** Скорость спада усиления, дБ/с (медленнее атаки — без «пампинга»). */
  releaseDbPerSec: number;
  /** Ниже этого уровня считаем тишиной и держим gain. */
  silenceDb: number;
}

export const DEFAULT_LEVELING_OPTIONS: LevelingOptions = {
  targetDb: -14,
  maxGainDb: 12,
  minGainDb: -12,
  attackDbPerSec: 12,
  releaseDbPerSec: 4,
  silenceDb: -60,
};

export function rmsToDb(rms: number): number {
  if (!(rms > 0)) return -Infinity;
  return 20 * Math.log10(rms);
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Мгновенно желаемый gain (в дБ) для измеренного уровня. */
export function desiredGainDb(levelDb: number, opts: LevelingOptions): number {
  if (!Number.isFinite(levelDb) || levelDb <= opts.silenceDb) return 0;
  const need = opts.targetDb - levelDb;
  return Math.min(opts.maxGainDb, Math.max(opts.minGainDb, need));
}

export class Leveler {
  private gainDb = 0;

  constructor(private opts: LevelingOptions = DEFAULT_LEVELING_OPTIONS) {}

  reset(): void {
    this.gainDb = 0;
  }

  get currentGainDb(): number {
    return this.gainDb;
  }

  get currentGain(): number {
    return dbToGain(this.gainDb);
  }

  /**
   * Один шаг адаптации. Возвращает новый линейный gain.
   * @param levelDb измеренный уровень текущего окна, дБ
   * @param dtSec длительность окна, с
   */
  step(levelDb: number, dtSec: number): number {
    if (!(dtSec > 0)) return this.currentGain;
    if (!Number.isFinite(levelDb) || levelDb <= this.opts.silenceDb) {
      return this.currentGain; // тишина: держим gain, не качаем шум
    }
    const want = desiredGainDb(levelDb, this.opts);
    const diff = want - this.gainDb;
    if (diff === 0) return this.currentGain;
    // К цели идём быстро (атака), от неё — медленно (релиз).
    const rate = diff > 0 ? this.opts.releaseDbPerSec : this.opts.attackDbPerSec;
    const maxStep = rate * dtSec;
    this.gainDb += Math.sign(diff) * Math.min(Math.abs(diff), maxStep);
    return this.currentGain;
  }
}

/** RMS по float-сэмплам (−1..1) из AnalyserNode.getFloatTimeDomainData. */
export function rmsOfSamples(samples: ArrayLike<number>): number {
  const n = samples.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = samples[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum / n);
}
