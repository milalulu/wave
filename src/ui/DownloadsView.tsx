import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { TrashIcon } from "./icons";

const STATUS_LABEL: Record<string, "dlQueued" | "dlRunning" | "dlDone" | "dlFailed"> = {
  queued: "dlQueued",
  running: "dlRunning",
  done: "dlDone",
  error: "dlFailed",
};

export function DownloadsView() {
  const { t } = useI18n();
  const downloads = useApp((s) => s.downloads);
  const clearDownloads = useApp((s) => s.clearDownloads);
  const retryDownload = useApp((s) => s.retryDownload);

  const finished = downloads.filter((d) => d.status === "done" || d.status === "error").length;

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

      {downloads.length === 0 ? (
        <p className="muted">{t("downloads").empty}</p>
      ) : (
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
      )}
    </div>
  );
}
