import { AgentExecutor } from "../core/agent/AgentExecutor";
import { AgentFault } from "../core/agent/execution";
import { WaveAgentTools, type WaveAgentHost } from "../core/agent/WaveAgentTools";
import { playbackSource } from "../core/types";
import { searchAllDetailed, type AppServices } from "./compose";
import type { AppState } from "./stores";
import { isArtistBlocked, isBlockedProvider, isTrackBlocked } from "./platformSettings";

/** Lazy-loaded only after the native desktop capability check. No model or transport is started. */
export function createWaveAgentHost(services: AppServices, get: () => AppState): WaveAgentHost {
  const current = () => {
    const state = get();
    if (state.services !== services) throw new AgentFault("cancelled");
    return state;
  };
  const playback = async (operation: () => Promise<void>, signal: AbortSignal, requirePlaying = false) => {
    signal.throwIfAborted(); current();
    const e = services.engine;
    let failed = false;
    const off = e.on("error", () => { failed = true; });
    let revision = e.playbackRevision;
    const abort = () => { if (e.playbackRevision === revision) e.pause(); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      const pending = operation();
      revision = e.playbackRevision;
      if (signal.aborted) abort();
      await pending;
      signal.throwIfAborted(); current();
      if (failed || e.snapshot.state === "error" || (requirePlaying && !["playing", "loading"].includes(e.snapshot.state))) {
        throw new AgentFault("playback_failed");
      }
    } finally {
      off(); signal.removeEventListener("abort", abort);
    }
  };
  return {
    engine: services.engine, storage: services.storage,
    search: async (query, signal) => {
      current();
      const result = await searchAllDetailed(services.providers, query, signal);
      current();
      if (!result.available) throw new AgentFault("provider_unavailable");
      return { incomplete: result.incomplete, tracks: result.results.flatMap((r) => r.tracks)
        .filter((t) => !isTrackBlocked(t.id) && !isArtistBlocked(t.artist)) };
    },
    prepareTrack: (track) => { current(); return services.recordings?.resolve(track) ?? track; },
    playable: (track) => {
      const source = playbackSource(track);
      return Boolean(source.uri) && !source.meta?.noPlay && !isTrackBlocked(track.id)
        && !isArtistBlocked(track.artist) && !isBlockedProvider(source.provider);
    },
    play: (tracks, signal) => playback(() => current().play(tracks), signal, true),
    playback: (action, signal) => playback(() => action === "resume" ? services.engine.play()
      : action === "next" ? current().next() : current().previous(), signal, action === "resume"),
    pause: () => { current().cancelArtistRadio(); services.engine.pause(); },
    clearQueue: () => { current().cancelArtistRadio(); current().clearQueue(); },
    setVolume: (percent) => current().setVolume(percent),
    setSpeed: (rate) => current().setSpeed(rate),
    setEqualizer: (gains) => current().setEqualizer(gains),
    createPlaylist: async (name, signal) => {
      const pl = await current().createPlaylist(name, [], signal);
      if (!pl) throw new AgentFault("internal_error");
      return pl;
    },
    addToPlaylist: async (id, track, signal) => {
      const added = await current().addToPlaylist(id, track, signal);
      if (added === null) throw new AgentFault("not_found");
      return added;
    },
    setLiked: (track, liked, signal) => current().setLiked(track, liked, signal),
    radio: async (artist, signal) => {
      const station = await current().startArtistRadio(artist, signal, false);
      signal.throwIfAborted();
      if (!station) throw new AgentFault("provider_unavailable");
      if (!["playing", "loading"].includes(services.engine.snapshot.state)) throw new AgentFault("playback_failed");
      return { artist: station.artist, trackCount: station.tracks.length };
    },
  };
}

export function createDesktopAgentSession(services: AppServices, get: () => AppState): AgentExecutor {
  return new AgentExecutor(new WaveAgentTools(createWaveAgentHost(services, get)));
}
