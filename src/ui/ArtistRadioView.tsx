import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { TrackRow } from "./TrackRow";
import { Cover } from "./Cover";
import {
  BackIcon,
  PlayIcon,
  ShuffleIcon,
  RefreshCwIcon,
  PlaylistIcon,
  RadioIcon,
} from "./icons";
import { tileStyle } from "./tileHue";

export function ArtistRadioView() {
  const { t } = useI18n();
  const goBack = useApp((s) => s.goBack);
  const radio = useApp((s) => s.artistRadioState);
  const { station, error } = radio;
  const loading = radio.status === "loading";
  const refresh = useApp((s) => s.refreshArtistRadio);
  const saveAsPlaylist = useApp((s) => s.saveArtistRadioAsPlaylist);
  const startArtistRadio = useApp((s) => s.startArtistRadio);
  const play = useApp((s) => s.playArtistRadio);
  const notify = useApp((s) => s.notify);
  const report = (error: unknown) => notify(error instanceof Error ? error.message : String(error));
  const currentId = useApp((s) => s.snapshot.current?.id ?? null);

  const artist = radio.artist;
  const tracks = station?.tracks ?? [];
  const similar = station?.similarArtists ?? [];
  const cover = tracks.find((tr) => tr.coverUrl)?.coverUrl;
  const currentIndex = tracks.findIndex((tr) => tr.id === currentId);

  const handlePlay = async () => {
    if (tracks.length > 0) await play().catch(report);
  };

  const handleShuffle = async () => {
    if (tracks.length > 0) await play(0, true).catch(report);
  };

  return (
    <div className="detail-view artist-radio-view">
      <header className="detail-header">
        <button className="back-btn" onClick={goBack} aria-label="Back">
          <BackIcon size={20} />
        </button>
        <div className="detail-cover">
          {cover ? (
            <Cover src={cover} alt="" />
          ) : (
            <div className="cover-empty artist" style={tileStyle(artist)}>
              {(artist || "?").charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        <div className="detail-info">
          <p className="detail-meta">
            <RadioIcon size={13} /> {t("player").radio}
          </p>
          <h1>{artist || t("common").unknown}</h1>
          <p>
            {loading
              ? t("artistRadio").loading
              : tracks.length > 0
                ? t("artistRadio").stationReady(tracks.length)
                : (error ?? t("artistRadio").empty)}
          </p>
          {similar.length > 0 && (
            <div className="chip-row">
              {similar.map((name) => (
                <button
                  key={name}
                  className="chip"
                  onClick={() => void startArtistRadio(name)}
                  title={t("artistRadio").switchStation}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="detail-actions">
          <button className="btn btn-primary" onClick={handlePlay} disabled={tracks.length === 0}>
            <PlayIcon size={18} /> {t("common").play}
          </button>
          <button className="btn" onClick={handleShuffle} disabled={tracks.length === 0}>
            <ShuffleIcon size={18} /> {t("common").shuffle}
          </button>
          <button className="btn" onClick={() => void refresh()} disabled={loading || !artist}>
            <RefreshCwIcon size={16} className={loading ? "spin" : ""} /> {t("artistRadio").refresh}
          </button>
          <button
            className="btn"
            onClick={() => void saveAsPlaylist().catch(report)}
            disabled={tracks.length === 0}
            title={t("artistRadio").saveAsPlaylist}
          >
            <PlaylistIcon size={16} /> {t("artistRadio").save}
          </button>
        </div>
      </header>

      <section className="detail-tracks">
        {loading && tracks.length === 0 && (
          <div className="track-list">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="track-row skeleton" aria-hidden />
            ))}
          </div>
        )}
        {!loading && error && tracks.length === 0 && (
          <div className="empty-state">
            <p>{error}</p>
            <button className="btn" onClick={() => void refresh()}>
              <RefreshCwIcon size={14} /> {t("artistRadio").retry}
            </button>
          </div>
        )}
        {tracks.length > 0 && (
          <>
            <h2>
              {t("artistRadio").tracks} ({tracks.length})
            </h2>
            <div className="track-list">
              {tracks.map((track, i) => (
                <TrackRow
                  key={`${track.id}:${i}`}
                  track={track}
                  index={i + 1}
                  nowPlaying={currentIndex === i}
                  onPlayTrack={() => void play(i).catch(report)}
                />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
