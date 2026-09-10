export type ConnectivityStatus = "online" | "offline";

export type StatusProvider = () => boolean;

/**
 * Следит за сетью через online/offline события окна.
 * getOnline инжектится ради тестов (в браузере — navigator.onLine).
 */
export function watchConnectivity(
  onChange: (status: ConnectivityStatus) => void,
  getOnline: StatusProvider = () =>
    typeof navigator !== "undefined" && typeof navigator.onLine === "boolean"
      ? navigator.onLine
      : true,
): () => void {
  const emit = () => onChange(getOnline() ? "online" : "offline");
  if (typeof window !== "undefined") {
    window.addEventListener("online", emit);
    window.addEventListener("offline", emit);
    return () => {
      window.removeEventListener("online", emit);
      window.removeEventListener("offline", emit);
    };
  }
  return () => {};
}

export function currentConnectivity(
  getOnline: StatusProvider = () =>
    typeof navigator !== "undefined" && typeof navigator.onLine === "boolean"
      ? navigator.onLine
      : true,
): ConnectivityStatus {
  return getOnline() ? "online" : "offline";
}
