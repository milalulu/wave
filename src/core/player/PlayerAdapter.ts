import type { PlayerState } from "../types";

export interface AudioAdapter {
  
  load(src: string): Promise<void>;
  
  preload(src: string): void;
  
  getSpectrum(data: Uint8Array): void;
  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): void;
  setVolume(volume: number): void;
  setPlaybackRate(rate: number): void;
  setEqualizer(gains: number[]): void;
  
  setCrossfadeMs(ms: number): void;
  setBassBoost(db: number): void;
  setReverb(mix: number): void;
  setStereoWidth(pan: number): void;
  getPosition(): number;
  getDuration(): number;
  onStateChange(cb: (state: PlayerState) => void): () => void;
  onTimeUpdate(cb: (position: number, duration: number) => void): () => void;
  onEnded(cb: () => void): () => void;
  onError(cb: (message: string) => void): () => void;
  destroy(): void;
}

export class MockAudioAdapter implements AudioAdapter {
  src = "";
  state: PlayerState = "idle";
  position = 0;
  duration = 100;
  volume = 1;
  rate = 1;
  equalizer: number[] = [];
  private handlers: {
    state?: (s: PlayerState) => void;
    time?: (p: number, d: number) => void;
    ended?: () => void;
    error?: (m: string) => void;
  } = {};

  async load(src: string): Promise<void> {
    this.src = src;
    this.position = 0;
  }

  async play(): Promise<void> {
    this.setState("playing");
  }

  preload(_src: string): void {
    
  }

  getSpectrum(data: Uint8Array): void {
    data.fill(0);
  }

  pause(): void {
    this.setState("paused");
  }

  seek(seconds: number): void {
    this.position = seconds;
  }

  setVolume(volume: number): void {
    this.volume = volume;
  }

  setPlaybackRate(rate: number): void {
    this.rate = rate;
  }

  setEqualizer(gains: number[]): void {
    this.equalizer = [...gains];
  }

  setCrossfadeMs(_ms: number): void {
    
  }

  setBassBoost(_db: number): void {
    
  }

  setReverb(_mix: number): void {
    
  }

  setStereoWidth(_pan: number): void {
    
  }

  getPosition(): number {
    return this.position;
  }

  getDuration(): number {
    return this.duration;
  }

  onStateChange(cb: (s: PlayerState) => void): () => void {
    this.handlers.state = cb;
    return () => {
      this.handlers.state = undefined;
    };
  }

  onTimeUpdate(cb: (p: number, d: number) => void): () => void {
    this.handlers.time = cb;
    return () => {
      this.handlers.time = undefined;
    };
  }

  onEnded(cb: () => void): () => void {
    this.handlers.ended = cb;
    return () => {
      this.handlers.ended = undefined;
    };
  }

  onError(cb: (m: string) => void): () => void {
    this.handlers.error = cb;
    return () => {
      this.handlers.error = undefined;
    };
  }

  destroy(): void {
    this.handlers = {};
    this.state = "idle";
  }

  
  setState(s: PlayerState): void {
    this.state = s;
    this.handlers.state?.(s);
  }

  tick(seconds: number): void {
    this.position = seconds;
    this.handlers.time?.(this.position, this.duration);
  }

  end(): void {
    this.handlers.ended?.();
  }

  fail(message: string): void {
    this.handlers.error?.(message);
  }
}
