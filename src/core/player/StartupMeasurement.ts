export type StartupPhase = "resolve" | "validate" | "load" | "play";
export interface StartupTiming {
  provider: string;
  outcome: "playing" | "failed" | "cancelled";
  totalMs: number;
  phases: Record<StartupPhase, number>;
}

/** Local diagnostics only; never includes track names, IDs or signed URLs. */
export class StartupMeasurement {
  private started = performance.now();
  private phases = { resolve: 0, validate: 0, load: 0, play: 0 };
  constructor(private provider: string) {}
  async measure<T>(phase: StartupPhase, work: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try { return await work(); }
    finally { this.phases[phase] += Math.max(0, performance.now() - start); }
  }
  finish(outcome: StartupTiming["outcome"]): StartupTiming {
    return {
      provider: this.provider, outcome,
      totalMs: Math.max(0, performance.now() - this.started),
      phases: { ...this.phases },
    };
  }
}
