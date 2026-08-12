import { useEffect, useState } from "react";
import { useApp } from "./app/stores";
import { Sidebar, type ViewKey } from "./ui/Sidebar";
import { PlayerBar } from "./ui/PlayerBar";
import { HomeView } from "./ui/HomeView";
import { SearchView } from "./ui/SearchView";
import { LibraryView } from "./ui/LibraryView";
import { QueueView } from "./ui/QueueView";
import { WaveView } from "./ui/WaveView";
import { AlbumDetailView } from "./ui/AlbumDetailView";
import { ArtistDetailView } from "./ui/ArtistDetailView";
import { PlaylistView } from "./ui/PlaylistView";
import { SettingsView } from "./ui/SettingsView";
import { Toasts } from "./ui/Toasts";

function App() {
  const ready = useApp((s) => s.ready);
  const init = useApp((s) => s.init);
  const [view, setView] = useState<ViewKey>("home");
  const [query, setQuery] = useState("");

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const inInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement;

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
        } else if (e.code === "KeyS") {
          e.preventDefault();
          state.toggleShuffle();
        }
        return;
      }

      if (!inInput) {
        const state = useApp.getState();
        if (e.code === "KeyM") {
          state.setVolume(state.snapshot.volume === 0 ? 100 : 0);
        } else if (e.code === "KeyL") {
          void state.toggleLike();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!ready) {
    return <div className="splash">Wave</div>;
  }

  return (
    <div className="app">
      <Sidebar view={view} onView={setView} />
      <main className="content">
        {view === "home" && <HomeView />}
        {view === "search" && <SearchView query={query} onQuery={setQuery} />}
        {view === "library" && <LibraryView />}
        {view === "queue" && <QueueView />}
        {view === "wave" && <WaveView />}
        {view === "album" && <AlbumDetailView />}
        {view === "artist" && <ArtistDetailView />}
        {view === "playlist" && <PlaylistView />}
        {view === "settings" && <SettingsView />}
      </main>
      <PlayerBar onOpenQueue={() => setView("queue")} />
      <Toasts />
    </div>
  );
}

export default App;
