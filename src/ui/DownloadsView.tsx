import { useEffect, useMemo, useState } from "react";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { TrashIcon, DownloadIcon, PlayIcon } from "./icons";
import { downloadedFiles, unregisterDownload, downloadedTrackToTrack, findMissingDownloads, type DownloadedFile } from "../app/offline";
import { isStreamingProvider } from "../app/platformSettings";
import { Cover } from "./Cover";
import { tileStyle } from "./tileHue";
import { EmptyState } from "./EmptyState";
import type { Track } from "../core/types";

const STATUS_LABEL: Record<string, "dlQueued" | "dlRunning" | "dlDone" | "dlFailed"> = {
  queued: "dlQueued",
  running: "dlRunning",
  done: "dlDone",
  error: "dlFailed",
};

function DownloadedTrackRow({ track, missing, onRetry, onPlay, onRemove }: { track: Track; missing: boolean; onRetry?: () => void; onPlay: () => void; onRemove: () => void }) {
  const { t, locale } = useI18n();
  const toggleLike = useApp((s) => s.toggleLike);
  const likedIds = useApp((s) => s.likedIds);
  const isLiked = likedIds.has(track.id);

  return (
    <div className="track-row">
      <button
        className="icon-btn"
        onClick={onPlay}
        disabled={missing}
        title={t("player").play}
      >
        <PlayIcon size={14} />
      </button>
      {track.coverUrl ? (
        <Cover className="track-cover" src={track.coverUrl} alt="" />
      ) : (
        <div className="track-cover track-cover-placeholder" style={tileStyle(track.title)}>
          <PlayIcon size={14} />
        </div>
      )}
      <div className="track-main">
        <span className="track-title">{track.title}</span>
        <span className="track-artist">{track.artist}</span>
        {missing && <span className="muted">{locale === "ru" ? "Файл отсутствует" : "File missing"}</span>}
      </div>
      {track.album && <span className="track-album">{track.album}</span>}
      <span className="track-duration">{track.duration ? `${Math.floor(track.duration / 60)}:${String(Math.floor(track.duration % 60)).padStart(2, "0")}` : "—"}</span>
      <DownloadIcon size={12} className="track-downloaded" />
      <div className="track-actions">
        {onRetry && <button type="button" className="icon-btn" onClick={onRetry}
          title={locale === "ru" ? "Скачать заново" : "Download again"} aria-label={locale === "ru" ? "Скачать заново" : "Download again"}>
          <DownloadIcon size={16} />
        </button>}
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
  const { t, locale } = useI18n();
  const downloads = useApp((s) => s.downloads);
  const clearDownloads = useApp((s) => s.clearDownloads);
  const retryDownload = useApp((s) => s.retryDownload);
  const downloadTracks = useApp((s) => s.downloadTracks);
  const play = useApp((s) => s.play);

  const finished = downloads.filter((d) => d.status === "done" || d.status === "error").length;

  const [savedFiles, setSavedFiles] = useState<DownloadedFile[]>(() => downloadedFiles());
  const [missing, setMissing] = useState(new Set<string>());
  const tracks = useMemo(() => savedFiles.map(downloadedTrackToTrack), [savedFiles]);
  const available = tracks.filter((_, index) => !missing.has(savedFiles[index].file));
  const knownBytes = savedFiles.reduce((total, file) => total + (missing.has(file.file) ? 0 : file.bytes ?? 0), 0);

  useEffect(() => {
    setSavedFiles(downloadedFiles());
  }, [finished]);

  useEffect(() => {
    let active = true;
    const refresh = () => void findMissingDownloads(savedFiles.map((file) => file.file)).then((paths) => {
      if (active) setMissing(paths);
    });
    refresh();
    window.addEventListener("focus", refresh);
    return () => { active = false; window.removeEventListener("focus", refresh); };
  }, [savedFiles]);

  const handleRemoveFile = (file: string) => {
    unregisterDownload(file);
    setSavedFiles(downloadedFiles());
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
        <div className="downloads-collection-header">
          <h3><DownloadIcon size={16} /> {t("downloads").downloadedTracks}</h3>
          {knownBytes > 0 && <span className="muted">{savedFiles.some((file) => !file.bytes) ? "≥ " : ""}
            {new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(knownBytes / 1048576)} {locale === "ru" ? "МиБ" : "MiB"}
          </span>}
          {available.length > 0 && <button type="button" className="btn" onClick={() => void play(available, 0)}>
            <PlayIcon size={16} /> {locale === "ru" ? "Играть все" : "Play all"}
          </button>}
        </div>
        {savedFiles.length === 0 ? (
          <EmptyState
            title={t("downloads").noDownloadedTracks}
            message={t("downloads").noDownloadedHint}
            icon={<DownloadIcon size={28} />}
            compact
          />
        ) : (
          <div className="track-list">
            {savedFiles.map((f, index) => (
              <DownloadedTrackRow
                key={f.file}
                track={tracks[index]}
                missing={missing.has(f.file)}
                onRetry={missing.has(f.file) && f.trackId && f.provider && isStreamingProvider(f.provider) ? () => {
                  const track = tracks[index];
                  const sourceId = f.trackId!;
                  const uri = f.provider === "youtube" ? `https://www.youtube.com/watch?v=${sourceId.split(":").pop()}` : sourceId;
                  void downloadTracks([{ ...track, id: sourceId, uri, meta: undefined }], f.file);
                } : undefined}
                onPlay={() => void play(available, available.indexOf(tracks[index]))}
                onRemove={() => handleRemoveFile(f.file)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
