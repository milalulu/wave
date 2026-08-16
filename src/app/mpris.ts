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
  // Событие time тикает несколько раз в секунду — не спамим DBus,
  // пушим состояние позиции не чаще раза в секунду.
  let lastPush = 0;
  const push = (force: boolean): void => {
    const now = Date.now();
    if (!force && now - lastPush < 1000) return;
    lastPush = now;
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
  for (const ev of events) services.engine.on(ev, () => push(ev !== "time"));
  push(true);

  let unlisten: (() => void) | undefined;
  void listen<{ action: string; value?: unknown }>("mpris-command", (event) => {
    const { action, value } = event.payload;
    const engine = services.engine;
    switch (action) {
      case "play":
      case "pause":
      case "togglePlay":
      case "playpause":
        void engine.togglePlay();
        break;
      case "next":
        void engine.next();
        break;
      case "previous":
        void engine.previous();
        break;
      // MPRIS Seek(offset) — относительный сдвиг в микросекундах (спецификация),
      // а SetPosition — абсолютная позиция в микросекундах.
      case "seek":
        if (typeof value === "number") {
          engine.seek(Math.max(0, engine.snapshot.position + value / 1_000_000));
        }
        break;
      case "setPosition":
        if (typeof value === "number") engine.seek(value / 1_000_000);
        break;
      // MPRIS Volume приходит в диапазоне 0.0–1.0 (f64).
      case "setVolume":
        if (typeof value === "number") engine.setVolume(Math.max(0, Math.min(1, value)));
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
