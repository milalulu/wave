import { describe, expect, it } from "vitest";
import { isTabView, parentTab, TAB_KEYS } from "./MobileNav";

describe("MobileNav tab helpers", () => {
  it("TAB_KEYS lists the five root tabs", () => {
    expect(TAB_KEYS).toEqual(["home", "search", "wave", "library", "settings"]);
  });

  it("isTabView is true only for root tabs", () => {
    for (const key of TAB_KEYS) expect(isTabView(key)).toBe(true);
    expect(isTabView("nowPlaying")).toBe(false);
    expect(isTabView("album")).toBe(false);
    expect(isTabView("queue")).toBe(false);
    expect(isTabView("downloads")).toBe(false);
  });

  it("parentTab maps sub-views to the library tab", () => {
    expect(parentTab("album")).toBe("library");
    expect(parentTab("artist")).toBe("library");
    expect(parentTab("playlist")).toBe("library");
    expect(parentTab("queue")).toBe("library");
    expect(parentTab("downloads")).toBe("library");
    expect(parentTab("home")).toBeNull();
    expect(parentTab("search")).toBeNull();
    expect(parentTab("wave")).toBeNull();
    expect(parentTab("settings")).toBeNull();
  });
});
