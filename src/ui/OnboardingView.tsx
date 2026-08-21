import { useEffect, useRef, useState } from "react";
import { useI18n } from "./I18nContext";
import { useApp } from "../app/stores";
import { searchAll } from "../app/compose";
import { SearchIcon, SpinnerIcon } from "./icons";

interface OnboardingArtist {
  name: string;
  provider: string;
  id: string;
  coverUrl?: string;
}

export function OnboardingView() {
  const { t } = useI18n();
  const providers = useApp((s) => s.services?.providers ?? []);
  const completeOnboarding = useApp((s) => s.completeOnboarding);

  const [input, setInput] = useState("");
  const [results, setResults] = useState<OnboardingArtist[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Map<string, OnboardingArtist>>(new Map());
  const [suggestions, setSuggestions] = useState<OnboardingArtist[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const debounceRef = useRef<number | undefined>(undefined);

  const MIN_PICK = 3;
  const canContinue = selected.size >= MIN_PICK;

  const ot = t("onboarding");

  useEffect(() => {
    window.clearTimeout(debounceRef.current);
    if (!input.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      let cancelled = false;
      setSearching(true);
      searchAll(providers, input.trim())
        .then((r) => {
          if (cancelled) return;
          const artists: OnboardingArtist[] = [];
          const seen = new Set<string>();
          for (const s of r) {
            for (const a of s.artists) {
              const key = `${a.provider}:${a.name}`.toLowerCase();
              if (seen.has(key)) continue;
              seen.add(key);
              artists.push({ name: a.name, provider: a.provider, id: a.id, coverUrl: a.coverUrl });
            }
          }
          setResults(artists);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
      return () => { cancelled = true; };
    }, 350);
    return () => window.clearTimeout(debounceRef.current);
  }, [input, providers]);

  const toggleArtist = (artist: OnboardingArtist) => {
    setSelected((prev) => {
      const next = new Map(prev);
      const key = `${artist.provider}:${artist.name}`;
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.set(key, artist);
      }
      return next;
    });
  };

  useEffect(() => {
    if (selected.size < 1) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    setSuggestionsLoading(true);
    const names = [...selected.values()].map((a) => a.name).slice(0, 5);

    const fetchSimilar = async (): Promise<string[]> => {
      const provsWithSimilar = providers.filter((p) => typeof p.getSimilarArtists === "function");
      const viaMethod = await Promise.allSettled(
        provsWithSimilar.flatMap((p) =>
          names.map((n) => p.getSimilarArtists!(n)),
        ),
      );
      const methodNames: string[] = [];
      for (const r of viaMethod) {
        if (r.status === "fulfilled") methodNames.push(...r.value);
      }

      if (methodNames.length >= 8) return methodNames;

      const fallbackResults = await Promise.allSettled(
        names.map((n) => searchAll(providers, `${n} similar`)),
      );
      const fallbackNames: string[] = [];
      for (const r of fallbackResults) {
        if (r.status !== "fulfilled") continue;
        for (const s of r.value) {
          for (const a of s.artists) {
            fallbackNames.push(a.name);
          }
        }
      }

      return [...methodNames, ...fallbackNames];
    };

    void fetchSimilar().then((allNames) => {
      if (cancelled) return;
      const nameCounts = new Map<string, number>();
      for (const name of allNames) {
        const norm = name.trim();
        if (!norm) continue;
        nameCounts.set(norm, (nameCounts.get(norm) ?? 0) + 1);
      }
      const selectedNames = new Set([...selected.values()].map((a) => a.name.toLowerCase()));
      const sorted = [...nameCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 24)
        .map(([name]) => name)
        .filter((name) => !selectedNames.has(name.toLowerCase()));
      const onboardingArtists: OnboardingArtist[] = sorted.map((name) => ({
        name,
        provider: "similar",
        id: `similar:${name}`,
      }));
      setSuggestions(onboardingArtists);
      setSuggestionsLoading(false);
    });
    return () => { cancelled = true; };
  }, [selected, providers]);

  const isSelected = (artist: OnboardingArtist) =>
    selected.has(`${artist.provider}:${artist.name}`);

  const handleContinue = () => {
    if (!canContinue) return;
    completeOnboarding([...selected.values()].map((a) => a.name));
  };

  const handleSkip = () => {
    completeOnboarding([]);
  };

  return (
    <div className="view onboarding-view">
      <div className="onboarding-header">
        <h1>{ot.title}</h1>
        <p>{ot.subtitle}</p>
      </div>

      <form className="search-box" onSubmit={(e) => e.preventDefault()}>
        <SearchIcon size={18} />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={ot.searchPlaceholder}
          autoFocus
        />
        {input && (
          <button type="button" className="icon-btn search-clear" onClick={() => setInput("")}>
            ✕
          </button>
        )}
      </form>

      {selected.size > 0 && (
        <div className="onboarding-selected">
          <span className="onboarding-selected-count">{ot.selected(selected.size)}</span>
          <div className="onboarding-selected-chips">
            {[...selected.values()].map((a) => (
              <button
                key={`${a.provider}:${a.name}`}
                className="onboarding-chip active"
                onClick={() => toggleArtist(a)}
              >
                {a.name} ✕
              </button>
            ))}
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="onboarding-results">
          <div className="card-grid">
            {results.map((a) => (
              <ArtistPickCard key={`${a.provider}:${a.id}`} artist={a} picked={isSelected(a)} onToggle={toggleArtist} />
            ))}
          </div>
        </div>
      )}

      {searching && (
        <div className="onboarding-loading">
          <SpinnerIcon size={24} />
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="onboarding-suggestions">
          <h2>{ot.suggestionTitle}</h2>
          <p className="muted">{ot.suggestionDesc}</p>
          <div className="card-grid">
            {suggestions.map((a) => (
              <ArtistPickCard key={a.id} artist={a} picked={isSelected(a)} onToggle={toggleArtist} />
            ))}
          </div>
        </div>
      )}

      {suggestionsLoading && selected.size > 0 && suggestions.length === 0 && (
        <div className="onboarding-loading">
          <SpinnerIcon size={24} />
        </div>
      )}

      <div className="onboarding-footer">
        {!canContinue && selected.size > 0 && (
          <p className="onboarding-min-hint">{ot.minHint}</p>
        )}
        <button className="btn onboarding-continue" disabled={!canContinue} onClick={handleContinue}>
          {canContinue ? `${ot.continueBtn} →` : ot.minHint}
        </button>
        <button className="btn small onboarding-skip" onClick={handleSkip}>
          {ot.skip}
        </button>
      </div>
    </div>
  );
}

function ArtistPickCard({
  artist,
  picked,
  onToggle,
}: {
  artist: OnboardingArtist;
  picked: boolean;
  onToggle: (a: OnboardingArtist) => void;
}) {
  return (
    <button
      className={`media-card onboarding-artist-card ${picked ? "onboarding-picked" : ""}`}
      onClick={() => onToggle(artist)}
    >
      {artist.coverUrl ? (
        <img src={artist.coverUrl} alt="" loading="lazy" />
      ) : (
        <div className="media-card-empty artist">{artist.name.charAt(0).toUpperCase()}</div>
      )}
      <span className="media-card-title">{artist.name}</span>
      {picked && <span className="onboarding-check">✓</span>}
    </button>
  );
}
