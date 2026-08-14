import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppServices } from "./compose";
import type { RepeatMode } from "../core/types";

function toLoopStatus(repeat: RepeatMode): string {
  if (repeat === "one") return "Track";
  if (repeat === "all") return "Playlist";
  return "None";
}

/**
 * Интеграция с MPRIS (Linux): публикует состояние плеера через
 * команду `mpris_update` и обрабатывает команды из DE (play/pause/next…),
 * приходящие через событие `mpris-command`.
 */
export function bindMpris(services: AppServices): () => void {
  const push = (): void => {
    const snap = services.engine.snapshot;
    const track = snap.current;
    void invoke("mpris_update", {
      playing: snap.state === "playing",
      title: track?.title ?? "",
      artist: track?.artist ?? "",
      album: track?.album ?? "",
      artUrl: track?.coverUrl ?? "",
      duration: Math.floor(snap.duration),
      position: Math.floor(snap.position),
      volume: snap.volume,
      shuffle: snap.shuffle,
      loopStatus: toLoopStatus(snap.repeat),
      canNext: true,
      canPrev: true,
    }).catch(() => {});
  };

  const events = ["state", "track", "time", "volume", "shuffle", "repeat"] as const;
  for (const ev of events) services.engine.on(ev, push);

  let unlisten: (() => void) | undefined;
  void listen<{ action: string; value?: unknown }>("mpris-command", (event) => {
    const { action, value } = event.payload;
    const engine = services.engine;
    switch (action) {
      case "play":
      case "pause":
      case "togglePlay":
        void engine.togglePlay();
        break;
      case "next":
        void engine.next();
        break;
      case "previous":
        void engine.previous();
        break;
      case "seek":
        if (typeof value === "number") engine.seek(value);
        break;
      case "volume":
        if (typeof value === "number") engine.setVolume(Math.max(0, Math.min(1, value / 100)));
        break;
      case "shuffle":
        engine.setShuffle(value === true || value === "true");
        break;
      case "loop":
      case "loopStatus": {
        let mode: RepeatMode = "off";
        if (value === "Track" || value === "Playlist") mode = value === "Track" ? "one" : "all";
        engine.setRepeat(mode);
        break;
      }
      default:
        break;
    }
  }).then((u) => {
    unlisten = u;
  });

  return () => unlisten?.();
}
