import { EqualizerControls } from "./EqualizerControls";
import { trackCover } from "../core/cover/trackCover";
import { playbackSource } from "../core/types";
import { CastButton } from "./CastButton";
import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { useApp } from "../app/stores";
import { openMiniPlayerWindow } from "../app/mini";
import { useI18n } from "./I18nContext";
import { Cover } from "./Cover";
import { SeekBar } from "./SeekBar";
import { VolumeSlider } from "./VolumeSlider";
import { MiniSpectrum } from "./MiniSpectrum";
import { providerLabel } from "./providers";
import { Spectrum } from "./Spectrum";
import { formatTime } from "../core/util/format";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ChartIcon,
  ExpandIcon,
  HeartIcon,
  LyricsIcon,
  MiniPlayerIcon,
  MoreIcon,
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
import { SleepControl } from "./SleepControl";

interface PlayerBarProps {
  onOpenQueue: () => void;
  onOpenPlayer: () => void;
  onOpenLyrics?: () => void;
}

export function PlayerBar({ onOpenQueue, onOpenPlayer, onOpenLyrics }: PlayerBarProps) {
  const { t } = useI18n();
  const snapshot = useApp((s) => s.snapshot);
  const likedIds = useApp((s) => s.likedIds);
  const compactPlayer = useApp((s) => s.compactPlayer);
  const setCompactPlayer = useApp((s) => s.setCompactPlayer);
  const togglePlay = useApp((s) => s.togglePlay);
  const next = useApp((s) => s.next);
  const previous = useApp((s) => s.previous);
  const setVolume = useApp((s) => s.setVolume);
  const setSpeed = useApp((s) => s.setSpeed);
  const effectsBypassed = useApp((s) => s.effectsBypassed);
  const toggleShuffle = useApp((s) => s.toggleShuffle);
  const cycleRepeat = useApp((s) => s.cycleRepeat);
  const toggleLike = useApp((s) => s.toggleLike);
  const startRadio = useApp((s) => s.startRadio);
  const variants = useApp((s) => s.variants);
  const variantSaving = useApp((s) => s.variantSaving);
  const variantsLoading = useApp((s) => s.variantsLoading);
  const playVariant = useApp((s) => s.playVariant);
  const addSimilar = useApp((s) => s.addSimilar);
  const services = useApp((s) => s.services);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [eqOpen, setEqOpen] = useState(false);
  const [variantsOpen, setVariantsOpen] = useState(false);
  const [spectrumOpen, setSpectrumOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(toolsRef, toolsOpen, () => setToolsOpen(false));
  const speedRef = useRef<HTMLDivElement>(null);
  const eqRef = useRef<HTMLDivElement>(null);
  const variantsRef = useRef<HTMLDivElement>(null);
  const spectrumRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(speedRef, speedOpen, () => setSpeedOpen(false));
  usePopoverDismiss(eqRef, eqOpen, () => setEqOpen(false));
  usePopoverDismiss(variantsRef, variantsOpen, () => setVariantsOpen(false));
  usePopoverDismiss(spectrumRef, spectrumOpen, () => setSpectrumOpen(false));
  const speedOptions = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const eqActive = !effectsBypassed && snapshot.equalizer.some((g) => g !== 0);

  const track = snapshot.current;
  const liked = track ? likedIds.has(track.id) : false;
  const buffering = snapshot.state === "loading";
  const hasError = snapshot.state === "error";

  useEffect(() => {
    setVariantsOpen(false);
  }, [track?.id]);

  const playButton = (
    <button
      className={`play-btn ${hasError ? "error" : ""}`}
      onClick={() => void togglePlay()}
      disabled={false}
      title={hasError ? t("common").retry : buffering ? t("common").loading : snapshot.state === "playing" ? t("player").pause : t("player").play}
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
        <Cover className="player-mini-cover" src={trackCover(track)} alt="" />
        <div className="player-mini-info">
          <span className="player-mini-title">{track?.title ?? t("common").unknown}</span>
          <span className="player-mini-artist">{track?.artist ?? ""}</span>
        </div>
        <SeekBar track={track} />
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
        <Cover className="player-cover" src={trackCover(track)} alt="" />
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
                  <div className="variants-empty">{t("player").sourcePreferenceHint}</div>
                  {!variantsLoading && variants.length === 0 && (
                    <div className="variants-empty">{t("player").variantsEmpty}</div>
                  )}
                  {variants.map((v) => (
                    <button
                      key={v.track.id}
                      className="variants-item"
                      disabled={variantSaving}
                      aria-pressed={v.track.id === playbackSource(track).id}
                      title={v.track.id === playbackSource(track).id ? t("player").currentSource : undefined}
                      onClick={() => {
                        setVariantsOpen(false);
                        void playVariant(v);
                      }}
                    >
                      <span className="variants-provider">{providerLabel(v.providerId)}{v.track.id === playbackSource(track).id ? " ✓" : ""}</span>
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
          <div className="player-title-row" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span className="player-title">{track?.title ?? t("common").unknown}</span>
            <MiniSpectrum playing={snapshot.state === "playing"} />
          </div>
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
        <SeekBar track={track} />
      </div>

      <div className="echoes-footer-tools" ref={toolsRef}>
        <div className="echoes-footer-compact">
          <button className="icon-btn" onClick={() => setVolume(snapshot.volume === 0 ? 100 : 0)} title={t("player").volume}>
            {snapshot.volume === 0 ? <VolumeMuteIcon size={22} /> : <VolumeIcon size={22} />}
          </button>
          <VolumeSlider value={Math.round(snapshot.volume * 100)} onChange={setVolume} label={t("player").volume} />
          <button className="icon-btn" onClick={onOpenQueue} title={t("nav").queue}><QueueIcon size={22} /></button>
          {onOpenLyrics && <button className="icon-btn" onClick={onOpenLyrics} disabled={!track} title={t("player").lyrics}><LyricsIcon size={20} /></button>}
          <button className="icon-btn" aria-expanded={toolsOpen} onClick={() => setToolsOpen((open) => !open)} title={t("nav").settings}><MoreIcon size={20} /></button>
        </div>
      <div className={`player-side ${toolsOpen ? "echoes-tools-open" : ""}`}>
        <button
          className="icon-btn"
          onClick={() => {
            if (isTauri() && !/Android/i.test(navigator.userAgent)) {
              void openMiniPlayerWindow().catch((error: unknown) => useApp.getState().notify(String(error)));
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
        <VolumeSlider
          value={Math.round(snapshot.volume * 100)}
          onChange={setVolume}
          label={t("player").volume}
        />
      <CastButton />
        <button className="icon-btn" onClick={onOpenQueue} title={t("nav").queue}>
          <QueueIcon size={18} />
        </button>
        {onOpenLyrics && <button className="icon-btn" onClick={onOpenLyrics} disabled={!track} title={t("player").lyrics}><LyricsIcon size={18} /></button>}
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
              <EqualizerControls />
            </div>
          )}
        </div>
        <SleepControl />
      </div>
      </div>
    </footer>
  );
}
