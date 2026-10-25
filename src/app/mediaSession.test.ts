// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { bindMediaSession } from "./mediaSession";
import type { AppServices } from "./compose";

afterEach(() => vi.restoreAllMocks());
function setup(unsupported?: string) {
  const handlers = new Map<string, MediaSessionActionHandler>();
  const mediaSession = {
    metadata: null, playbackState: "none", setPositionState: vi.fn(),
    setActionHandler: (action: string, handler: MediaSessionActionHandler) => {
      if (action === unsupported) throw new Error("unsupported");
      handlers.set(action, handler);
    },
  };
  vi.spyOn(navigator, "mediaSession", "get").mockReturnValue(mediaSession as unknown as MediaSession);
  const actions = { play: vi.fn(), pause: vi.fn(), next: vi.fn(), previous: vi.fn(), seek: vi.fn() };
  const engine = { snapshot: { current: null, position: 50, duration: 200, speed: 1.25 }, on: vi.fn() };
  bindMediaSession({ engine } as unknown as AppServices, actions);
  return { actions, handlers };
}

// jsdom has no mediaSession implementation.
Object.defineProperty(navigator, "mediaSession", { configurable: true, get: () => ({}) });

describe("system media controls", () => {
  it("uses explicit play/pause and signed relative seek with a default offset", () => {
    const { handlers, actions } = setup();
    for (const action of ["play", "pause", "seekbackward", "seekforward"] as const) handlers.get(action)!({ action });
    expect(actions.play).toHaveBeenCalledOnce();
    expect(actions.pause).toHaveBeenCalledOnce();
    expect(actions.seek.mock.calls).toEqual([[40], [60]]);
    handlers.get("seekbackward")!({ action: "seekbackward", seekOffset: 80 });
    expect(actions.seek).toHaveBeenLastCalledWith(0);
  });
  it("keeps supported controls when a WebView rejects seekto", () => {
    const { handlers } = setup("seekto");
    expect(handlers.has("seekbackward")).toBe(true);
    expect(handlers.has("play")).toBe(true);
  });
});
