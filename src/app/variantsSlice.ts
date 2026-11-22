import type { StateCreator } from "zustand";
import type { AppState } from "./stores";
import { playbackSource, type Track } from "../core/types";
import { findTrackVariants, type TrackVariant } from "./trackVariants";
import { t } from "../core/i18n";

export interface VariantsSlice {
  variants: TrackVariant[];
  variantsLoading: boolean;
  variantSaving: boolean;
  loadVariants: (track: Track | null) => Promise<void>;
  playVariant: (variant: TrackVariant) => Promise<void>;
}

export const createVariantsSlice: StateCreator<AppState, [], [], VariantsSlice> = (set, get) => {
  let generation = 0;
  return {
    variants: [], variantsLoading: false, variantSaving: false,
    loadVariants: async (track) => {
      const request = ++generation;
      const { services } = get();
      if (!track || !services) {
        set({ variants: [], variantsLoading: false });
        return;
      }
      const known = services.recordings?.sources(track) ?? [playbackSource(track)];
      const initial = known.map((source) => ({ providerId: source.provider, track: source }));
      set({ variants: initial, variantsLoading: true });
      try {
        const found = await findTrackVariants(services.providers, track);
        if (request !== generation) return;
        if (get().services !== services) {
          set({ variantsLoading: false });
          return;
        }
        const variants = [...new Map([...initial, ...found].map((v) => [v.track.id, v])).values()];
        set({ variants, variantsLoading: false });
        if (services.recordings) {
          for (const variant of found) {
            void services.recordings.associate(track, variant.track).catch(() => {});
          }
        }
      } catch {
        if (request === generation) set({ variantsLoading: false });
      }
    },
    playVariant: async (variant) => {
      const { services, variantSaving } = get();
      const current = services?.engine.snapshot.current;
      if (!services?.recordings || !current || variantSaving) return;
      set({ variantSaving: true });
      try {
        const selected = await services.recordings.select(current, variant.track);
        // Saving a preference must not replace a song selected while SQLite was busy.
        if (get().services === services && services.engine.snapshot.current === current) {
          services.engine.playVariant(selected, true);
        }
        await Promise.all([get().refreshLibrary(), get().loadPlaylists()]);
        get().notify(t("player").sourceRemembered);
      } catch (error) {
        get().notify(error instanceof Error ? error.message : String(error));
      } finally {
        set({ variantSaving: false });
      }
    },
  };
};
