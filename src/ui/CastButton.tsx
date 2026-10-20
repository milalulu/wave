import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCast, type CastDevice } from "../app/cast";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";

export function CastButton() {
  const { locale } = useI18n();
  const ru = locale === "ru";
  const output = useApp((s) => s.services?.output);
  const { device, busy, error, connect, disconnect } = useCast();
  const [open, setOpen] = useState(false),
    [devices, setDevices] = useState<CastDevice[]>([]),
    [scanning, setScanning] = useState(false);
  const [address, setAddress] = useState(""),
    [scanError, setScanError] = useState("");
  const dialog = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const button = trigger.current;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const controls = dialog.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled)",
      );
      if (!controls?.length) return;
      const first = controls[0],
        last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      button?.focus();
    };
  }, [open]);
  if (!isTauri() || !output) return null;
  const scan = async () => {
    setScanning(true);
    setScanError("");
    try {
      setDevices(await invoke<CastDevice[]>("cast_discover"));
    } catch (e) {
      setScanError(String(e));
    } finally {
      setScanning(false);
    }
  };
  return (
    <>
      <button
        ref={trigger}
        className={`icon-btn mini-btn ${device ? "active" : ""}`}
        title={device ? `Cast: ${device.name}` : "Chromecast"}
        aria-label="Chromecast"
        onClick={() => {
          setOpen(true);
          void scan();
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M3 8V5h18v14h-8M3 12a7 7 0 0 1 7 7M3 16a3 3 0 0 1 3 3" />
          <circle cx="3" cy="20" r="1" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div className="cast-backdrop" onClick={() => setOpen(false)}>
            <section
              ref={dialog}
              className="cast-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="Chromecast"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
              }}
            >
              <div className="cast-heading">
                <h2>Chromecast</h2>
                <button
                  autoFocus
                  className="btn"
                  onClick={() => setOpen(false)}
                >
                  {ru ? "Закрыть" : "Close"}
                </button>
              </div>
              <p>
                {device
                  ? `${ru ? "Подключено" : "Connected"}: ${device.name}`
                  : ru
                    ? "Выберите устройство в той же сети Wi-Fi."
                    : "Choose a device on the same Wi-Fi network."}
              </p>
              <div className="cast-devices">
                {devices.map((d) => (
                  <button
                    className="btn"
                    disabled={busy}
                    key={`${d.address}:${d.port}`}
                    onClick={() => void connect(d, output)}
                  >
                    {d.name} · {d.address}
                  </button>
                ))}
              </div>
              <button
                className="btn"
                disabled={scanning || busy}
                onClick={() => void scan()}
              >
                {scanning
                  ? ru
                    ? "Поиск…"
                    : "Searching…"
                  : ru
                    ? "Найти устройства"
                    : "Find devices"}
              </button>
              {!scanning && !devices.length && (
                <p>
                  {ru
                    ? "Устройства не найдены. Можно указать IP вручную."
                    : "No devices found. You can enter an IP address."}
                </p>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void connect(
                    { name: address, address: address.trim(), port: 8009 },
                    output,
                  );
                }}
              >
                <label htmlFor="cast-ip">
                  {ru ? "IP устройства" : "Device IP"}
                </label>
                <div className="cast-address">
                  <input
                    id="cast-ip"
                    value={address}
                    placeholder="192.168.1.20"
                    onChange={(e) => setAddress(e.target.value)}
                    required
                  />
                  <button className="btn" disabled={busy}>
                    {ru ? "Подключить" : "Connect"}
                  </button>
                </div>
              </form>
              {device && (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => void disconnect(output)}
                >
                  {ru ? "Отключить" : "Disconnect"}
                </button>
              )}
              <p className="muted">
                {ru
                  ? "Очередь, пауза, перемотка и громкость управляются обычными кнопками плеера. Звуковые эффекты и скорость доступны при локальном воспроизведении."
                  : "Use the player controls for the queue, pause, seeking and volume. Audio effects and speed apply to local playback."}
              </p>
              {(error || scanError) && <p role="alert">{error || scanError}</p>}
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
