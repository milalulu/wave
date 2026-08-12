import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { TrackRow } from "./TrackRow";
import { Cover } from "./Cover";
import { PlayIcon, BackIcon, ShuffleIcon } from "./icons";
import type { Track } from "../core/types";

export function AlbumDetailView() {
  const { t, tf } = useI18n();
  const { albumDetail, play, clearDetail, setView } = useApp(
    (s) => ({
      albumDetail: s.albumDetail,
      play: s.play,
      clearDetail: s.clearDetail,
      setView: s.setView,
    })
  );

  if (!albumDetail) {
    return <div className="detail-view">{t("common").unknown}</div>;
  }

  const { album, tracks } = albumDetail;

  const handlePlayAll = async () => {
    await play(tracks);
  };

  const handleShufflePlay = async () => {
    const shuffled = [...tracks].sort(() => Math.random() - 0.5);
    await play(shuffled);
  };

  return (
    <div className="detail-view album-detail">
      <header className="detail-header">
        <button className="back-btn" onClick={() => { clearDetail(); setView("search"); }}>
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
        </div>
        <div className="detail-actions">
          <button className="btn btn-primary" onClick={handlePlayAll}>
            <PlayIcon size={18} /> {t("common").play}
          </button>
          <button className="btn" onClick={handleShufflePlay}>
            <ShuffleIcon size={18} /> {t("common").shuffle}
          </button>
        </div>
      </header>

      <section className="detail-tracks">
        <h2>{tf("common").open} ({tracks.length})</h2>
        <div className="track-list">
          {tracks.map((track: Track, i: number) => (
            <TrackRow key={track.id} track={track} index={i + 1} />
          ))}
        </div>
      </section>
    </div>
  );
}