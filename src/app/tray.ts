import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AppServices } from "./compose";

export function bindTray(services: AppServices): () => void {
  let unlisten: (() => void) | undefined;
  void listen<{ action: string }>("tray-command", (event) => {
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
      case "quit":
        void getCurrentWindow().close();
        break;
      default:
        break;
    }
  }).then((u) => {
    unlisten = u;
  });

  const refresh = (): void => {
    const snap = services.engine.snapshot;
    const track = snap.current;
    void emit("tray-state", {
      playing: snap.state === "playing",
      title: track?.title ?? "",
      artist: track?.artist ?? "",
    });
  };
  services.engine.on("state", refresh);
  services.engine.on("track", refresh);

  return () => unlisten?.();
}
