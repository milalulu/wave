import { describe, expect, it } from "vitest";
import { EQ_FREQUENCIES, EQ_PRESETS } from "./equalizerPresets";

describe("equalizer presets", () => {
  it("все пресеты имеют длину 10 полос и усиления в диапазоне -12..12", () => {
    for (const preset of EQ_PRESETS) {
      expect(preset.gains).toHaveLength(EQ_FREQUENCIES.length);
      for (const g of preset.gains) {
        expect(g).toBeGreaterThanOrEqual(-12);
        expect(g).toBeLessThanOrEqual(12);
      }
    }
  });

  it("содержит плоский пресет с нулевыми усилениями", () => {
    const flat = EQ_PRESETS.find((p) => p.id === "flat");
    expect(flat?.gains.every((g) => g === 0)).toBe(true);
  });

  it("id пресетов уникальны", () => {
    const ids = EQ_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
