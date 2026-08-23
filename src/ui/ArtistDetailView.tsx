import { useEffect, useState } from "react";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { TrackRow } from "./TrackRow";
import { AlbumCard } from "./SearchView";
import { Cover } from "./Cover";
import { PlayIcon, BackIcon, ShuffleIcon } from "./icons";
import type { Album, Track } from "../core/types";

export function ArtistDetailView() {
  const { t, tf } = useI18n();
  const artistDetail = useApp((s) => s.artistDetail);
  const play = useApp((s) => s.play);
  const goBack = useApp((s) => s.goBack);
  const services = useApp((s) => s.services);
  const [similar, setSimilar] = useState<Track[]>([]);
  const currentId = useApp((s) => s.snapshot.current?.id ?? null);

  useEffect(() => {
    if (!services || !artistDetail || artistDetail.topTracks.length === 0) return;
    const seed = artistDetail.topTracks[0];
    const results = services.providers
      .filter((p) => typeof p.getSimilarTracks === "function")
      .map((p) => p.getSimilarTracks?.(seed.artist ?? "", seed.title ?? "") ?? []);
    Promise.allSettled(results)
      .then((r) => {
        const out: Track[] = [];
        for (const res of r) {
          if (res.status === "fulfilled") out.push(...res.value);
        }
        setSimilar(out.slice(0, 12));
      })
      .catch(() => setSimilar([]));
  }, [services, artistDetail]);

  if (!artistDetail) {
    return <div className="detail-view">{t("common").unknown}</div>;
  }

  const { artist, topTracks, albums } = artistDetail;
  const firstTopCurrent = topTracks.findIndex((tr) => tr.id === currentId);
  const firstSimilarCurrent = similar.findIndex((tr) => tr.id === currentId);

  const handlePlayAll = async () => {
    await play(topTracks);
  };

  const handleShufflePlay = async () => {
    const shuffled = [...topTracks].sort(() => Math.random() - 0.5);
    await play(shuffled);
  };

  return (
    <div className="detail-view artist-detail">
      <header className="detail-header">
        <button className="back-btn" onClick={goBack}>
          <BackIcon size={20} />
        </button>
        <div className="detail-cover">
          {artist.coverUrl ? (
            <Cover src={artist.coverUrl} alt="" />
          ) : (
            <div className="cover-empty artist">{artist.name.charAt(0)}</div>
          )}
        </div>
        <div className="detail-info">
          <h1>{artist.name}</h1>
          <p>{t("search").artists}</p>
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

      {topTracks.length > 0 && (
        <section className="detail-tracks">
          <h2>{tf("library").topTracks} ({topTracks.length})</h2>
          <div className="track-list">
            {topTracks.map((track: Track, i: number) => (
              <TrackRow key={`${track.id}:${i}`} track={track} index={i + 1} nowPlaying={firstTopCurrent === i} />
            ))}
          </div>
        </section>
      )}

      {albums.length > 0 && (
        <section className="detail-albums">
          <h2>{tf("search").albums} ({albums.length})</h2>
          <div className="card-grid">
            {albums.map((album: Album) => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
        </section>
      )}

      {similar.length > 0 && (
        <section className="detail-tracks">
          <h2>{t("player").similar}</h2>
          <div className="track-list">
            {similar.map((track: Track, i: number) => (
              <TrackRow key={`${track.id}:${i}`} track={track} index={i + 1} nowPlaying={firstSimilarCurrent === i} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}