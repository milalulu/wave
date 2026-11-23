import { describe, expect, it, vi } from "vitest";
import { getHlsPlaybackMode } from "./hlsPlayback";

function capabilities({ standard = false, mse = false, native = false, type = "" } = {}) {
  const isTypeSupported = vi.fn((mime: string) => mime === type);
  return {
    hls: {
      isSupported: () => standard,
      isMSESupported: () => mse,
      getMediaSource: () => ({ isTypeSupported }),
    },
    element: { canPlayType: (): CanPlayTypeResult => native ? "maybe" : "" },
    isTypeSupported,
  };
}

describe("HLS audio capability", () => {
  it("preserves the standard media-source and native paths", () => {
    const standard = capabilities({ standard: true, native: true });
    expect(getHlsPlaybackMode(standard.hls, standard.element)).toBe("media-source");
    const native = capabilities({ native: true });
    expect(getHlsPlaybackMode(native.hls, native.element)).toBe("native");
  });

  it.each(["audio/mpeg", 'audio/mp4; codecs="mp3"', 'audio/mp4; codecs="opus"'])(
    "allows hls.js to use %s when its standard probe fails", (type) => {
      const { hls, element } = capabilities({ mse: true, native: true, type });
      expect(getHlsPlaybackMode(hls, element)).toBe("media-source");
    },
  );

  it("requires a supported audio format and valid MediaSource APIs", () => {
    const missingCodec = capabilities({ mse: true });
    expect(getHlsPlaybackMode(missingCodec.hls, missingCodec.element)).toBe("unavailable");
    const missingApi = capabilities({ type: "audio/mpeg" });
    expect(getHlsPlaybackMode(missingApi.hls, missingApi.element)).toBe("unavailable");
    expect(missingApi.isTypeSupported).not.toHaveBeenCalled();
  });
});
