import type { StateCreator } from "zustand";
import type { AppState } from "./stores";
import type { ArtistRadioStation } from "../core/radio/artistRadio";
import { normalizeArtistName } from "../core/radio/artistRadio";
import { buildArtistRadioStation, nextArtistRadioTracks } from "./artistRadio";
import { shuffleArray } from "../core/util/shuffle";
import { t } from "../core/i18n";

export type ArtistRadioState =
  | { status: "idle"; artist: ""; station: null; error: null }
  | { status: "loading"; artist: string; station: null; error: null }
  | { status: "ready"; artist: string; station: ArtistRadioStation; error: null }
  | { status: "error"; artist: string; station: null; error: string };

export interface ArtistRadioSlice {
  artistRadioState: ArtistRadioState;
  startArtistRadio: (artist: string, signal?: AbortSignal) => Promise<ArtistRadioStation | null>;
  refreshArtistRadio: () => Promise<ArtistRadioStation | null>;
  playArtistRadio: (index?: number, shuffle?: boolean) => Promise<void>;
  cancelArtistRadio: () => void;
  saveArtistRadioAsPlaylist: (name?: string) => Promise<void>;
}

export const createArtistRadioSlice: StateCreator<AppState, [], [], ArtistRadioSlice> = (set, get) => {
  let pending: AbortController | null = null;
  let generation = 0;

  return {
    artistRadioState: { status: "idle", artist: "", station: null, error: null },
    cancelArtistRadio: () => {
      generation++;
      pending?.abort();
      pending = null;
      if (get().artistRadioState.status === "loading") {
        set({ artistRadioState: { status: "idle", artist: "", station: null, error: null } });
      }
    },
    startArtistRadio: async (rawArtist, signal) => {
      signal?.throwIfAborted();
      const artist = normalizeArtistName(rawArtist);
      const services = get().services;
      if (!artist || !services) return null;
      pending?.abort();
      if (get().radioActive) {
        services.engine.setAutoFill(get().autoContinue ? null : async () => []);
        set({ radioActive: false });
      }
      const controller = new AbortController();
      pending = controller;
      const request = ++generation;
      let playbackRevision: number | null = null;
      const abort = () => {
        if (request !== generation) return;
        get().cancelArtistRadio();
        if (playbackRevision !== null && services.engine.playbackRevision === playbackRevision) services.engine.pause();
      };
      signal?.addEventListener("abort", abort, { once: true });
      set({ artistRadioState: { status: "loading", artist, station: null, error: null } });
      get().setView("artistRadio");
      try {
        const station = await buildArtistRadioStation(services, artist, 20, controller.signal);
        if (request !== generation) return null;
        if (!station.tracks.length) throw new Error(t("toasts").similarEmpty);
        set({ artistRadioState: { status: "ready", artist, station, error: null } });
        if (request !== generation || signal?.aborted) return null;
        const playing = get().playArtistRadio();
        playbackRevision = services.engine.playbackRevision;
        await playing;
        return request === generation ? station : null;
      } catch (error) {
        if (request !== generation) return null;
        const message = error instanceof Error ? error.message : String(error);
        set({ artistRadioState: { status: "error", artist, station: null, error: message } });
        get().notify(message);
        return null;
      } finally {
        signal?.removeEventListener("abort", abort);
        if (request === generation) pending = null;
      }
    },
    refreshArtistRadio: async () => {
      const artist = get().artistRadioState.artist;
      return artist ? get().startArtistRadio(artist) : null;
    },
    playArtistRadio: async (index = 0, shuffle = false) => {
      const { services, artistRadioState } = get();
      if (!services || artistRadioState.status !== "ready") return;
      const { station } = artistRadioState;
      const request = generation;
      const tracks = shuffle ? shuffleArray(station.tracks) : station.tracks;
      set({ radioActive: true });
      // Keep the station tied to its artist when extending the queue.
      services.engine.setAutoFill(async () => {
        const tracks = await nextArtistRadioTracks(services, station);
        if (generation !== request || !get().radioActive) return [];
        return tracks;
      });
      try {
        await services.engine.playTracks(tracks, shuffle ? 0 : index);
      } catch (error) {
        if (request === generation) {
          set({ radioActive: false });
          services.engine.setAutoFill(get().autoContinue ? null : async () => []);
        }
        throw error;
      }
    },
    saveArtistRadioAsPlaylist: async (name) => {
      const { station } = get().artistRadioState;
      if (!station) return;
      const title = name?.trim() || `${t("player").radio}: ${station.artist}`;
      await get().createPlaylist(title, station.tracks);
    },
  };
};
