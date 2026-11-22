import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { TrackRow } from "./TrackRow";
import { Cover } from "./Cover";
import { PlayIcon, BackIcon, ShuffleIcon, DownloadIcon } from "./icons";
import type { Track } from "../core/types";
import { shuffleArray } from "../core/util/shuffle";
import { OfflineCollectionStatus } from "./OfflineCollectionStatus";

export function AlbumDetailView() {
  const { t, tf, locale } = useI18n();
  const albumDetail = useApp((s) => s.albumDetail);
  const play = useApp((s) => s.play);
  const downloadTracks = useApp((s) => s.downloadTracks);
  const notify = useApp((s) => s.notify);
  const goBack = useApp((s) => s.goBack);
  const currentId = useApp((s) => s.snapshot.current?.id ?? null);

  if (!albumDetail) {
    return <div className="detail-view">{t("common").unknown}</div>;
  }

  const { album, tracks } = albumDetail;
  const firstCurrent = tracks.findIndex((tr) => tr.id === currentId);

  const handlePlayAll = async () => {
    await play(tracks, 0, "album");
  };

  const handleShufflePlay = async () => {
    const shuffled = shuffleArray(tracks);
    await play(shuffled);
  };

  return (
    <div className="detail-view album-detail">
      <header className="detail-header">
        <button className="back-btn" onClick={goBack}>
          <BackIcon size={20} />
        </button>
        <div className="detail-cover">
          {album.coverUrl ? (
            <Cover src={album.coverUrl} alt="" />
          ) : (
            <div className="cover-empty">A</div>
          )}
        </div>
        <div className="detail-info">
          <h1>{album.title}</h1>
          <p>{album.artist}</p>
          {album.year && <span className="detail-meta">{album.year}</span>}
          <OfflineCollectionStatus tracks={tracks} />
        </div>
        <div className="detail-actions">
          <button className="btn btn-primary" onClick={handlePlayAll}>
            <PlayIcon size={18} /> {locale === "ru" ? "Слушать альбом" : "Play album"}
          </button>
          <button className="btn" onClick={handleShufflePlay}>
            <ShuffleIcon size={18} /> {t("common").shuffle}
          </button>
          <button className="btn" disabled={!tracks.length} onClick={async () => {
            const count = await downloadTracks(tracks);
            if (count) notify(locale === "ru" ? `В очередь загрузок: ${count}` : `Queued downloads: ${count}`);
          }}><DownloadIcon size={18} /> {locale === "ru" ? "Скачать альбом" : "Download album"}</button>
        </div>
      </header>

      <section className="detail-tracks">
        <h2>{tf("search").tracks} ({tracks.length})</h2>
        <div className="track-list">
          {tracks.map((track: Track, i: number) => (
            <TrackRow key={`${track.id}:${i}`} track={track} index={i + 1} nowPlaying={firstCurrent === i} />
          ))}
        </div>
      </section>
    </div>
  );
}
