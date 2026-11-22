import { trackCover } from "../core/cover/trackCover";
import { useState, useRef, useCallback, useEffect } from "react";
import { useI18n } from "./I18nContext";
import { useApp } from "../app/stores";
import { setRecommendationFeedback } from "../app/recommendationFeedback";
import { useShallow } from "zustand/react/shallow";
import type { Track } from "../core/types";
import { Cover } from "./Cover";
import { VirtualList } from "./VirtualList";
import { EmptyState } from "./EmptyState";
import { ConfirmDialog } from "./ConfirmDialog";
import { formatTime } from "../core/util/format";
import { MiniSpectrum } from "./MiniSpectrum";
import { HeartIcon, TrashIcon, RadioIcon, PlaylistIcon, MoreIcon, PlayIcon } from "./icons";

const LONG_PRESS_MS = 400;
const DRAG_THRESHOLD_PX = 10;

function recommendationReason(reason: unknown, ru: boolean) {
  switch (reason) {
    case "artist": return ru ? "Знакомый исполнитель" : "An artist you know";
    case "related": return ru ? "Связано с треком в очереди" : "Related to a track in your queue";
    case "style": return ru ? "Похожий жанр или настроение" : "Similar genre or mood";
    case "taste": return ru ? "Похоже на то, что ты слушаешь" : "Similar to your listening habits";
    case "library": return ru ? "Подборка Wave по твоей библиотеке" : "A Wave pick based on your library";
    default: return undefined;
  }
}

export function QueueView({ compact = false }: { compact?: boolean }) {
  const { t, locale } = useI18n();
  const ru = locale === "ru";
  const notify = useApp((s) => s.notify);
  const queue = useApp(useShallow((s) => s.snapshot.queue));
  const queueIndex = useApp((s) => s.snapshot.queueIndex);
  const albumMode = useApp((s) => s.snapshot.mode === "album");
  const engine = useApp((s) => s.services?.engine);
  const playing = useApp((s) => s.snapshot.state === "playing");
  const likedIds = useApp(useShallow((s) => s.likedIds));
  const toggleLike = useApp((s) => s.toggleLike);
  const clearQueue = useApp((s) => s.clearQueue);
  const dedupeQueue = useApp((s) => s.dedupeQueue);
  const moveQueueItem = useApp((s) => s.moveQueueItem);
  const addToQueueAtIndex = useApp((s) => s.addToQueueAtIndex);
  const removeFromQueue = useApp((s) => s.removeFromQueue);
  const startRadio = useApp((s) => s.startRadio);
  const playlists = useApp(useShallow((s) => s.playlists));
  const addToPlaylist = useApp((s) => s.addToPlaylist);
  const [menuIndex, setMenuIndex] = useState<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const pointerDrag = useRef<{ from: number; y: number; active: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const queueRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) return;
      if (focusedIndex === null) return;
      if (!(e.target instanceof Element) || e.target.closest(".queue-row")?.getAttribute("data-index") !== String(focusedIndex)) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        const idx = focusedIndex;
        setFocusedIndex(null);
        removeFromQueue(idx);
      }
    };
    const queueView = queueRef.current;
    queueView?.addEventListener("keydown", onKey);
    return () => queueView?.removeEventListener("keydown", onKey);
  }, [focusedIndex, removeFromQueue]);

  useEffect(() => {
    if (menuIndex === null) return;
    const close = () => setMenuIndex(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuIndex]);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const [externalDrag, setExternalDrag] = useState(false);
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
    <div ref={queueRef} className={`view ${compact ? "queue-compact" : ""}`}>
      <div className="view-header">
        <h2>{t("queue").title}</h2>
        {albumMode && <span className="muted">{ru ? "Альбом по порядку" : "Album order"}</span>}
        <button className="btn" onClick={() => dedupeQueue()} disabled={queue.length === 0}>
          {t("queue").dedupe}
        </button>
        <button className="btn" onClick={() => { if (queue.length > 0) setConfirmClear(true); }} disabled={queue.length === 0}>
          {t("queue").clear}
        </button>
      </div>
      <div
        className="track-list"
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (Array.from(e.dataTransfer.types).includes("application/x-wave-track")) setExternalDrag(true);
        }}
        onDrop={(e) => {
          const raw = e.dataTransfer.getData("application/x-wave-track");
          if (raw) {
            e.preventDefault();
            try {
              addToQueueAtIndex(queue.length, JSON.parse(raw) as Track);
            } catch {
              // ignore malformed payload
            }
          }
          setDragIndex(null);
          setDropTarget(null);
          setExternalDrag(false);
        }}
      >
      {queue.length === 0 ? (
        <EmptyState
          title={t("queue").empty}
          message={t("queue").emptyHint}
          icon={<PlaylistIcon size={28} />}
        />
      ) : (
          <VirtualList
            estimateSize={compact ? 80 : 52}
            items={queue}
            rowKey={(track, i) => `${track.id}:${i}`}
            renderRow={(track, i) => {
              const reason = recommendationReason(track.meta?.recommendationReason, ru);
              const isCurrent = queueIndex >= 0 && i === queueIndex;
              const isDragging = dragIndex === i;
              const isDropTarget = dropTarget === i && dragIndex !== i && (dragIndex !== null || externalDrag);
              return (
                <div
                  className={[
                    "track-row",
                    "queue-row",
                    isCurrent ? "track-current" : "",
                    focusedIndex === i ? "track-focused" : "",
                    isDragging ? "track-dragging" : "",
                    isDropTarget ? (dropAbove.current ? "track-drop-above" : "track-drop-below") : "",
                  ].filter(Boolean).join(" ")}
                  data-index={i}
                  tabIndex={0}
                  onFocus={() => setFocusedIndex(i)}
                  data-reorderable="true"
                  onClick={(e) => {
                    if (suppressClick.current) { suppressClick.current = false; return; }
                    if ((e.target as Element).closest(".queue-row button")) return;
                    void engine?.playQueueIndex(i);
                  }}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
                    e.preventDefault();
                    void engine?.playQueueIndex(i);
                  }}
                  onPointerDown={(e) => {
                    if (e.pointerType !== "mouse" || e.button !== 0 || (e.target as Element).closest("button")) return;
                    suppressClick.current = false;
                    pointerDrag.current = { from: i, y: e.clientY, active: false };
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    const drag = pointerDrag.current;
                    if (!drag || drag.from !== i || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
                    if (!drag.active && Math.abs(e.clientY - drag.y) < DRAG_THRESHOLD_PX) return;
                    drag.active = true;
                    setDragIndex(i);
                    const row = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>(".queue-row");
                    if (!row || !queueRef.current?.contains(row)) { setDropTarget(null); return; }
                    const rect = row.getBoundingClientRect();
                    dropAbove.current = e.clientY < rect.top + rect.height / 2;
                    setDropTarget(Number(row.dataset.index));
                  }}
                  onPointerUp={(e) => {
                    const drag = pointerDrag.current;
                    pointerDrag.current = null;
                    if (!drag?.active) return;
                    suppressClick.current = true;
                    setDragIndex(null);
                    setDropTarget(null);
                    const row = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>(".queue-row");
                    if (!row || !queueRef.current?.contains(row)) return;
                    const target = Number(row.dataset.index);
                    if (target === drag.from) return;
                    const rect = row.getBoundingClientRect();
                    const boundary = target + (e.clientY >= rect.top + rect.height / 2 ? 1 : 0);
                    const to = boundary > drag.from ? boundary - 1 : boundary;
                    if (to !== drag.from) moveQueueItem(drag.from, to);
                  }}
                  onLostPointerCapture={() => {
                    pointerDrag.current = null;
                    setDragIndex(null);
                    setDropTarget(null);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    const types = e.dataTransfer.types;
                    const isExternal = types.includes("application/x-wave-track");
                    if (isExternal !== externalDrag) setExternalDrag(isExternal);
                    if (dragIndex === i) { setDropTarget(null); return; }
                    const above = getDropPosition(e);
                    dropAbove.current = above;
                    setDropTarget(i);
                  }}
                  onDragLeave={() => { if (dropTarget === i) setDropTarget(null); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    {
                      const raw = e.dataTransfer.getData("application/x-wave-track");
                      if (raw) {
                        try {
                          const track = JSON.parse(raw) as Track;
                          const above = getDropPosition(e);
                          const toIndex = above ? i : i + 1;
                          addToQueueAtIndex(toIndex, track);
                        } catch {
                          setDropTarget(null);
                        }
                      }
                      setDropTarget(null);
                      setDragIndex(null);
                      setExternalDrag(false);
                    }
                  }}
                  onTouchStart={(e) => handleTouchStart(e, i)}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                >
                  <span className="track-index">{isCurrent ? "▶" : i + 1}</span>
                  <Cover className="track-cover" src={trackCover(track)} alt="" />
                  <div className="track-main queue-play-track">
                    <span className="track-title" title={track.title}>{track.title}</span>
                    <span className="track-artist" title={[track.artist, reason].filter(Boolean).join(" · ")}>{track.artist}</span>
                    <PlayIcon size={14} />
                  </div>
                  {compact && <span className="echoes-queue-duration">{isCurrent && playing ? <MiniSpectrum playing /> : track.duration ? formatTime(track.duration) : ""}</span>}
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
                        {reason && <p className="queue-recommendation-reason">{reason}</p>}
                        {(["more", "less"] as const).map((direction) => (
                          <button key={direction} type="button" className="queue-menu-item" onClick={() => {
                            setRecommendationFeedback(track, direction);
                            notify(ru ? "Учту в следующих рекомендациях" : "Saved for future recommendations");
                            setMenuIndex(null);
                          }}>
                            {direction === "more" ? (ru ? "Больше такого" : "More like this") : (ru ? "Меньше такого" : "Less like this")}
                          </button>
                        ))}
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
      )}
      </div>
      {confirmClear && (
        <ConfirmDialog
          message={t("queue").clear + "?"}
          onConfirm={() => { clearQueue(); setConfirmClear(false); }}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </div>
  );
}
