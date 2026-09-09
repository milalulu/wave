import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LEVELING, loadLeveling, saveLeveling } from "./levelingStore";

beforeEach(() => localStorage.clear());

describe("levelingStore", () => {
  it("возвращает дефолт (выключено, −14) без сохранений", () => {
    expect(loadLeveling()).toEqual(DEFAULT_LEVELING);
    expect(DEFAULT_LEVELING.enabled).toBe(false);
  });

  it("сохраняет и читает настройки", () => {
    saveLeveling({ enabled: true, targetDb: -10 });
    expect(loadLeveling()).toEqual({ enabled: true, targetDb: -10 });
  });

  it("клампит цель и переживает битый JSON", () => {
    saveLeveling({ enabled: true, targetDb: -100 });
    expect(loadLeveling().targetDb).toBe(-30);
    localStorage.setItem("wave:leveling", "not-json{{{");
    expect(loadLeveling()).toEqual(DEFAULT_LEVELING);
  });
});
