import { useState } from "react";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { EQ_PRESETS, EQ_FREQUENCIES } from "../core/player/equalizerPresets";
import { Cover } from "./Cover";
import {
  HeartIcon,
  MoonIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PreviousIcon,
  QueueIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
  SliderIcon,
  SpeedIcon,
  VolumeIcon,
  VolumeMuteIcon,
} from "./icons";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatRemaining(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface PlayerBarProps {
  onOpenQueue: () => void;
}

export function PlayerBar({ onOpenQueue }: PlayerBarProps) {
  const { t, tf } = useI18n();
  const snapshot = useApp((s) => s.snapshot);
  const likedIds = useApp((s) => s.likedIds);
  const sleepUntil = useApp((s) => s.sleepUntil);
  const sleepRemaining = useApp((s) => s.sleepRemaining);
  const pauseAfterTrack = useApp((s) => s.pauseAfterTrack);
  const togglePlay = useApp((s) => s.togglePlay);
  const next = useApp((s) => s.next);
  const previous = useApp((s) => s.previous);
  const seek = useApp((s) => s.seek);
  const setVolume = useApp((s) => s.setVolume);
  const setSpeed = useApp((s) => s.setSpeed);
  const setEqualizer = useApp((s) => s.setEqualizer);
  const toggleShuffle = useApp((s) => s.toggleShuffle);
  const cycleRepeat = useApp((s) => s.cycleRepeat);
  const toggleLike = useApp((s) => s.toggleLike);
  const setSleepMinutes = useApp((s) => s.setSleepMinutes);
  const setSleepAfterTrack = useApp((s) => s.setSleepAfterTrack);
  const clearSleep = useApp((s) => s.clearSleep);
  const [sleepOpen, setSleepOpen] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [eqOpen, setEqOpen] = useState(false);
  const speedOptions = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const eqActive = snapshot.equalizer.some((g) => g !== 0);

  const track = snapshot.current;
  const duration = track?.duration ?? snapshot.duration;
  const liked = track ? likedIds.includes(track.id) : false;
  const sleepActive = sleepUntil !== null || pauseAfterTrack;
  const sleepLabel = pauseAfterTrack
    ? t("player").sleepTimerOptions.afterTrack
    : sleepRemaining > 0
      ? formatRemaining(sleepRemaining)
      : "";

  return (
    <footer className="player-bar">
      <div className="player-track">
        {track?.coverUrl ? (
          <Cover className="player-cover" src={track.coverUrl} alt="" />
        ) : (
          <div className="player-cover player-cover-empty" />
        )}
        <div className="player-track-info">
          <span className="player-title">{track?.title ?? t("common").unknown}</span>
          <span className="player-artist">{track?.artist ?? t("player").queue}</span>
        </div>
        <button
          className={`icon-btn ${liked ? "liked" : ""}`}
          disabled={!track}
          onClick={() => void toggleLike()}
          title={t("common").like}
        >
          <HeartIcon size={18} filled={liked} />
        </button>
      </div>

      <div className="player-controls">
        <div className="player-buttons">
          <button
            className={`icon-btn ${snapshot.shuffle ? "active" : ""}`}
            onClick={toggleShuffle}
            title={t("player").shuffle}
          >
            <ShuffleIcon size={17} />
          </button>
          <button className="icon-btn" onClick={() => void previous()} title={t("player").previous}>
            <PreviousIcon size={22} />
          </button>
          <button className="play-btn" onClick={() => void togglePlay()} title={snapshot.state === "playing" ? t("player").pause : t("player").play}>
            {snapshot.state === "playing" ? (
              <PauseIcon size={24} />
            ) : (
              <PlayIcon size={24} />
            )}
          </button>
          <button className="icon-btn" onClick={() => void next()} title={t("player").next}>
            <NextIcon size={22} />
          </button>
          <button
            className={`icon-btn ${snapshot.repeat !== "off" ? "active" : ""}`}
            onClick={cycleRepeat}
            title={snapshot.repeat === "one" ? t("player").repeatOne : t("player").repeat}
          >
            {snapshot.repeat === "one" ? <RepeatOneIcon size={17} /> : <RepeatIcon size={17} />}
          </button>
        </div>
        <div className="player-progress">
          <span className="time">{formatTime(snapshot.position)}</span>
          <input
            type="range"
            className="seek"
            min={0}
            max={duration || 100}
            step={1}
            value={Math.min(snapshot.position, duration || 0)}
            disabled={!track}
            onChange={(e) => seek(Number(e.target.value))}
          />
          <span className="time">{formatTime(duration)}</span>
        </div>
      </div>

      <div className="player-side">
        <button
          className={`icon-btn ${snapshot.volume === 0 ? "muted" : ""}`}
          onClick={() => setVolume(snapshot.volume === 0 ? 100 : 0)}
          title={snapshot.volume === 0 ? t("player").mute : t("player").volume}
        >
          {snapshot.volume === 0 ? <VolumeMuteIcon size={18} /> : <VolumeIcon size={18} />}
        </button>
        <input
          type="range"
          className="volume"
          min={0}
          max={100}
          value={Math.round(snapshot.volume * 100)}
          onChange={(e) => setVolume(Number(e.target.value))}
        />
        <button className="icon-btn" onClick={onOpenQueue} title={t("nav").queue}>
          <QueueIcon size={18} />
        </button>
        <div className="sleep-menu-wrap">
          <button
            className={`icon-btn ${snapshot.speed !== 1 ? "active" : ""}`}
            onClick={() => setSpeedOpen((o) => !o)}
            title={t("player").speed}
          >
            <SpeedIcon size={18} />
          </button>
          {snapshot.speed !== 1 && <span className="sleep-badge">{snapshot.speed}x</span>}
          {speedOpen && (
            <div className="sleep-menu" onClick={(e) => e.stopPropagation()}>
              <div className="sleep-menu-title">{t("player").speed}</div>
              {speedOptions.map((rate) => (
                <button
                  key={rate}
                  className={rate === snapshot.speed ? "active" : ""}
                  onClick={() => {
                    setSpeed(rate);
                    setSpeedOpen(false);
                  }}
                >
                  {rate}x
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="sleep-menu-wrap">
          <button
            className={`icon-btn ${eqActive ? "active" : ""}`}
            onClick={() => setEqOpen((o) => !o)}
            title={t("player").equalizer}
          >
            <SliderIcon size={18} />
          </button>
          {eqOpen && (
            <div className="sleep-menu eq-popup" onClick={(e) => e.stopPropagation()}>
              <div className="sleep-menu-title">{t("player").equalizer}</div>
              <div className="eq-presets">
                {EQ_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    className={preset.gains.every((g, i) => g === (snapshot.equalizer[i] ?? 0)) ? "active" : ""}
                    onClick={() => setEqualizer(preset.gains)}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
              <div className="eq-sliders">
                {EQ_FREQUENCIES.map((freq, i) => (
                  <div key={freq} className="eq-slider-col">
                    <span className="eq-val">{snapshot.equalizer[i] ?? 0}</span>
                    <input
                      type="range"
                      className="eq-slider"
                      min={-12}
                      max={12}
                      step={1}
                      value={snapshot.equalizer[i] ?? 0}
                      onChange={(e) => {
                        const next = [...snapshot.equalizer];
                        while (next.length <= i) next.push(0);
                        next[i] = Number(e.target.value);
                        setEqualizer(next);
                      }}
                    />
                    <span className="eq-label">{freq >= 1000 ? `${freq / 1000}k` : freq}</span>
                  </div>
                ))}
              </div>
              <button className="btn small" onClick={() => {
                setEqualizer(new Array(EQ_FREQUENCIES.length).fill(0));
              }}>
                {t("player").sleepTimerOptions.off}
              </button>
            </div>
          )}
        </div>
        <div className="sleep-menu-wrap">
          <button
            className={`icon-btn ${sleepActive ? "active" : ""}`}
            onClick={() => setSleepOpen((o) => !o)}
            title={sleepActive ? `${t("player").sleepTimer}: ${sleepLabel}` : t("player").sleepTimer}
          >
            <MoonIcon size={18} />
          </button>
          {sleepActive && <span className="sleep-badge">{sleepLabel}</span>}
          {sleepOpen && (
            <div className="sleep-menu" onClick={(e) => e.stopPropagation()}>
              <div className="sleep-menu-title">{t("player").sleepTimer}</div>
              {[15, 30, 60, 90].map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setSleepMinutes(m);
                    setSleepOpen(false);
                  }}
                >
                  {tf("player").sleepTimerOptions.minutes(m)}
                </button>
              ))}
              <button
                onClick={() => {
                  setSleepAfterTrack();
                  setSleepOpen(false);
                }}
              >
                {t("player").sleepTimerOptions.afterTrack}
              </button>
              {sleepActive && (
                <button className="danger" onClick={() => { clearSleep(); setSleepOpen(false); }}>
                  {t("player").sleepTimerOptions.off}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}
