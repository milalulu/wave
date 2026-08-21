import { useEffect, useRef, useState } from "react";
import { useApp } from "../app/stores";
import { openMiniPlayerWindow } from "../app/mini";
import { useI18n } from "./I18nContext";
import { EQ_PRESETS, EQ_FREQUENCIES } from "../core/player/equalizerPresets";
import { Cover } from "./Cover";
import { providerLabel } from "./providers";
import { Spectrum } from "./Spectrum";
import { formatTime } from "../core/util/format";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ChartIcon,
  ExpandIcon,
  HeartIcon,
  MiniPlayerIcon,
  MoonIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PreviousIcon,
  QueueIcon,
  RadioIcon,
  RefreshCwIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
  SliderIcon,
  SpeedIcon,
  SpinnerIcon,
  VolumeIcon,
  VolumeMuteIcon,
} from "./icons";
import { usePopoverDismiss } from "./usePopoverDismiss";

function formatRemaining(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface PlayerBarProps {
  onOpenQueue: () => void;
  onOpenPlayer: () => void;
}

export function PlayerBar({ onOpenQueue, onOpenPlayer }: PlayerBarProps) {
  const { t, tf } = useI18n();
  const snapshot = useApp((s) => s.snapshot);
  const position = useApp((s) => s.position);
  const storeDuration = useApp((s) => s.duration);
  const likedIds = useApp((s) => s.likedIds);
  const sleepUntil = useApp((s) => s.sleepUntil);
  const sleepRemaining = useApp((s) => s.sleepRemaining);
  const pauseAfterTrack = useApp((s) => s.pauseAfterTrack);
  const compactPlayer = useApp((s) => s.compactPlayer);
  const setCompactPlayer = useApp((s) => s.setCompactPlayer);
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
  const startRadio = useApp((s) => s.startRadio);
  const variants = useApp((s) => s.variants);
  const variantsLoading = useApp((s) => s.variantsLoading);
  const playVariant = useApp((s) => s.playVariant);
  const addSimilar = useApp((s) => s.addSimilar);
  const setSleepMinutes = useApp((s) => s.setSleepMinutes);
  const setSleepAfterTrack = useApp((s) => s.setSleepAfterTrack);
  const clearSleep = useApp((s) => s.clearSleep);
  const services = useApp((s) => s.services);
  const [sleepOpen, setSleepOpen] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [eqOpen, setEqOpen] = useState(false);
  const [variantsOpen, setVariantsOpen] = useState(false);
  const [spectrumOpen, setSpectrumOpen] = useState(false);
  const sleepRef = useRef<HTMLDivElement>(null);
  const speedRef = useRef<HTMLDivElement>(null);
  const eqRef = useRef<HTMLDivElement>(null);
  const variantsRef = useRef<HTMLDivElement>(null);
  const spectrumRef = useRef<HTMLDivElement>(null);

  usePopoverDismiss(sleepRef, sleepOpen, () => setSleepOpen(false));
  usePopoverDismiss(speedRef, speedOpen, () => setSpeedOpen(false));
  usePopoverDismiss(eqRef, eqOpen, () => setEqOpen(false));
  usePopoverDismiss(variantsRef, variantsOpen, () => setVariantsOpen(false));
  usePopoverDismiss(spectrumRef, spectrumOpen, () => setSpectrumOpen(false));
  const speedOptions = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const eqActive = snapshot.equalizer.some((g) => g !== 0);

  const track = snapshot.current;
  const duration = track?.duration ?? storeDuration;
  const liked = track ? likedIds.has(track.id) : false;
  const buffering = snapshot.state === "loading";
  const hasError = snapshot.state === "error";
  const sleepActive = sleepUntil !== null || pauseAfterTrack;
  const sleepLabel = pauseAfterTrack
    ? t("player").sleepTimerOptions.afterTrack
    : sleepRemaining > 0
      ? formatRemaining(sleepRemaining)
      : "";

  useEffect(() => {
    setVariantsOpen(false);
  }, [track?.id]);

  const playButton = (
    <button
      className={`play-btn ${hasError ? "error" : ""}`}
      onClick={() => void togglePlay()}
      disabled={false}
      title={hasError ? "Retry" : buffering ? t("common").loading : snapshot.state === "playing" ? t("player").pause : t("player").play}
    >
      {hasError ? (
        <RefreshCwIcon size={24} />
      ) : buffering ? (
        <SpinnerIcon size={26} />
      ) : snapshot.state === "playing" ? (
        <PauseIcon size={24} />
      ) : (
        <PlayIcon size={24} />
      )}
    </button>
  );

  if (compactPlayer) {
    return (
      <footer className="player-bar mini">
        {track?.coverUrl ? (
          <Cover className="player-mini-cover" src={track.coverUrl} alt="" />
        ) : (
          <div className="player-mini-cover-empty" />
        )}
        <div className="player-mini-info">
          <span className="player-mini-title">{track?.title ?? t("common").unknown}</span>
          <span className="player-mini-artist">{track?.artist ?? ""}</span>
        </div>
        <div className="player-progress">
          <span className="time">{formatTime(position)}</span>
          <input
            type="range"
            className="seek"
            min={0}
            max={duration || 100}
            step={1}
            value={Math.min(position, duration || 0)}
            disabled={!track}
            aria-label="Seek"
            onChange={(e) => seek(Number(e.target.value))}
          />
          <span className="time">{formatTime(duration)}</span>
        </div>
        <div className="player-buttons">
          {playButton}
          <button className="icon-btn" onClick={() => void next()} title={t("player").next}>
            <NextIcon size={20} />
          </button>
          <button
            className="icon-btn"
            onClick={() => setCompactPlayer(false)}
            title={t("player").queue}
          >
            <ExpandIcon size={18} />
          </button>
        </div>
      </footer>
    );
  }

  return (
    <footer className="player-bar">
      {spectrumOpen && services?.engine && (
        <div className="player-spectrum">
          <Spectrum engine={services.engine} />
        </div>
      )}
      <div className="player-track" onClick={onOpenPlayer}>
        {track?.coverUrl ? (
          <Cover className="player-cover" src={track.coverUrl} alt="" />
        ) : (
          <div className="player-cover player-cover-empty" />
        )}
        <div className="player-track-info">
          {track && (
            <div className="player-variants-wrap" ref={variantsRef}>
              <button
                className={`variants-toggle ${variantsOpen ? "active" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setVariantsOpen((o) => !o);
                }}
                title={t("player").variants}
              >
                {variantsLoading ? (
                  <SpinnerIcon size={12} />
                ) : (
                  variantsOpen ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} />
                )}
                <span>{t("player").variants}</span>
                {variants.length > 0 && <span className="variants-count">{variants.length}</span>}
              </button>
              {variantsOpen && (
                <div className="variants-menu" onClick={(e) => e.stopPropagation()}>
                  <div className="sleep-menu-title">{t("player").variants}</div>
                  {!variantsLoading && variants.length === 0 && (
                    <div className="variants-empty">{t("player").variantsEmpty}</div>
                  )}
                  {variants.map((v) => (
                    <button
                      key={v.track.id}
                      className="variants-item"
                      onClick={() => {
                        setVariantsOpen(false);
                        playVariant(v);
                      }}
                    >
                      <span className="variants-provider">{providerLabel(v.providerId)}</span>
                      <span className="variants-track">
                        <span className="variants-title">{v.track.title}</span>
                        {v.track.artist && (
                          <span className="variants-artist">{v.track.artist}</span>
                        )}
                      </span>
                      {v.track.duration ? (
                        <span className="variants-duration">{formatTime(v.track.duration)}</span>
                      ) : null}
                      <PlayIcon size={14} />
                    </button>
                  ))}
                  <div className="variants-actions">
                    <button
                      className="variants-similar"
                      onClick={() => {
                        setVariantsOpen(false);
                        void addSimilar();
                      }}
                    >
                      <RadioIcon size={14} /> {t("player").similar}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          <span className="player-title">{track?.title ?? t("common").unknown}</span>
          <span className="player-artist">{track?.artist ?? t("player").queue}</span>
        </div>
        <button
          className={`icon-btn ${liked ? "liked" : ""}`}
          disabled={!track}
          onClick={(e) => {
            e.stopPropagation();
            void toggleLike();
          }}
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
          {playButton}
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
          <button
            className="icon-btn"
            onClick={() => void startRadio()}
            disabled={!track}
            title={t("player").radio}
          >
            <RadioIcon size={17} />
          </button>
        </div>
        <div className="player-progress">
          <span className="time">{formatTime(position)}</span>
          <input
            type="range"
            className="seek"
            min={0}
            max={duration || 100}
            step={1}
            value={Math.min(position, duration || 0)}
            disabled={!track}
            aria-label="Seek"
            onChange={(e) => seek(Number(e.target.value))}
          />
          <span className="time">{formatTime(duration)}</span>
        </div>
      </div>

      <div className="player-side">
        <button
          className="icon-btn"
          onClick={() => {
            if ((window as { __TAURI__?: unknown }).__TAURI__ && !/Android/i.test(navigator.userAgent)) {
              void openMiniPlayerWindow();
            } else {
              setCompactPlayer(true);
            }
          }}
          title={t("player").mini}
        >
          <MiniPlayerIcon size={18} />
        </button>
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
          aria-label="Volume"
          onChange={(e) => setVolume(Number(e.target.value))}
        />
        <button className="icon-btn" onClick={onOpenQueue} title={t("nav").queue}>
          <QueueIcon size={18} />
        </button>
        <div className="sleep-menu-wrap" ref={speedRef}>
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
        <div className="sleep-menu-wrap" ref={eqRef}>
          <button
            className={`icon-btn ${spectrumOpen ? "active" : ""}`}
            onClick={() => setSpectrumOpen((o) => !o)}
            title={t("player").spectrum}
          >
            <ChartIcon size={18} />
          </button>
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
                      aria-label={`${freq >= 1000 ? `${freq / 1000}k` : freq} Hz`}
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
        <div className="sleep-menu-wrap" ref={sleepRef}>
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
              <div className="sleep-custom">
                <input
                  type="number"
                  min={1}
                  max={480}
                  placeholder="..."
                  className="sleep-custom-input"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const val = Number((e.target as HTMLInputElement).value);
                      if (val > 0) { setSleepMinutes(val); setSleepOpen(false); }
                    }
                  }}
                />
                <button
                  className="btn small"
                  onClick={(e) => {
                    const input = (e.currentTarget.previousElementSibling as HTMLInputElement);
                    const val = Number(input?.value);
                    if (val > 0) { setSleepMinutes(val); setSleepOpen(false); }
                  }}
                >
                  OK
                </button>
              </div>
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
