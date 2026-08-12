import { useEffect, useState } from "react";
import type { Track } from "../core/types";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { Cover } from "./Cover";
import { HeartIcon, MoreIcon, PlayIcon } from "./icons";

const PROVIDER_LABELS: Record<string, string> = {
  itunes: "iTunes",
  youtube: "YT Music",
  soundcloud: "SoundCloud",
  spotify: "Spotify",
  vk: "VK",
  deezer: "Deezer",
  lastfm: "Last.fm",
  musicbrainz: "MusicBrainz",
  local: "Локально",
};

function formatDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds)) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface TrackRowProps {
  track: Track;
  index?: number;
}

export function TrackRow({ track, index }: TrackRowProps) {
  const { t } = useI18n();
  const snapshot = useApp((s) => s.snapshot);
  const likedIds = useApp((s) => s.likedIds);
  const playlists = useApp((s) => s.playlists);
  const toggleLike = useApp((s) => s.toggleLike);
  const play = useApp((s) => s.play);
  const addToQueue = useApp((s) => s.addToQueue);
  const addToPlaylist = useApp((s) => s.addToPlaylist);
  const downloadTrack = useApp((s) => s.downloadTrack);
  const [menuOpen, setMenuOpen] = useState(false);
  const isCurrent = snapshot.current?.id === track.id;
  const liked = likedIds.includes(track.id);
  const noPlay = track.meta?.noPlay === true;
  const canDownload = !noPlay && Boolean(track.meta?.url ?? track.meta?.audioUrl);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (): void => setMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpen]);

  return (
    <div
      className={`track-row ${isCurrent ? "track-current" : ""} ${noPlay ? "track-noplay" : ""}`}
      title={noPlay ? "Информация (аудио недоступно)" : undefined}
      onDoubleClick={() => {
        if (!noPlay) void play([track], 0);
      }}
    >
      <span className="track-index">
        {isCurrent ? (
          <span className="eq">
            <i />
            <i />
            <i />
          </span>
        ) : (
          index ?? <PlayIcon size={14} />
        )}
      </span>
      {track.coverUrl ? (
        <Cover className="track-cover" src={track.coverUrl} alt="" />
      ) : (
        <div className="track-cover track-cover-placeholder">
          <PlayIcon size={14} />
        </div>
      )}
      <div className="track-main">
        <span className="track-title">
          {track.title}
          <span className={`provider-badge provider-${track.provider}`}>
            {PROVIDER_LABELS[track.provider] ?? track.provider}
          </span>
        </span>
        <span className="track-artist">{track.artist}</span>
      </div>
      {track.album && <span className="track-album">{track.album}</span>}
      <span className="track-duration">{noPlay ? "—" : formatDuration(track.duration)}</span>
      <div className="track-actions">
        <button
          className={`icon-btn more-btn ${menuOpen ? "active" : ""}`}
          title="Действия"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((o) => !o);
          }}
        >
          <MoreIcon size={16} />
        </button>
        {menuOpen && (
          <div className="row-menu" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => {
                addToQueue(track);
                setMenuOpen(false);
              }}
            >
              В очередь
            </button>
            {canDownload && (
              <button
                onClick={() => {
                  void downloadTrack(track);
                  setMenuOpen(false);
                }}
              >
                {t("player").download}
              </button>
            )}
            <div className="row-menu-title">В плейлист</div>
            {playlists.length === 0 && (
              <span className="row-menu-empty">Нет плейлистов</span>
            )}
            {playlists.map((pl) => (
              <button
                key={pl.id}
                onClick={() => {
                  void addToPlaylist(pl.id, track);
                  setMenuOpen(false);
                }}
              >
                {pl.name}
              </button>
            ))}
          </div>
        )}
        <button
          className={`icon-btn ${liked ? "liked" : ""}`}
          title={liked ? "Убрать из понравившегося" : "Понравилось"}
          onClick={() => void toggleLike(track)}
        >
          <HeartIcon size={16} filled={liked} />
        </button>
      </div>
    </div>
  );
}
