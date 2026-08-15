import { useState } from "react";
import { useI18n } from "./I18nContext";
import { useApp } from "../app/stores";
import { Cover } from "./Cover";
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

  return (
    <div className="view">
      <div className="view-header">
        <h2>{t("queue").title}</h2>
        <button className="btn" onClick={clearQueue} disabled={queue.length === 0}>
          {t("queue").clear}
        </button>
      </div>
      {queue.length === 0 ? (
        <p className="muted">{t("queue").empty}</p>
      ) : (
        <div className="track-list">
          {queue.map((track, i) => {
            const isCurrent = queueIndex >= 0 && i === queueIndex;
            const isUpcoming = queueIndex >= 0 && i > queueIndex;
            return (
              <div
                key={`${track.id}:${i}`}
                className={`track-row ${isCurrent ? "track-current" : ""} ${dragIndex === i ? "track-dragging" : ""}`}
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
              >
                <span className="track-index">{isCurrent ? "▶" : isUpcoming ? i + 1 : i + 1}</span>
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
                  className={`icon-btn ${likedIds.includes(track.id) ? "liked" : ""}`}
                  onClick={() => void toggleLike(track)}
                >
                  <HeartIcon size={16} filled={likedIds.includes(track.id)} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
