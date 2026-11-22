import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { IconButton } from "./primitives/IconButton";
import { NextIcon, PauseIcon, PlayIcon, PreviousIcon, RepeatIcon, ShuffleIcon, SpinnerIcon } from "./icons";

export function PlaybackControls({ onPickTrack }: { onPickTrack: () => void }) {
  const { t } = useI18n();
  const snapshot = useApp((s) => s.snapshot);
  const togglePlay = useApp((s) => s.togglePlay);
  const previous = useApp((s) => s.previous);
  const next = useApp((s) => s.next);
  const toggleShuffle = useApp((s) => s.toggleShuffle);
  const cycleRepeat = useApp((s) => s.cycleRepeat);
  const loading = snapshot.state === "loading";
  return <div className="echoes-transport pulse-transport" role="group" aria-label={t("app").nowPlaying}>
    <IconButton label={t("player").shuffle} active={snapshot.shuffle} aria-pressed={snapshot.shuffle} onClick={toggleShuffle}><ShuffleIcon size={24} /></IconButton>
    <IconButton label={t("player").previous} disabled={!snapshot.current} onClick={() => void previous()}><PreviousIcon size={26} /></IconButton>
    <IconButton className="echoes-main-play" label={loading ? t("common").loading : snapshot.state === "playing" ? t("player").pause : t("player").play} loading={loading} onClick={() => snapshot.current ? void togglePlay() : onPickTrack()}>
      {loading ? <SpinnerIcon size={30} /> : snapshot.state === "playing" ? <PauseIcon size={30} /> : <PlayIcon size={30} />}
    </IconButton>
    <IconButton label={t("player").next} disabled={!snapshot.current} onClick={() => void next()}><NextIcon size={26} /></IconButton>
    <IconButton label={snapshot.repeat === "one" ? t("player").repeatOne : t("player").repeat} active={snapshot.repeat !== "off"} aria-pressed={snapshot.repeat !== "off"} onClick={cycleRepeat}><RepeatIcon size={24} /></IconButton>
  </div>;
}
