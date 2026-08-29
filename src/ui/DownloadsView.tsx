import { useCallback, useEffect, useState } from "react";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { TrashIcon, DownloadIcon, PlayIcon } from "./icons";
import { downloadedFiles, unregisterDownload, downloadedTrackToTrack, type DownloadedFile } from "../app/offline";
import { Cover } from "./Cover";
import { EmptyState } from "./EmptyState";

const STATUS_LABEL: Record<string, "dlQueued" | "dlRunning" | "dlDone" | "dlFailed"> = {
  queued: "dlQueued",
  running: "dlRunning",
  done: "dlDone",
  error: "dlFailed",
};

function DownloadedTrackRow({ file, onRemove }: { file: DownloadedFile; onRemove: () => void }) {
  const { t } = useI18n();
  const play = useApp((s) => s.play);
  const toggleLike = useApp((s) => s.toggleLike);
  const likedIds = useApp((s) => s.likedIds);
  const track = downloadedTrackToTrack(file);
  const isLiked = likedIds.has(track.id);

  return (
    <div className="track-row">
      <button
        className="icon-btn"
        onClick={() => void play([track], 0)}
        title={t("player").play}
      >
        <PlayIcon size={14} />
      </button>
      {track.coverUrl ? (
        <Cover className="track-cover" src={track.coverUrl} alt="" />
      ) : (
        <div className="track-cover track-cover-placeholder">
          <PlayIcon size={14} />
        </div>
      )}
      <div className="track-main">
        <span className="track-title">{track.title}</span>
        <span className="track-artist">{track.artist}</span>
      </div>
      {track.album && <span className="track-album">{track.album}</span>}
      <span className="track-duration">{track.duration ? `${Math.floor(track.duration / 60)}:${String(Math.floor(track.duration % 60)).padStart(2, "0")}` : "—"}</span>
      <DownloadIcon size={12} className="track-downloaded" />
      <div className="track-actions">
        <button
          className={`icon-btn ${isLiked ? "liked" : ""}`}
          title={isLiked ? t("common").unlike : t("common").like}
          onClick={(e) => { e.stopPropagation(); void toggleLike(track); }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill={isLiked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </button>
        <button className="icon-btn danger" onClick={() => onRemove()} title={t("downloads").removeFile}>
          <TrashIcon size={14} />
        </button>
      </div>
    </div>
  );
}

export function DownloadsView() {
  const { t } = useI18n();
  const downloads = useApp((s) => s.downloads);
  const clearDownloads = useApp((s) => s.clearDownloads);
  const retryDownload = useApp((s) => s.retryDownload);
  const [, setTick] = useState(0);

  const finished = downloads.filter((d) => d.status === "done" || d.status === "error").length;

  const [savedFiles, setSavedFiles] = useState<DownloadedFile[]>(() => downloadedFiles());

  const refresh = useCallback(() => { setSavedFiles(downloadedFiles()); setTick((n) => n + 1); }, []);

  useEffect(() => {
    refresh();
  }, [finished, refresh]);

  const handleRemoveFile = (file: string) => {
    unregisterDownload(file);
    refresh();
  };

  return (
    <div className="view downloads-view">
      <div className="view-header">
        <h2>{t("nav").downloads}</h2>
        {finished > 0 && (
          <button className="btn" onClick={clearDownloads}>
            <TrashIcon size={16} /> {t("downloads").clearFinished}
          </button>
        )}
      </div>

      {downloads.length > 0 && (
        <section>
          <h3>{t("player").download}</h3>
          <div className="downloads-list">
            {downloads.map((d) => (
              <div key={d.id} className={`download-item ${d.status}`}>
                <div className="download-info">
                  <span className="download-title">{d.track.title ?? ""}</span>
                  {d.track.artist && <span className="download-artist">{d.track.artist}</span>}
                </div>
                <div className="download-status">
                  {d.status === "running" && d.percent !== undefined
                    ? `${t("downloads").dlRunning} ${Math.round(d.percent)}%`
                    : t("downloads")[STATUS_LABEL[d.status] ?? "dlQueued"]}
                </div>
                {d.status === "running" && (
                  <div className="download-progress">
                    <div
                      className="download-progress-bar"
                      style={{ width: `${Math.round(d.percent ?? 0)}%` }}
                    />
                  </div>
                )}
                {d.status === "error" && (
                  <button className="btn small" onClick={() => retryDownload(d.id)}>
                    {t("downloads").dlRetry}
                  </button>
                )}
                {d.status === "error" && d.error && <div className="download-error">{d.error}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3>
          <DownloadIcon size={16} /> {t("downloads").downloadedTracks}
        </h3>
        {savedFiles.length === 0 ? (
          <EmptyState
            title={t("downloads").noDownloadedTracks}
            message={t("downloads").noDownloadedHint}
            icon={<DownloadIcon size={28} />}
            compact
          />
        ) : (
          <div className="track-list">
            {savedFiles.map((f) => (
              <DownloadedTrackRow
                key={f.file}
                file={f}
                onRemove={() => handleRemoveFile(f.file)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
