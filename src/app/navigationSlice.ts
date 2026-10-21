import type { StateCreator } from "zustand";
import type { AlbumDetail, ArtistDetail } from "../core/types";
import type { AppState } from "./stores";

export interface NavigationSlice {
  view: "home" | "nowPlaying" | "search" | "library" | "queue" | "wave" | "album" | "artist" | "artistRadio" | "playlist" | "settings" | "downloads" | "wrapped";
  navStack: NavigationSlice["view"][];
  setView: (view: NavigationSlice["view"]) => void;
  goBack: () => void;
  albumDetail: AlbumDetail | null;
  artistDetail: ArtistDetail | null;
  loadAlbum: (providerId: string, albumId: string) => Promise<void>;
  loadArtist: (providerId: string, artistId: string) => Promise<void>;
  clearDetail: () => void;
}

const tabs = new Set<NavigationSlice["view"]>(["home", "search", "wave", "library", "settings"]);

export const createNavigationSlice: StateCreator<AppState, [], [], NavigationSlice> = (set, get) => {
  // One generation spans both detail types and explicit navigation: a late
  // album response must not pull the user away from an artist or another tab.
  let generation = 0;
  const loadDetail = async (kind: "album" | "artist", providerId: string, id: string) => {
    const request = ++generation;
    const services = get().services;
    const provider = services?.providers.find((p) => p.id === providerId);
    if (!services || !provider) return;
    const current = () => request === generation && get().services === services
      && services.providers.find((p) => p.id === providerId) === provider;
    try {
      if (kind === "album") {
        const detail = await provider.getAlbum(id);
        if (!current()) return;
        set({ albumDetail: detail });
        services.prewarmer?.prewarm(detail.tracks);
      } else {
        const detail = await provider.getArtist(id);
        if (!current()) return;
        set({ artistDetail: detail });
        services.prewarmer?.prewarm(detail.topTracks);
      }
      get().setView(kind);
    } catch (e) {
      if (current()) get().notify(e instanceof Error ? e.message : String(e));
    }
  };
  return {
    view: "home",
    navStack: ["home"],
    albumDetail: null,
    artistDetail: null,
    setView: (view) => {
      generation++;
      set((s) => s.view === view ? s : {
        view,
        navStack: tabs.has(view) ? [view]
          : s.navStack[s.navStack.length - 1] === view ? s.navStack : [...s.navStack, view],
      });
    },
    goBack: () => {
      generation++;
      set((s) => {
        if (s.navStack.length <= 1) return s;
        const navStack = s.navStack.slice(0, -1);
        return {
          view: navStack[navStack.length - 1], navStack,
          ...(s.view === "album" ? { albumDetail: null } : {}),
          ...(s.view === "artist" ? { artistDetail: null } : {}),
        };
      });
    },
    loadAlbum: (provider, id) => loadDetail("album", provider, id),
    loadArtist: (provider, id) => loadDetail("artist", provider, id),
    clearDetail: () => {
      generation++;
      set({ albumDetail: null, artistDetail: null });
    },
  };
};
