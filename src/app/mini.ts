import { listen, emit } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { AppServices } from "./compose";

/**
 * Плавающее mini-player окно (`mini.html`, отдельный webview).
 *
 * - Главное окно транслирует состояние плеера событием `mini-state`;
 * - mini-окно отвечает командой `mini-command` (playpause/next/previous/seek),
 *   а при показе запрашивает свежее состояние командой `getState`.
 */
export interface MiniState {
  title: string;
  artist: string;
  coverUrl: string;
  playing: boolean;
  position: number;
  duration: number;
}

function pushMiniState(services: AppServices): void {
  const snap = services.engine.snapshot;
  const track = snap.current;
  void emit("mini-state", {
    title: track?.title ?? "",
    artist: track?.artist ?? "",
    coverUrl: track?.coverUrl ?? "",
    playing: snap.state === "playing",
    position: Math.floor(snap.position),
    duration: Math.floor(snap.duration),
  } satisfies MiniState).catch(() => {});
}

export function bindMiniBroadcast(services: AppServices): () => void {
  const events = ["state", "track", "time"] as const;
  const unsubs = events.map((ev) => services.engine.on(ev, () => pushMiniState(services)));

  return () => {
    for (const u of unsubs) u();
  };
}

export function bindMiniRemote(services: AppServices): () => void {
  let unlisten: (() => void) | undefined;
  void listen<{ action: string; value?: number }>("mini-command", (event) => {
    const engine = services.engine;
    switch (event.payload.action) {
      case "playpause":
        void engine.togglePlay();
        break;
      case "next":
        void engine.next();
        break;
      case "previous":
        void engine.previous();
        break;
      case "seek":
        if (typeof event.payload.value === "number") engine.seek(event.payload.value);
        break;
      case "getState":
        pushMiniState(services);
        break;
      default:
        break;
    }
  }).then((u) => {
    unlisten = u;
  });

  return () => unlisten?.();
}

/** Открыть mini-player из главного окна (создан скрытым в tauri.conf.json). */
export async function openMiniPlayerWindow(): Promise<void> {
  try {
    const mini = await WebviewWindow.getByLabel("mini-player");
    if (!mini) return;
    await mini.show();
    await mini.setFocus();
  } catch {
    // нет Tauri (web) — вызывающий код сам подберёт fallback
  }
}
