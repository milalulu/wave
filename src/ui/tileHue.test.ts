import { describe, expect, it } from "vitest";
import { tileHue, tileStyle } from "./tileHue";

describe("tileHue", () => {
  it("детерминирован и в диапазоне", () => {
    expect(tileHue("Billie Eilish")).toBe(tileHue("Billie Eilish"));
    const h = tileHue("Billie Eilish");
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
    expect(Number.isInteger(h)).toBe(true);
  });

  it("разные имена обычно дают разные hue", () => {
    const hues = new Set(["a", "b", "c", "Dj Smash", "EZEERO", "'sdf'"].map(tileHue));
    expect(hues.size).toBeGreaterThan(3);
  });

  it("tileStyle отдаёт переменную или пусто", () => {
    expect(tileStyle("AB")).toEqual({ "--tile-h": String(tileHue("AB")) });
    expect(tileStyle()).toEqual({});
    expect(tileStyle("")).toEqual({});
  });
});
