import { useApp } from "../app/stores";
import { downloadedFiles, findDownloadedFile } from "../app/offline";
import type { Track } from "../core/types";
import { isLocalMediaUri } from "../core/util/localMedia";
import { useI18n } from "./I18nContext";

export function OfflineCollectionStatus({ tracks }: { tracks: readonly Track[] }) {
  const { locale } = useI18n();
  useApp((s) => s.downloads);
  const recordings = useApp((s) => s.services?.recordings);
  const files = downloadedFiles();
  const available = tracks.filter((track) => isLocalMediaUri(track.uri) ||
    findDownloadedFile(recordings?.resolve(track) ?? track, files)).length;
  if (!tracks.length) return null;
  return <span className="detail-meta" role="status">
    {available}/{tracks.length} {locale === "ru" ? "доступно офлайн" : "available offline"}
  </span>;
}
