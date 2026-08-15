import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles.css";
import type { MiniState } from "./app/mini";
import { Cover } from "./ui/Cover";
import {
  ChevronDownIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PreviousIcon,
} from "./ui/icons";

const empty: MiniState = {
  title: "",
  artist: "",
  coverUrl: "",
  playing: false,
  position: 0,
  duration: 0,
};

function applyTheme(): void {
  let theme: string | null = null;
  try {
    theme = localStorage.getItem("wave:theme");
  } catch {
    // localStorage недоступен — остаёмся на тёмной теме
  }
  let dark = theme !== "light";
  if (theme === "system") {
    dark =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  if (dark) {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", "light");
  }
}

function MiniPlayer() {
  const [state, setState] = useState<MiniState>(empty);

  useEffect(() => {
    applyTheme();
    let unlisten: (() => void) | undefined;
    void listen<MiniState>("mini-state", (event) => setState(event.payload)).then((u) => {
      unlisten = u;
    });
    const request = (): void => void emit("mini-command", { action: "getState" });
    request();
    document.addEventListener("visibilitychange", request);
    let unsubMq: (() => void) | undefined;
    if (typeof window.matchMedia === "function") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = (): void => {
        try {
          if (localStorage.getItem("wave:theme") === "system") applyTheme();
        } catch {
          applyTheme();
        }
      };
      mq.addEventListener?.("change", onChange);
      unsubMq = () => mq.removeEventListener?.("change", onChange);
    }
    return () => {
      unlisten?.();
      unsubMq?.();
      document.removeEventListener("visibilitychange", request);
    };
  }, []);

  const cmd = (action: string, value?: number): void => {
    void emit("mini-command", { action, value });
  };

  const ratio = state.duration > 0 ? Math.min(1, state.position / state.duration) : 0;

  const onSeek = (e: React.PointerEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const r = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    cmd("seek", Math.floor(r * state.duration));
  };

  return (
    <div className="mini-window">
      <div className="mini-drag" data-tauri-drag-region>
        {state.coverUrl ? (
          <Cover className="mini-cover" src={state.coverUrl} alt="" />
        ) : (
          <div className="mini-cover mini-cover-empty" />
        )}
        <div className="mini-lines">
          <span className="mini-title" title={state.title}>
            {state.title || "—"}
          </span>
          <span className="mini-artist" title={state.artist}>
            {state.artist}
          </span>
        </div>
        <div className="mini-progress" onPointerDown={onSeek}>
          <div className="mini-progress-fill" style={{ width: `${ratio * 100}%` }} />
        </div>
      </div>
      <div className="mini-controls">
        <button className="icon-btn" onClick={() => cmd("previous")} title="Previous">
          <PreviousIcon size={18} />
        </button>
        <button
          className="icon-btn mini-play"
          onClick={() => cmd("playpause")}
          title={state.playing ? "Pause" : "Play"}
        >
          {state.playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
        </button>
        <button className="icon-btn" onClick={() => cmd("next")} title="Next">
          <NextIcon size={18} />
        </button>
        <button className="icon-btn" onClick={() => void getCurrentWindow().hide()} title="Hide">
          <ChevronDownIcon size={18} />
        </button>
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <MiniPlayer />
    </StrictMode>,
  );
}
