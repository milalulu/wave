import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import type { Track } from "../core/types";

const KEY = "wave:notifications";

export function notificationsEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setNotificationsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(KEY, enabled ? "on" : "off");
  } catch {
    /* ignore */
  }
}

let granted: boolean | null = null;

/** Отправить системное уведомление «сейчас играет» (не блокирующее). */
export async function sendNowPlayingNotification(track: Track): Promise<void> {
  if (!notificationsEnabled()) return;
  try {
    if (granted === null) {
      granted = await isPermissionGranted();
    }
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    if (!granted) return;
    sendNotification({
      title: track.title,
      body: track.artist ?? "",
    });
  } catch {
    // плагин недоступен (напр. в тестах) — молча пропускаем
  }
}
