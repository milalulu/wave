import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEVELING_OPTIONS,
  Leveler,
  dbToGain,
  desiredGainDb,
  rmsOfSamples,
  rmsToDb,
} from "./leveling";

describe("leveling math", () => {
  it("rmsToDb/dbToGain согласованы", () => {
    expect(rmsToDb(1)).toBeCloseTo(0, 10);
    expect(rmsToDb(0.5)).toBeCloseTo(-6.02, 2);
    expect(rmsToDb(0)).toBe(-Infinity);
    expect(dbToGain(-6.0206)).toBeCloseTo(0.5, 3);
  });

  it("desiredGainDb тянет к цели в пределах клампов", () => {
    const o = DEFAULT_LEVELING_OPTIONS;
    expect(desiredGainDb(-14, o)).toBeCloseTo(0, 10); // уже цель
    expect(desiredGainDb(-8, o)).toBeCloseTo(-6, 10); // громко -> ослабить
    expect(desiredGainDb(-26, o)).toBeCloseTo(12, 10); // тихо -> усилить до максимума
    expect(desiredGainDb(-60, o)).toBe(0); // тишина: держать
    expect(desiredGainDb(-Infinity, o)).toBe(0);
  });

  it("rmsOfSamples считает RMS", () => {
    expect(rmsOfSamples(new Float32Array([1, -1, 1, -1]))).toBeCloseTo(1, 10);
    expect(rmsOfSamples(new Float32Array([0.5, 0.5]))).toBeCloseTo(0.5, 10);
    expect(rmsOfSamples(new Float32Array(0))).toBe(0);
  });
});

describe("Leveler", () => {
  it("сходится к цели и уважает скорость атаки/релиза", () => {
    const lv = new Leveler({ ...DEFAULT_LEVELING_OPTIONS, attackDbPerSec: 10, releaseDbPerSec: 5 });
    // Громкий трек (−4 дБ при цели −14): нужно −10 дБ, шаг 0.1с даёт −1 дБ.
    expect(lv.step(-4, 0.1)).toBeCloseTo(dbToGain(-1), 5);
    // Тихий трек (−26 дБ): нужно +12 дБ, релиз 5 дБ/с -> +0.5 дБ за 0.1с от текущих −1.
    expect(lv.step(-26, 0.1)).toBeCloseTo(dbToGain(-0.5), 5);
  });

  it("держит gain в тишине и сходится за достаточное время", () => {
    const lv = new Leveler();
    lv.step(-4, 1);
    const held = lv.currentGainDb;
    lv.step(-70, 5);
    expect(lv.currentGainDb).toBe(held);
    const lv2 = new Leveler();
    for (let i = 0; i < 200; i++) lv2.step(-4, 0.1);
    expect(lv2.currentGainDb).toBeCloseTo(-10, 6);
  });

  it("reset возвращает gain к единице", () => {
    const lv = new Leveler();
    lv.step(-4, 1);
    expect(lv.currentGain).toBeLessThan(1);
    lv.reset();
    expect(lv.currentGain).toBe(1);
  });
});
