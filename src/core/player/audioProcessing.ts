import { EQ_FREQUENCIES, normalizeEqualizer, sanitizeAudioValue } from "./equalizerPresets";
import { dbToGain, rmsToDb } from "./leveling";

export const GAIN_TAU = 0.05;
const BASS_HZ = 115;
const SAMPLE_CEILING = dbToGain(-0.5);
const ROOM_SECONDS = 1.25;
const METER_SAMPLES = 4096;

export function stereoSideGain(width: number): number {
  return width < 0 ? 1 + width : 1 + width * 0.65;
}

type Biquad = [number, number, number, number, number, number];

function filterResponse(sampleRate: number, frequency: number, gain: number, type: BiquadFilterType): Biquad {
  const a = dbToGain(gain / 2);
  const angle = 2 * Math.PI * Math.min(frequency, sampleRate * 0.47) / sampleRate;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  if (type === "peaking") {
    const alpha = s / 2;
    return [1 + alpha * a, -2 * c, 1 - alpha * a, 1 + alpha / a, -2 * c, 1 - alpha / a];
  }
  // RBJ shelf coefficients with S=1, the default shelf slope in Web Audio.
  const p = a + 1;
  const m = a - 1;
  const beta = Math.sqrt(2 * a) * s;
  if (type === "lowshelf") {
    return [
      a * (p - m * c + beta), 2 * a * (m - p * c), a * (p - m * c - beta),
      p + m * c + beta, -2 * (m + p * c), p + m * c - beta,
    ];
  }
  return [
    a * (p + m * c + beta), -2 * a * (m + p * c), a * (p + m * c - beta),
    p - m * c + beta, 2 * (m - p * c), p - m * c - beta,
  ];
}

function eqType(index: number): BiquadFilterType {
  if (index === 0) return "lowshelf";
  return index === EQ_FREQUENCIES.length - 1 ? "highshelf" : "peaking";
}

export function processingHeadroom(sampleRate: number, gains: readonly number[], bass: number, width: number): number {
  if (!gains.some((gain) => gain > 0) && bass <= 0) return 1 / Math.max(1, stereoSideGain(width));
  const filters = gains.flatMap((gain, index) =>
    gain === 0 ? [] : [filterResponse(sampleRate, EQ_FREQUENCIES[index], gain, eqType(index))]);
  if (bass > 0) filters.push(filterResponse(sampleRate, BASS_HZ, bass, "lowshelf"));
  let peak = 1;
  const frequencies = [0, BASS_HZ, ...EQ_FREQUENCIES,
    ...Array.from({ length: 96 }, (_, index) => 20 * (sampleRate / 40) ** (index / 95))];
  for (const hz of frequencies) {
    const angle = Math.PI * 2 * Math.min(hz, sampleRate * 0.499) / sampleRate;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    // Multiply the squared responses without taking a square root for each section.
    let power = 1;
    for (const [b0, b1, b2, a0, a1, a2] of filters) {
      power *= (((b0 + b2) * c + b1) ** 2 + ((b0 - b2) * s) ** 2) /
        (((a0 + a2) * c + a1) ** 2 + ((a0 - a2) * s) ** 2);
    }
    peak = Math.max(peak, power);
  }
  return 1 / (Math.sqrt(peak) * Math.max(1, stereoSideGain(width)));
}

function createRoomImpulse(ctx: BaseAudioContext): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.round(rate * ROOM_SECONDS);
  const delay = Math.round(rate * 0.016);
  const impulse = ctx.createBuffer(2, length, rate);
  const damping = 1 - Math.exp(-2 * Math.PI * 4100 / rate);
  const bassCut = 1 - Math.exp(-2 * Math.PI * 160 / rate);
  for (let channel = 0; channel < 2; channel++) {
    const samples = impulse.getChannelData(channel);
    let random = 0x14aed1 + channel * 917;
    let dark = 0;
    let low = 0;
    for (let i = delay; i < samples.length; i++) {
      random = (Math.imul(random, 1664525) + 1013904223) | 0;
      dark += damping * ((random / 0x80000000) - dark);
      low += bassCut * (dark - low);
      const seconds = (i - delay) / rate;
      samples[i] = (dark - low) * Math.min(1, seconds / 0.026) * Math.exp(-seconds * 6.2);
    }
    for (const [seconds, strength] of [[.019, .53], [.031, -.32], [.048, .24], [.077, .15]]) {
      const index = Math.round((seconds + channel * .002) * rate);
      if (index < samples.length) samples[index] += strength;
    }
  }
  return impulse;
}

export interface AudioProcessingSettings {
  gains: readonly number[];
  bass: number;
  reverb: number;
  width: number;
  volume: number;
  orbit?: number;
}

export class AudioProcessing {
  readonly input: GainNode;
  readonly spectrum: AnalyserNode;
  private readonly bands: BiquadFilterNode[];
  private readonly bass: BiquadFilterNode;
  private readonly room: ConvolverNode;
  private readonly wet: GainNode;
  private readonly dry: GainNode;
  private readonly direct: GainNode[];
  private readonly cross: GainNode[];
  private readonly orbitPanner: StereoPannerNode | null;
  private orbitDepth: GainNode | null = null;
  private readonly meters: AnalyserNode[];
  private readonly samples = new Float32Array(METER_SAMPLES);
  private readonly targets = new Map<AudioParam, number>();
  readonly level: GainNode;
  readonly master: GainNode;
  readonly headroom: GainNode;
  readonly limiter: DynamicsCompressorNode | null;

  constructor(private readonly ctx: BaseAudioContext, settings: AudioProcessingSettings) {
    this.input = ctx.createGain();
    this.input.channelCount = 2;
    this.input.channelCountMode = "explicit";
    this.input.channelInterpretation = "speakers";
    const meterSplit = ctx.createChannelSplitter(2);
    this.input.connect(meterSplit);
    this.meters = [0, 1].map((channel) => {
      const meter = ctx.createAnalyser();
      meter.fftSize = METER_SAMPLES;
      meterSplit.connect(meter, channel);
      return meter;
    });

    this.level = ctx.createGain();
    this.input.connect(this.level);
    this.bands = EQ_FREQUENCIES.map((frequency, index) => {
      const band = ctx.createBiquadFilter();
      band.type = eqType(index);
      band.frequency.value = Math.min(frequency, ctx.sampleRate * 0.47);
      band.Q.value = 1;
      return band;
    });
    let previous: AudioNode = this.level;
    for (const band of this.bands) {
      previous.connect(band);
      previous = band;
    }
    this.bass = ctx.createBiquadFilter();
    this.bass.type = "lowshelf";
    this.bass.frequency.value = BASS_HZ;
    previous.connect(this.bass);
    this.room = ctx.createConvolver();
    this.wet = ctx.createGain();
    this.dry = ctx.createGain();
    const stereo = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);
    this.bass.connect(this.room);
    this.room.connect(this.wet);
    this.bass.connect(this.dry);
    this.dry.connect(stereo);
    this.wet.connect(stereo);
    this.direct = [];
    this.cross = [];
    for (const channel of [0, 1]) {
      const direct = ctx.createGain();
      const cross = ctx.createGain();
      stereo.connect(direct, channel);
      stereo.connect(cross, channel);
      direct.connect(merger, 0, channel);
      cross.connect(merger, 0, 1 - channel);
      this.direct.push(direct);
      this.cross.push(cross);
    }
    this.spectrum = ctx.createAnalyser();
    this.spectrum.fftSize = 256;
    this.orbitPanner = typeof ctx.createStereoPanner === "function" ? ctx.createStereoPanner() : null;
    if (this.orbitPanner) {
      merger.connect(this.orbitPanner);
      this.orbitPanner.connect(this.spectrum);
    } else {
      merger.connect(this.spectrum);
    }
    this.headroom = ctx.createGain();
    this.spectrum.connect(this.headroom);
    this.limiter = typeof ctx.createDynamicsCompressor === "function" ? ctx.createDynamicsCompressor() : null;
    let output: AudioNode = this.headroom;
    if (this.limiter) {
      this.limiter.threshold.value = -1.5;
      this.limiter.knee.value = 1;
      this.limiter.ratio.value = 20;
      this.limiter.attack.value = .003;
      this.limiter.release.value = .11;
      output.connect(this.limiter);
      output = this.limiter;
    }
    if (typeof ctx.createWaveShaper === "function") {
      const ceiling = ctx.createWaveShaper();
      const knee = .89;
      ceiling.curve = Float32Array.from({ length: 2049 }, (_, index) => {
        const value = index / 1024 - 1;
        const magnitude = Math.abs(value);
        return magnitude <= knee ? value : Math.sign(value) * (knee + (SAMPLE_CEILING - knee) *
          Math.tanh((magnitude - knee) / (SAMPLE_CEILING - knee)));
      });
      output.connect(ceiling);
      output = ceiling;
    }
    this.master = ctx.createGain();
    output.connect(this.master);
    this.master.connect(ctx.destination);
    this.update(settings, true);
  }

  update(settings: AudioProcessingSettings, immediate = false): void {
    const gains = normalizeEqualizer(settings.gains);
    const bass = sanitizeAudioValue(settings.bass, 0, 15);
    const mix = sanitizeAudioValue(settings.reverb, 0, 1);
    const width = sanitizeAudioValue(settings.width, -1, 1);
    const side = stereoSideGain(width);
    const apply = (param: AudioParam, value: number) => this.apply(param, value, immediate);
    if (mix > 0 && !this.room.buffer) this.room.buffer = createRoomImpulse(this.ctx);
    this.bands.forEach((band, index) => apply(band.gain, gains[index]));
    apply(this.bass.gain, bass);
    apply(this.wet.gain, mix * .72);
    apply(this.dry.gain, 1 - mix * .12);
    for (const node of this.direct) apply(node.gain, (1 + side) / 2);
    for (const node of this.cross) apply(node.gain, (1 - side) / 2);
    const orbit = sanitizeAudioValue(settings.orbit, 0, 1);
    if (orbit > 0 && this.orbitPanner && !this.orbitDepth && typeof this.ctx.createOscillator === "function") {
      this.orbitDepth = this.ctx.createGain();
      this.orbitDepth.gain.value = 0;
      const oscillator = this.ctx.createOscillator();
      oscillator.frequency.value = 0.125;
      oscillator.connect(this.orbitDepth);
      this.orbitDepth.connect(this.orbitPanner.pan);
      oscillator.start();
    }
    if (this.orbitDepth) apply(this.orbitDepth.gain, orbit * 0.66);
    const orbitHeadroom = this.orbitDepth ? 1 + orbit * .56 : 1;
    apply(this.headroom.gain, processingHeadroom(this.ctx.sampleRate, gains, bass, width) / orbitHeadroom);
    this.setVolume(settings.volume, immediate);
  }

  setVolume(volume: number, immediate = false): void {
    this.apply(this.master.gain, sanitizeAudioValue(volume, 0, 1, 1), immediate);
  }

  private apply(param: AudioParam, value: number, immediate: boolean): void {
    if (this.targets.get(param) === value) return;
    this.targets.set(param, value);
    if (immediate) param.value = value;
    else param.setTargetAtTime(value, this.ctx.currentTime, GAIN_TAU);
  }

  inputLevelDb(): number {
    let power = 0;
    for (const meter of this.meters) {
      meter.getFloatTimeDomainData(this.samples);
      for (const sample of this.samples) power += sample * sample;
    }
    return rmsToDb(Math.sqrt(power / (this.meters.length * this.samples.length)));
  }
}
