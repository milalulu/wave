import { useEffect, useMemo, useRef } from "react";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { Cover } from "./Cover";
import { HeartIcon, LyricsIcon, NextIcon, PauseIcon, PlayIcon, PreviousIcon } from "./icons";

export function HomeView() {
  const { t, tf } = useI18n();
  const snapshot = useApp((s) => s.snapshot);
  const likedIds = useApp((s) => s.likedIds);
  const lyrics = useApp((s) => s.lyrics);
  const lyricsLoading = useApp((s) => s.lyricsLoading);
  const lyricsOpen = useApp((s) => s.lyricsOpen);
  const togglePlay = useApp((s) => s.togglePlay);
  const next = useApp((s) => s.next);
  const previous = useApp((s) => s.previous);
  const toggleLike = useApp((s) => s.toggleLike);
  const toggleLyrics = useApp((s) => s.toggleLyrics);
  const openLocalDirectory = useApp((s) => s.openLocalDirectory);
  const startWave = useApp((s) => s.startWave);

  const track = snapshot.current;
  const liked = track ? likedIds.includes(track.id) : false;

  const activeIndex = useMemo(() => {
    if (!lyrics?.synced) return -1;
    let idx = -1;
    for (let i = 0; i < lyrics.lines.length; i++) {
      const t2 = lyrics.lines[i].time;
      if (t2 !== undefined && t2 <= snapshot.position) idx = i;
    }
    return idx;
  }, [lyrics, snapshot.position]);

  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container || activeIndex < 0) return;
    const el = container.querySelector(`[data-line="${activeIndex}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIndex, lyricsOpen]);

  return (
    <div className="home">
      <div className="hero">
        <div className="hero-cover">
          {track?.coverUrl ? (
            <Cover src={track.coverUrl} alt="" />
          ) : (
            <div className="hero-cover-empty">W</div>
          )}
        </div>
        <div className="hero-info">
          <span className="hero-label">{t("app").nowPlaying}</span>
          <h1>{track?.title ?? t("home").welcomeTitle}</h1>
          <p className="hero-artist">{track?.artist ?? t("home").welcomeSubtitle}</p>
          {track && (
            <div className="hero-actions">
              <button className="btn btn-primary" onClick={() => void togglePlay()}>
                {snapshot.state === "playing" ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
                {snapshot.state === "playing" ? t("player").pause : t("player").play}
              </button>
              <button className="btn" onClick={() => void previous()}>
                <PreviousIcon size={18} />
              </button>
              <button className="btn" onClick={() => void next()}>
                <NextIcon size={18} />
              </button>
              <button
                className={`btn ${liked ? "liked" : ""}`}
                onClick={() => void toggleLike()}
                title={t("common").like}
              >
                <HeartIcon size={18} filled={liked} />
              </button>
              <button
                className={`btn ${lyricsOpen ? "active" : ""}`}
                onClick={toggleLyrics}
                title={t("player").lyrics}
              >
                <LyricsIcon size={18} />
                {t("player").lyrics}
              </button>
            </div>
          )}
        </div>
      </div>

      {lyricsOpen && track && (
        <div className="lyrics">
          <div className="lyrics-header">
            <span>{t("player").lyrics}</span>
            {lyrics?.source && <span className="lyrics-source">{tf("home").lyricsSource(lyrics.source)}</span>}
          </div>
          <div className="lyrics-body" ref={containerRef}>
            {lyricsLoading ? (
              <p className="lyrics-hint">{t("home").lyricsLoading}</p>
            ) : lyrics?.instrumental ? (
              <p className="lyrics-hint">{t("home").lyricsInstrumental}</p>
            ) : lyrics && lyrics.lines.length > 0 ? (
              lyrics.lines.map((line, i) => (
                <p
                  key={i}
                  data-line={i}
                  className={`lyrics-line ${i === activeIndex ? "active" : ""}`}
                >
                  {line.text || "\u00A0"}
                </p>
              ))
            ) : (
              <p className="lyrics-hint">{t("home").lyricsNotFound}</p>
            )}
          </div>
        </div>
      )}

      <div className="quick-actions">
        <button className="card-action" onClick={() => void openLocalDirectory()}>
          <span>{t("home").localFiles}</span>
          <small>{t("home").localFilesDesc}</small>
        </button>
        <button className="card-action" onClick={() => void startWave()}>
          <span>{t("home").wave}</span>
          <small>{t("home").waveDesc}</small>
        </button>
      </div>
    </div>
  );
}
