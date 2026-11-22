import { expect, it } from "vitest";
import { trackCover } from "./trackCover";
const track = { id: "youtube:track:abcdefghijk", provider: "youtube", title: "Track", uri: "" };
it("prefers original artwork and then the actual playback source", () => {
 expect(trackCover({...track, coverUrl:"album.jpg", playbackSource:{...track, coverUrl:"source.jpg"}})).toBe("album.jpg");
 expect(trackCover({...track, playbackSource:{...track, coverUrl:"source.jpg"}})).toBe("source.jpg");
});
it("recovers a legacy YouTube thumbnail using its exact video ID", () => {
 expect(trackCover(track)).toBe("https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg");
 expect(trackCover({...track, id:"youtube:track:invalid"})).toBeUndefined();
 expect(trackCover({...track, provider:"soundcloud"})).toBeUndefined();
});
