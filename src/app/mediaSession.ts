import type { AppServices } from "./compose";

export function bindMediaSession(
  services: AppServices,
  actions: {
    togglePlay: () => void;
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
    }
    ms.playbackState = snap.state === "playing" ? "playing" : "paused";
    try {
      ms.setPositionState({
        duration: snap.duration || 0,
        position: snap.position,
        playbackRate: 1,
      });
    } catch {
      
    }
  };

  const onSeek = (detail: MediaSessionActionDetails): void => {
    if (detail.seekTime !== undefined && Number.isFinite(detail.seekTime)) {
      actions.seek(detail.seekTime);
    } else if (detail.seekOffset !== undefined && Number.isFinite(detail.seekOffset)) {
      const snap = services.engine.snapshot;
      actions.seek(Math.max(0, snap.position + detail.seekOffset));
    }
  };

  ms.setActionHandler("play", actions.togglePlay);
  ms.setActionHandler("pause", actions.togglePlay);
  ms.setActionHandler("previoustrack", actions.previous);
  ms.setActionHandler("nexttrack", actions.next);
  ms.setActionHandler("seekto", onSeek);
  try {
    ms.setActionHandler("seekbackward", (d) => onSeek(d));
    ms.setActionHandler("seekforward", (d) => onSeek(d));
  } catch {
    
  }

  services.engine.on("state", refresh);
  services.engine.on("track", refresh);
  services.engine.on("time", refresh);
}
