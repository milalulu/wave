import { describe, expect, it } from "vitest";
import { loadAlarm, nextAlarmTimestamp, saveAlarm } from "./alarm";

describe("alarm", () => {
  it("следующее срабатывание: сегодня или завтра", () => {
    // 2026-09-10 08:00 local
    const morning = new Date(2026, 8, 10, 8, 0, 0).getTime();
    const sameDay = nextAlarmTimestamp(9, 30, morning);
    expect(new Date(sameDay).getHours()).toBe(9);
    expect(new Date(sameDay).getDate()).toBe(10);
    const nextDay = nextAlarmTimestamp(7, 0, morning);
    expect(new Date(nextDay).getHours()).toBe(7);
    expect(new Date(nextDay).getDate()).toBe(11);
  });

  it("сохранение/чтение с клампами", () => {
    saveAlarm({ enabled: true, hour: 25, minute: -5, mode: "playlist", playlistId: "p1" });
    expect(loadAlarm()).toMatchObject({ enabled: true, hour: 23, minute: 0, mode: "playlist" });
    saveAlarm(null);
    expect(loadAlarm()).toBeNull();
  });

  it("битый JSON даёт null", () => {
    localStorage.setItem("wave:alarm", "{oops");
    expect(loadAlarm()).toBeNull();
    localStorage.clear();
  });
});
