import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AppServices } from "./compose";

/**
 * Обработчик команд из системного трея (десктоп). События шлёт Rust
 * (`tray-command`), идемпотентен: на мобильных/вебе ничего не делает.
 */
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

  return () => unlisten?.();
}
