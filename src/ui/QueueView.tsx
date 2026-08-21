import { useState, useRef, useCallback } from "react";
import { useI18n } from "./I18nContext";
import { useApp } from "../app/stores";
import { Cover } from "./Cover";
import { VirtualList } from "./VirtualList";
import { HeartIcon } from "./icons";

export function QueueView() {
  const { t } = useI18n();
  const queue = useApp((s) => s.snapshot.queue);
  const queueIndex = useApp((s) => s.snapshot.queueIndex);
  const likedIds = useApp((s) => s.likedIds);
  const toggleLike = useApp((s) => s.toggleLike);
  const clearQueue = useApp((s) => s.clearQueue);
  const moveQueueItem = useApp((s) => s.moveQueueItem);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const touchStartY = useRef(0);
  const touchCurrentIndex = useRef<number | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent, index: number) => {
    touchStartY.current = e.touches[0].clientY;
    touchCurrentIndex.current = index;
    setDragIndex(index);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchCurrentIndex.current === null) return;
    const touch = e.touches[0];
    const element = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!element) return;
    const trackRow = element.closest(".track-row");
    if (!trackRow) return;
    const targetIndex = Number((trackRow as HTMLElement).dataset.index);
    if (isNaN(targetIndex) || targetIndex === touchCurrentIndex.current) return;
    moveQueueItem(touchCurrentIndex.current, targetIndex);
    touchCurrentIndex.current = targetIndex;
  }, [moveQueueItem]);

  const handleTouchEnd = useCallback(() => {
    setDragIndex(null);
    touchCurrentIndex.current = null;
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
              return (
                <div
                  className={`track-row ${isCurrent ? "track-current" : ""} ${dragIndex === i ? "track-dragging" : ""}`}
                  data-index={i}
                  draggable
                  onDragStart={() => setDragIndex(i)}
                  onDragEnd={() => setDragIndex(null)}
                  onDragOver={(e) => {
                    if (dragIndex === null || dragIndex === i) return;
                    e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIndex === null || dragIndex === i) return;
                    moveQueueItem(dragIndex, i);
                    setDragIndex(null);
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
                </div>
              );
            }}
          />
        </div>
      )}
    </div>
  );
}
