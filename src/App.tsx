import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { onBackButtonPress } from "@tauri-apps/api/app";
import { useApp } from "./app/stores";
import { Sidebar } from "./ui/Sidebar";
import { PlayerBar } from "./ui/PlayerBar";
import { Toasts } from "./ui/Toasts";
import { useEdgeSwipeBack } from "./ui/gestures";
import {
  BottomNav,
  MobilePlayerBar,
  MobileTopBar,
  isTabView,
} from "./ui/MobileNav";
import type { ViewKey } from "./ui/Sidebar";

const HomeView = lazy(() => import("./ui/HomeView").then((m) => ({ default: m.HomeView })));
const NowPlayingView = lazy(() =>
  import("./ui/NowPlayingView").then((m) => ({ default: m.NowPlayingView })),
);
const SearchView = lazy(() => import("./ui/SearchView").then((m) => ({ default: m.SearchView })));
const LibraryView = lazy(() =>
  import("./ui/LibraryView").then((m) => ({ default: m.LibraryView })),
);
const QueueView = lazy(() => import("./ui/QueueView").then((m) => ({ default: m.QueueView })));
const WaveView = lazy(() => import("./ui/WaveView").then((m) => ({ default: m.WaveView })));
const AlbumDetailView = lazy(() =>
  import("./ui/AlbumDetailView").then((m) => ({ default: m.AlbumDetailView })),
);
const ArtistDetailView = lazy(() =>
  import("./ui/ArtistDetailView").then((m) => ({ default: m.ArtistDetailView })),
);
const PlaylistView = lazy(() =>
  import("./ui/PlaylistView").then((m) => ({ default: m.PlaylistView })),
);
const DownloadsView = lazy(() =>
  import("./ui/DownloadsView").then((m) => ({ default: m.DownloadsView })),
);
const SettingsView = lazy(() =>
  import("./ui/SettingsView").then((m) => ({ default: m.SettingsView })),
);
const OnboardingView = lazy(() =>
  import("./ui/OnboardingView").then((m) => ({ default: m.OnboardingView })),
);

function App() {
  const ready = useApp((s) => s.ready);
  const init = useApp((s) => s.init);
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const navStack = useApp((s) => s.navStack);
  const goBack = useApp((s) => s.goBack);
  const onboardingCompleted = useApp((s) => s.onboardingCompleted);
  const [query, setQuery] = useState("");
  const [focusToken, setFocusToken] = useState(0);
  const contentRef = useRef<HTMLElement>(null);
  const scrollMemory = useRef(new Map<string, number>());
  const prevViewRef = useRef<ViewKey | null>(null);

  
  
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const memory = scrollMemory.current;
    const prev = prevViewRef.current;
    if (prev) memory.set(prev, el.scrollTop);
    prevViewRef.current = view;
    const saved = memory.get(view);
    if (saved !== undefined) el.scrollTop = saved;
  }, [view]);

  useEffect(() => {
    void init();
  }, [init]);

  
  const goBackRef = useRef(goBack);
  useEffect(() => {
    goBackRef.current = goBack;
  });
  useEdgeSwipeBack(() => goBackRef.current());

  
  
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void onBackButtonPress(() => {
      const state = useApp.getState();
      if (isTabView(state.view)) {
        void getCurrentWindow().close();
      } else {
        goBackRef.current();
      }
    })
      .then((listener) => {
        unlisten = listener.unregister;
      })
      .catch(() => {});
    return () => {
      unlisten?.();
    };
  }, []);

  
  
  
  const handleNowPlayingNavigate = (target: ViewKey) => {
    if (target === "home") goBack();
    else setView(target);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const inInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement;

      if ((e.ctrlKey || e.metaKey) && e.code === "KeyK") {
        e.preventDefault();
        setView("search");
        setFocusToken((n) => n + 1);
        return;
      }

      if (e.key === "/" && !inInput) {
        e.preventDefault();
        setView("search");
        setFocusToken((n) => n + 1);
        return;
      }

      if (e.code === "Space" && !inInput) {
        e.preventDefault();
        void useApp.getState().togglePlay();
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        const state = useApp.getState();
        if (e.code === "ArrowRight") {
          e.preventDefault();
          void state.next();
        } else if (e.code === "ArrowLeft") {
          e.preventDefault();
          void state.previous();
        } else if (e.code === "ArrowUp") {
          e.preventDefault();
          state.setVolume(Math.min(100, Math.round(state.snapshot.volume * 100) + 10));
        } else if (e.code === "ArrowDown") {
          e.preventDefault();
          state.setVolume(Math.max(0, Math.round(state.snapshot.volume * 100) - 10));
        } else if (!inInput && (e.code === "KeyQ" || e.code === "KeyW")) {
          e.preventDefault();
          void getCurrentWindow().close();
        }
        return;
      }

      if (!inInput) {
        const state = useApp.getState();
        if (e.code === "KeyM") {
          state.setVolume(state.snapshot.volume === 0 ? 100 : 0);
        } else if (e.code === "KeyL") {
          void state.toggleLike();
        } else if (e.code === "KeyS") {
          state.toggleShuffle();
        } else if (e.code === "ArrowRight") {
          e.preventDefault();
          void state.next();
        } else if (e.code === "ArrowLeft") {
          e.preventDefault();
          void state.previous();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setView]);

  if (!ready) {
    return <div className="splash">Wave</div>;
  }

  if (!onboardingCompleted) {
    return (
      <div className="app">
        <main className="content">
          <Suspense fallback={<div className="splash">Wave</div>}>
            <OnboardingView />
          </Suspense>
        </main>
      </div>
    );
  }

  const renderView = () => (
    <Suspense fallback={<div className="splash">Wave</div>}>
      {view === "home" && <HomeView onNavigate={setView} />}
      {view === "nowPlaying" && <NowPlayingView onNavigate={handleNowPlayingNavigate} />}
      {view === "search" && <SearchView query={query} onQuery={setQuery} focusToken={focusToken} />}
      {view === "library" && <LibraryView />}
      {view === "queue" && <QueueView />}
      {view === "wave" && <WaveView />}
      {view === "album" && <AlbumDetailView />}
      {view === "artist" && <ArtistDetailView />}
      {view === "playlist" && <PlaylistView />}
      {view === "downloads" && <DownloadsView />}
      {view === "settings" && <SettingsView />}
    </Suspense>
  );

  const contentClass = `content ${view === "nowPlaying" ? "content-nowplaying" : ""}`;

  return (
    <div className="app">
      <Sidebar view={view} onView={setView} />
      <main ref={contentRef} className={contentClass}>{renderView()}</main>
      <PlayerBar
        onOpenQueue={() => setView("queue")}
        onOpenPlayer={() => setView("nowPlaying")}
      />
      <MobileTopBar view={view} canGoBack={navStack.length > 1} onBack={goBack} />
      <MobilePlayerBar
        onOpenQueue={() => setView("queue")}
        onOpenPlayer={() => setView("nowPlaying")}
      />
      <BottomNav view={view} onView={setView} />
      <Toasts />
    </div>
  );
}

export default App;
