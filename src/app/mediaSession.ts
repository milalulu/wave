import type { AppServices } from "./compose";

export function bindMediaSession(
  services: AppServices,
  actions: {
    play: () => void;
    pause: () => void;
    next: () => void;
    previous: () => void;
    seek: (seconds: number) => void;
  },
): void {
  if (!("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;

  const refresh = (): void => {
    const snap = services.engine.snapshot;
    const track = snap.current;
    if (track) {
      try {
        ms.metadata = new MediaMetadata({
          title: track.title,
          artist: track.artist ?? "",
          album: track.album ?? "",
          artwork: track.coverUrl ? [{ src: track.coverUrl, sizes: "256x256" }] : [],
        });
      } catch {
        
      }
    } else ms.metadata = null;
    ms.playbackState = snap.state === "playing" ? "playing" : "paused";
    try {
      ms.setPositionState({
        duration: snap.duration || 0,
        position: snap.position,
        playbackRate: snap.speed,
      });
    } catch {
      
    }
  };

  const onSeek = (detail: MediaSessionActionDetails): void => {
    if (detail.seekTime !== undefined && Number.isFinite(detail.seekTime)) {
      actions.seek(detail.seekTime);
    } else if (detail.action === "seekforward" || detail.action === "seekbackward") {
      const snap = services.engine.snapshot;
      const offset = detail.seekOffset ?? 10;
      if (!Number.isFinite(offset) || offset < 0) return;
      actions.seek(Math.max(0, snap.position + (detail.action === "seekbackward" ? -offset : offset)));
    }
  };

  const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
    play: actions.play, pause: actions.pause, previoustrack: actions.previous,
    nexttrack: actions.next, seekto: onSeek, seekbackward: onSeek, seekforward: onSeek,
  };
  for (const [action, handler] of Object.entries(handlers)) {
    try { ms.setActionHandler(action as MediaSessionAction, handler); }
    catch { /* Some WebViews implement only a subset of media controls. */ }
  }

  services.engine.on("state", refresh);
  services.engine.on("track", refresh);
  services.engine.on("time", refresh);
}
