import { invoke } from "@tauri-apps/api/core";
import type { AppServices } from "./compose";

export function bindDiscord(services: AppServices): () => void {
  let lastPush = 0;
  let hasPresence = false;
  const cleanups: Array<() => void> = [];

  const push = (force: boolean): void => {
    const now = Date.now();
    if (!force && now - lastPush < 2000) return;
    lastPush = now;

    const snap = services.engine.snapshot;
    const track = snap.current;

    const clientId = localStorage.getItem("wave-discord-client-id") ?? "";
    if (!clientId || !track || snap.state !== "playing") {
      if (hasPresence) void invoke("clear_discord_presence").catch(() => {});
      hasPresence = false;
      return;
    }

    const details = track.title;
    const state = track.artist ? `by ${track.artist}` : "";
    const largeImage = track.coverUrl || undefined;
    const largeText = track.album || undefined;
    const startTs = snap.duration > 0 ? Math.floor(Date.now() / 1000 - snap.position) : undefined;

    hasPresence = true;
    void invoke("set_discord_presence", {
      clientId,
      details,
      state,
      largeImage,
      largeText,
      smallImage: undefined,
      smallText: "Wave",
      startTs,
      endTs: undefined,
    }).catch(() => {});
  };

  const events = ["state", "track"] as const;
  for (const ev of events) {
    cleanups.push(services.engine.on(ev, () => push(true)));
  }
  cleanups.push(services.engine.on("time", () => push(false)));

  push(true);

  return () => {
    cleanups.forEach((stop) => stop());
    void invoke("clear_discord_presence").catch(() => {});
  };
}
