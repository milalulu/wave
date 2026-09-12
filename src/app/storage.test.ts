import { describe, expect, it } from "vitest";
import { pickStorage } from "./storage";
import { MemoryStorage } from "../core/database/MemoryStorage";

describe("pickStorage", () => {
  it("берёт sqlite когда он доступен", async () => {
    const sql = new MemoryStorage();
    const { storage, backend } = await pickStorage(() => sql, () => new MemoryStorage());
    expect(backend).toBe("sqlite");
    expect(storage).toBe(sql);
  });

  it("падает на memory когда sqlite бросает", async () => {
    const broken = {
      init: async () => {
        throw new Error("no sql plugin");
      },
    };
    const mem = new MemoryStorage();
    const { storage, backend } = await pickStorage(() => broken as never, () => mem);
    expect(backend).toBe("memory");
    expect(storage).toBe(mem);
    // Фолбэк рабочий: пишет и читает.
    await storage.addLikedTrack({ id: "t1", provider: "test", uri: "u", title: "T" });
    expect(await storage.isLiked("t1")).toBe(true);
  });

  it("не падает если ломаются оба (пробрасывает ошибку memory)", async () => {
    const broken = {
      init: async () => {
        throw new Error("x");
      },
    };
    await expect(pickStorage(() => broken as never, () => broken as never)).rejects.toThrow();
  });
});
