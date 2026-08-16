import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CROSSFADE_OPTIONS, loadCrossfadeMs, saveCrossfadeMs } from "./crossfade";

function makeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

describe("crossfade", () => {
  let storage: Storage;
  let original: Storage | undefined;

  beforeEach(() => {
    storage = makeStorage();
    original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  });

  afterEach(() => {
    if (original === undefined) {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    } else {
      Object.defineProperty(globalThis, "localStorage", { value: original, configurable: true });
    }
  });

  it("defaults to 300ms when nothing is saved", () => {
    expect(loadCrossfadeMs()).toBe(300);
  });

  it("loads a saved option", () => {
    saveCrossfadeMs(500);
    expect(loadCrossfadeMs()).toBe(500);
  });

  it("falls back to 300ms for an unknown value", () => {
    storage.setItem("wave:crossfade-ms", "777");
    expect(loadCrossfadeMs()).toBe(300);
  });

  it("all options are valid", () => {
    for (const option of CROSSFADE_OPTIONS) {
      saveCrossfadeMs(option);
      expect(loadCrossfadeMs()).toBe(option);
    }
  });
});
