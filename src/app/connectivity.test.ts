// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { currentConnectivity, watchConnectivity } from "./connectivity";

describe("connectivity", () => {
  it("читает статус через провайдер", () => {
    expect(currentConnectivity(() => true)).toBe("online");
    expect(currentConnectivity(() => false)).toBe("offline");
  });

  it("зовёт колбэк на событиях окна", () => {
    let online = true;
    const cb = vi.fn();
    const stop = watchConnectivity(cb, () => online);
    window.dispatchEvent(new Event("offline"));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith("online");
    online = false;
    window.dispatchEvent(new Event("offline"));
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenLastCalledWith("offline");
    online = true;
    window.dispatchEvent(new Event("online"));
    expect(cb).toHaveBeenLastCalledWith("online");
    stop();
    window.dispatchEvent(new Event("offline"));
    expect(cb).toHaveBeenCalledTimes(3);
  });
});
