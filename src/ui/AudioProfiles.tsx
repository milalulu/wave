import { useState } from "react";
import { useApp } from "../app/stores";
import { normalizeEqualizer, sanitizeAudioValue } from "../core/player/equalizerPresets";
import type { AudioEffects } from "../app/audioEffects";
import type { LevelingSettings } from "../app/levelingStore";
import { useI18n } from "./I18nContext";

const KEY = "wave:audio-profiles";
const MAX_PROFILES = 16;
type Profile = AudioEffects & { name: string; equalizer: number[]; leveling: LevelingSettings };

function loadProfiles(): Profile[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (Array.isArray(value)) return value.filter((entry): entry is Profile =>
      typeof entry?.name === "string" && entry.name.trim().length > 0 && Array.isArray(entry.equalizer) && entry.leveling,
    ).slice(0, MAX_PROFILES);
  } catch { /* New profiles can still be created for this session. */ }
  return [];
}

export function AudioProfiles() {
  const { locale } = useI18n();
  const ru = locale === "ru";
  const [profiles, setProfiles] = useState(loadProfiles);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const ready = useApp((state) => Boolean(state.services));
  const label = name.trim();
  const exists = profiles.some((item) => item.name === label);

  function persist(next: Profile[]) {
    setProfiles(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* Keep the in-session list. */ }
  }

  function save() {
    const state = useApp.getState();
    const profile: Profile = {
      name: label, equalizer: normalizeEqualizer(state.snapshot.equalizer),
      bassBoost: state.bassBoost, reverb: state.reverb, stereoWidth: state.stereoWidth, spatialOrbit: state.spatialOrbit,
      leveling: { enabled: state.levelingEnabled, targetDb: state.levelingTargetDb, mode: state.levelingMode },
    };
    persist([...profiles.filter((item) => item.name !== label), profile]);
    setSelected(label);
    setName("");
  }

  function apply() {
    const profile = profiles.find((item) => item.name === selected);
    if (!profile) return;
    const state = useApp.getState();
    state.setEqualizer(normalizeEqualizer(profile.equalizer));
    state.setBassBoost(sanitizeAudioValue(profile.bassBoost, 0, 15));
    state.setReverb(sanitizeAudioValue(profile.reverb, 0, 1));
    state.setStereoWidth(sanitizeAudioValue(profile.stereoWidth, -1, 1));
    state.setSpatialOrbit(sanitizeAudioValue(profile.spatialOrbit, 0, 1));
    const mode = profile.leveling.mode;
    state.setLeveling(profile.leveling.enabled === true, profile.leveling.targetDb,
      mode === "album" || mode === "track" ? mode : "adaptive");
    state.notify(ru ? `Профиль «${profile.name}» применён` : `Applied “${profile.name}”`);
  }

  return <div className="audio-profiles">
    <form className="setting-row" onSubmit={(event) => { event.preventDefault(); if (ready && label && (exists || profiles.length < MAX_PROFILES)) save(); }}>
      <input type="text" maxLength={42} value={name} placeholder={ru ? "Например, наушники" : "For example, headphones"}
        aria-label={ru ? "Имя звукового профиля" : "Sound profile name"} onChange={(event) => setName(event.target.value)} />
      <button className="btn small" type="submit" disabled={!ready || !label || (!exists && profiles.length >= MAX_PROFILES)}>
        {exists ? (ru ? "Обновить профиль" : "Update profile") : (ru ? "Сохранить профиль" : "Save profile")}
      </button>
    </form>
    {profiles.length > 0 && <div className="setting-row">
      <select value={selected} aria-label={ru ? "Звуковой профиль" : "Sound profile"} onChange={(event) => setSelected(event.target.value)}>
        <option value="">{ru ? "Выбери профиль" : "Choose a profile"}</option>
        {profiles.map((item) => <option value={item.name} key={item.name}>{item.name}</option>)}
      </select>
      <button className="btn small" type="button" disabled={!ready || !selected} onClick={apply}>{ru ? "Применить" : "Apply"}</button>
      <button className="btn small secondary" type="button" disabled={!selected} onClick={() => {
        persist(profiles.filter((item) => item.name !== selected));
        setSelected("");
      }}>{ru ? "Удалить" : "Delete"}</button>
    </div>}
  </div>;
}
