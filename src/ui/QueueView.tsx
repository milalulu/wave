import { useState, useRef, useCallback, useEffect } from "react";
import { useI18n } from "./I18nContext";
import { useApp } from "../app/stores";
import { Cover } from "./Cover";
import { VirtualList } from "./VirtualList";
import { HeartIcon, TrashIcon, RadioIcon, PlaylistIcon, MoreIcon } from "./icons";

const LONG_PRESS_MS = 400;
const DRAG_THRESHOLD_PX = 10;

export function QueueView() {
  const { t } = useI18n();
  const queue = useApp((s) => s.snapshot.queue);
  const queueIndex = useApp((s) => s.snapshot.queueIndex);
  const likedIds = useApp((s) => s.likedIds);
  const toggleLike = useApp((s) => s.toggleLike);
  const clearQueue = useApp((s) => s.clearQueue);
  const moveQueueItem = useApp((s) => s.moveQueueItem);
  const removeFromQueue = useApp((s) => s.removeFromQueue);
  const startRadio = useApp((s) => s.startRadio);
  const playlists = useApp((s) => s.playlists);
  const addToPlaylist = useApp((s) => s.addToPlaylist);
  const [menuIndex, setMenuIndex] = useState<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    if (menuIndex === null) return;
    const close = () => setMenuIndex(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuIndex]);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const dropAbove = useRef(false);
  const touchStartY = useRef(0);
  const touchStartX = useRef(0);
  const touchCurrentIndex = useRef<number | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTouchDragging = useRef(false);

  const handleTouchStart = useCallback((e: React.TouchEvent, index: number) => {
    touchStartY.current = e.touches[0].clientY;
    touchStartX.current = e.touches[0].clientX;
    touchCurrentIndex.current = index;
    isTouchDragging.current = false;
    longPressTimer.current = setTimeout(() => {
      isTouchDragging.current = true;
      setDragIndex(index);
    }, LONG_PRESS_MS);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchCurrentIndex.current === null) return;
    const touch = e.touches[0];
    const dy = Math.abs(touch.clientY - touchStartY.current);
    const dx = Math.abs(touch.clientX - touchStartX.current);

    if (!isTouchDragging.current && (dy > DRAG_THRESHOLD_PX || dx > DRAG_THRESHOLD_PX)) {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      touchCurrentIndex.current = null;
      return;
    }
    if (!isTouchDragging.current) return;

    e.preventDefault();
    const element = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!element) return;
    const trackRow = element.closest(".track-row");
    if (!trackRow) return;
    const targetIndex = Number((trackRow as HTMLElement).dataset.index);
    if (isNaN(targetIndex)) return;

    const rect = trackRow.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const above = touch.clientY < midY;
    dropAbove.current = above;
    setDropTarget(targetIndex);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    if (isTouchDragging.current && touchCurrentIndex.current !== null && dropTarget !== null && touchCurrentIndex.current !== dropTarget) {
      const toIndex = dropAbove.current ? dropTarget : dropTarget + 1;
      const adjustedFrom = touchCurrentIndex.current < toIndex ? touchCurrentIndex.current : touchCurrentIndex.current;
      const adjustedTo = touchCurrentIndex.current < toIndex ? toIndex - 1 : toIndex;
      if (adjustedFrom !== adjustedTo) {
        moveQueueItem(adjustedFrom, adjustedTo);
      }
    }
    setDragIndex(null);
    setDropTarget(null);
    touchCurrentIndex.current = null;
    isTouchDragging.current = false;
  }, [dropTarget, moveQueueItem]);

  const getDropPosition = useCallback((e: React.DragEvent) => {
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    return e.clientY < midY;
  }, []);

  return (
    <div className="view">
      <div className="view-header">
        <h2>{t("queue").title}</h2>
        <button className="btn" onClick={() => { if (queue.length > 0 && !window.confirm(t("queue").clear + "?")) return; clearQueue(); }} disabled={queue.length === 0}>
          {t("queue").clear}
        </button>
      </div>
      {queue.length === 0 ? (
        <p className="muted">{t("queue").empty}</p>
      ) : (
        <div className="track-list">
          <VirtualList
            items={queue}
            rowKey={(track, i) => `${track.id}:${i}`}
            renderRow={(track, i) => {
              const isCurrent = queueIndex >= 0 && i === queueIndex;
              const isDragging = dragIndex === i;
              const isDropTarget = dropTarget === i && dragIndex !== null && dragIndex !== i;
              return (
                <div
                  className={[
                    "track-row",
                    "queue-row",
                    isCurrent ? "track-current" : "",
                    isDragging ? "track-dragging" : "",
                    isDropTarget ? (dropAbove.current ? "track-drop-above" : "track-drop-below") : "",
                  ].filter(Boolean).join(" ")}
                  data-index={i}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", String(i));
                    setDragIndex(i);
                  }}
                  onDragEnd={() => { setDragIndex(null); setDropTarget(null); }}
                  onDragOver={(e) => {
                    if (dragIndex === null || dragIndex === i) { e.preventDefault(); return; }
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    const above = getDropPosition(e);
                    dropAbove.current = above;
                    setDropTarget(i);
                  }}
                  onDragLeave={() => { if (dropTarget === i) setDropTarget(null); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIndex === null || dragIndex === i) return;
                    const above = dropAbove.current;
                    const toIndex = above ? i : i + 1;
                    const adjustedFrom = dragIndex < toIndex ? dragIndex : dragIndex;
                    const adjustedTo = dragIndex < toIndex ? toIndex - 1 : toIndex;
                    if (adjustedFrom !== adjustedTo) {
                      moveQueueItem(adjustedFrom, adjustedTo);
                    }
                    setDragIndex(null);
                    setDropTarget(null);
                  }}
                  onTouchStart={(e) => handleTouchStart(e, i)}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                >
                  <span className="track-index">{isCurrent ? "▶" : i + 1}</span>
                  {track.coverUrl ? (
                    <Cover className="track-cover" src={track.coverUrl} alt="" />
                  ) : (
                    <div className="track-cover track-cover-placeholder" />
                  )}
                  <div className="track-main">
                    <span className="track-title">{track.title}</span>
                    <span className="track-artist">{track.artist}</span>
                  </div>
                  <button
                    className={`icon-btn ${likedIds.has(track.id) ? "liked" : ""}`}
                    onClick={() => void toggleLike(track)}
                  >
                    <HeartIcon size={16} filled={likedIds.has(track.id)} />
                  </button>
                  <div className="queue-menu-wrap">
                    <button
                      className="icon-btn more-btn"
                      onClick={(e) => { e.stopPropagation(); setMenuIndex(menuIndex === i ? null : i); }}
                    >
                      <MoreIcon size={16} />
                    </button>
                    {menuIndex === i && (
                      <div className="queue-menu" onClick={(e) => e.stopPropagation()}>
                        <button className="queue-menu-item" onClick={() => { void startRadio(track); setMenuIndex(null); }}>
                          <RadioIcon size={14} /> {t("home").radio}
                        </button>
                        {playlists.map((pl) => (
                          <button key={pl.id} className="queue-menu-item" onClick={() => { void addToPlaylist(pl.id, track); setMenuIndex(null); }}>
                            <PlaylistIcon size={14} /> {pl.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    className="icon-btn danger"
                    onClick={() => removeFromQueue(i)}
                    title={t("common").delete}
                  >
                    <TrashIcon size={16} />
                  </button>
                </div>
              );
            }}
          />
        </div>
      )}
    </div>
  );
}
