import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import type { AppServices } from "./compose";

type Action = () => void;

/**
 * Глобальные (системные) хоткеи через tauri-plugin-global-shortcut.
 * Только Ctrl+Alt+комбо: медиа-клавиши уже обрабатываются MPRIS/mediaSession.
 */
export function bindGlobalHotkeys(services: AppServices): () => void {
  const engine = services.engine;
  const vol = (delta: number): void => {
    const v = Math.round(engine.snapshot.volume * 100);
    engine.setVolume(Math.max(0, Math.min(100, v + delta)) / 100);
  };

  const shortcuts: Array<[string, Action]> = [
    ["Ctrl+Alt+Space", () => void engine.togglePlay()],
    ["Ctrl+Alt+ArrowRight", () => void engine.next()],
    ["Ctrl+Alt+ArrowLeft", () => void engine.previous()],
    ["Ctrl+Alt+ArrowUp", () => vol(10)],
    ["Ctrl+Alt+ArrowDown", () => vol(-10)],
    ["Ctrl+Alt+M", () => engine.setVolume(engine.snapshot.volume === 0 ? 1 : 0)],
  ];

  for (const [shortcut, action] of shortcuts) {
    register(shortcut, () => action()).catch(() => {
      /* shortcut занят или недоступен — пропускаем */
    });
  }

  return () => void unregisterAll().catch(() => {});
}
