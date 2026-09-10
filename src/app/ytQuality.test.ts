import { afterEach, describe, expect, it } from "vitest";
import {
  connectionKind,
  loadMobileYtQuality,
  loadYtQuality,
  resolveYtQuality,
  saveMobileYtQuality,
  saveYtQuality,
} from "./ytQuality";

afterEach(() => {
  localStorage.clear();
  const nav = globalThis.navigator as unknown as Record<string, unknown> | undefined;
  if (nav && "connection" in nav) delete nav.connection;
});

function setConnectionType(type: string): void {
  const nav = (globalThis.navigator ?? {}) as unknown as Record<string, unknown>;
  nav.connection = { type };
  Object.defineProperty(globalThis, "navigator", { configurable: true, writable: true, value: nav });
}

describe("ytQuality", () => {
  it("хранит wifi и мобильное качество отдельно", () => {
    expect(loadYtQuality()).toBe("best");
    expect(loadMobileYtQuality()).toBe("medium");
    saveYtQuality("high");
    saveMobileYtQuality("low");
    expect(loadYtQuality()).toBe("high");
    expect(loadMobileYtQuality()).toBe("low");
  });

  it("отбрасывает мусор", () => {
    localStorage.setItem("wave:yt-quality", "ultra");
    expect(loadYtQuality()).toBe("best");
  });

  it("выбирает качество по типу сети", () => {
    saveYtQuality("best");
    saveMobileYtQuality("low");
    setConnectionType("wifi");
    expect(connectionKind()).toBe("wifi");
    expect(resolveYtQuality()).toBe("best");
    setConnectionType("cellular");
    expect(connectionKind()).toBe("cellular");
    expect(resolveYtQuality()).toBe("low");
  });

  it("без Network API считает сеть неизвестной и берёт wifi-качество", () => {
    saveYtQuality("high");
    expect(connectionKind()).toBe("unknown");
    expect(resolveYtQuality()).toBe("high");
  });
});
