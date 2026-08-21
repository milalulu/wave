import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import type { Track } from "../core/types";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { Cover } from "./Cover";
import { TagEditor } from "./TagEditor";
import { providerLabel } from "./providers";
import { HeartIcon, MoreIcon, PlayIcon, RadioIcon } from "./icons";
import { isTrackBlocked, isArtistBlocked } from "../app/platformSettings";
function formatDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds)) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface TrackRowProps {
  track: Track;
  index?: number;
  playCount?: number;
  
  nowPlaying?: boolean;
  onDragStart?: (e: DragEvent<HTMLDivElement>, track: Track) => void;
  onDrop?: (e: DragEvent<HTMLDivElement>, track: Track) => void;
  onDragOver?: (e: DragEvent<HTMLDivElement>, track: Track) => void;
  onDragEnd?: (e: DragEvent<HTMLDivElement>) => void;
}

export const TrackRow = memo(function TrackRow({ track, index, playCount, nowPlaying, onDragStart, onDrop, onDragOver, onDragEnd }: TrackRowProps) {
  const { t } = useI18n();
  const isCurrentTrack = useApp((s) => nowPlaying !== undefined ? nowPlaying : s.snapshot.current?.id === track.id);
  const likedIds = useApp((s) => s.likedIds);
  const isLiked = likedIds.has(track.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [editingTags, setEditingTags] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isCurrent = isCurrentTrack;
  const noPlay = track.meta?.noPlay === true;
  const canDownload = !noPlay && Boolean(track.meta?.url ?? track.meta?.audioUrl ?? track.uri);
  const isLocal = track.provider === "local";
  const selectedPlaylistId = useApp((s) => s.selectedPlaylistId);
  const inPlaylist = selectedPlaylistId !== null;
  const trackBlocked = useMemo(() => isTrackBlocked(track.id), [track.id]);
  const artistBlocked = useMemo(() => track.artist ? isArtistBlocked(track.artist) : false, [track.artist]);
  const playlists = useApp((s) => s.playlists);
  const toggleLike = useApp((s) => s.toggleLike);
  const play = useApp((s) => s.play);
  const addToQueue = useApp((s) => s.addToQueue);
  const playNext = useApp((s) => s.playNext);
  const addToPlaylist = useApp((s) => s.addToPlaylist);
  const removeFromPlaylist = useApp((s) => s.removeFromPlaylist);
  const downloadTrack = useApp((s) => s.downloadTrack);
  const startRadio = useApp((s) => s.startRadio);
  const toggleBlockTrack = useApp((s) => s.toggleBlockTrack);
  const toggleBlockArtist = useApp((s) => s.toggleBlockArtist);
  const notify = useApp((s) => s.notify);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: Event): void => {
      const target = (e as MouseEvent).target as HTMLElement | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      if (target.closest(".more-btn")) return;
      setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen || !menuPos || !menuRef.current) return;
    const el = menuRef.current;
    const rect = el.getBoundingClientRect();
    let { x, y } = menuPos;
    if (x + rect.width > window.innerWidth - 8) {
      x = Math.max(8, window.innerWidth - rect.width - 8);
    }
    if (y + rect.height > window.innerHeight - 8) {
      y = Math.max(8, window.innerHeight - rect.height - 8);
    }
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }, [menuOpen, menuPos]);

  const openMenu = (x?: number, y?: number): void => {
    setMenuPos(x !== undefined && y !== undefined ? { x, y } : null);
    setMenuOpen(true);
  };

  const openMenuAtButton = (e: React.MouseEvent): void => {
    e.stopPropagation();
    const btn = e.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    openMenu(rect.right + 4, rect.bottom + 4);
  };

  const onPlay = (): void => {
    if (!noPlay) void play([track], 0);
  };

  return (
    <div
      className={`track-row ${isCurrent ? "track-current" : ""} ${noPlay ? "track-noplay" : ""}`}
      title={noPlay ? t("common").noAudio : undefined}
      tabIndex={0}
      role="button"
      aria-label={`${track.title} — ${track.artist ?? ""}`}
      onClick={onPlay}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPlay(); } }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-wave-track", JSON.stringify(track));
        e.dataTransfer.effectAllowed = "copy";
        onDragStart?.(e, track);
      }}
      onDragOver={(e) => {
        if (!onDragOver) return;
        e.preventDefault();
        onDragOver(e, track);
      }}
      onDrop={(e) => {
        if (!onDrop) return;
        e.preventDefault();
        onDrop(e, track);
      }}
      onDragEnd={(e) => {
        onDragEnd?.(e);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu(e.clientX, e.clientY);
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
            {providerLabel(track.provider)}
          </span>
        </span>
        <span className="track-artist">{track.artist}</span>
      </div>
      {track.album && <span className="track-album">{track.album}</span>}
      <span className="track-duration">{noPlay ? "—" : formatDuration(track.duration)}</span>
      {playCount !== undefined && (
        <span className="track-play-count" title={`${playCount}×`}>{playCount}×</span>
      )}
      <div className="track-actions">
        <button
          className={`icon-btn more-btn ${menuOpen ? "active" : ""}`}
          title={t("common").actions}
          onClick={openMenuAtButton}
        >
          <MoreIcon size={16} />
        </button>
        <button
          className={`icon-btn ${isLiked ? "liked" : ""}`}
          title={isLiked ? t("common").unlike : t("common").like}
          onClick={(e) => {
            e.stopPropagation();
            void toggleLike(track);
          }}
        >
          <HeartIcon size={16} filled={isLiked} />
        </button>
      </div>
      {menuOpen && (
        <div
          ref={menuRef}
          className={`row-menu ${menuPos ? "context" : ""}`}
          style={menuPos ? { left: menuPos.x, top: menuPos.y } : undefined}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => { void play([track], 0); setMenuOpen(false); }}>
            <PlayIcon size={14} /> {t("common").play}
          </button>
          <button onClick={() => { addToQueue(track); notify(t("toasts").queueAdded); setMenuOpen(false); }}>
            {t("common").addToQueue}
          </button>
          <button onClick={() => { playNext(track); notify(t("toasts").playNextAdded); setMenuOpen(false); }}>
            {t("common").playNext}
          </button>
          <button onClick={() => { void startRadio(track); notify(t("toasts").radioStarted); setMenuOpen(false); }}>
            <RadioIcon size={14} /> {t("player").radio}
          </button>
          {track.artist && (
            <button onClick={() => { toggleBlockArtist(track.artist ?? ""); notify(artistBlocked ? t("toasts").artistUnblocked : t("toasts").artistBlocked); setMenuOpen(false); }}>
              {artistBlocked ? t("trackMenu").unblockArtist : t("trackMenu").blockArtist}
            </button>
          )}
          <button onClick={() => { toggleBlockTrack(track); notify(trackBlocked ? t("toasts").trackUnblocked : t("toasts").trackBlocked); setMenuOpen(false); }}>
            {trackBlocked ? t("trackMenu").unblockTrack : t("trackMenu").blockTrack}
          </button>
          {canDownload && (
            <button onClick={() => { void downloadTrack(track); setMenuOpen(false); }}>
              {t("player").download}
            </button>
          )}
          {isLocal && (
            <button
              onClick={() => {
                setEditingTags(true);
                setMenuOpen(false);
              }}
            >
              {t("trackMenu").editTags}
            </button>
          )}
          <div className="row-menu-title">{t("common").addToPlaylist}</div>
          {playlists.length === 0 && (
            <span className="row-menu-empty">{t("common").noPlaylists}</span>
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
          {inPlaylist && (
            <button
              className="danger"
              onClick={() => {
                if (selectedPlaylistId) void removeFromPlaylist(selectedPlaylistId, track.id);
                setMenuOpen(false);
              }}
            >
              {t("trackMenu").removeFromPlaylist}
            </button>
          )}
        </div>
      )}
      {editingTags && <TagEditor track={track} onClose={() => setEditingTags(false)} />}
    </div>
  );
});
