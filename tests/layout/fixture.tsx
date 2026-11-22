// Isolated visual-test entry point. Never imported by the application.
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from '../../src/ui/AppShell';
import { EchoesHome } from '../../src/ui/EchoesHome';
import { Sidebar } from '../../src/ui/Sidebar';
import { PlayerBar } from '../../src/ui/PlayerBar';
import { LibraryView } from '../../src/ui/LibraryView';
import { I18nProvider } from '../../src/ui/I18nContext';
import { useApp } from '../../src/app/stores';
import '../../src/styles.css';
import '../../src/design/components.css';
import '../../src/echoes-shell.css';
import { SearchView } from "../../src/ui/SearchView";
import { QueueView } from "../../src/ui/QueueView";
import { PlaylistView } from "../../src/ui/PlaylistView";
import { AlbumDetailView } from "../../src/ui/AlbumDetailView";
import { ArtistDetailView } from "../../src/ui/ArtistDetailView";
import { ArtistRadioView } from "../../src/ui/ArtistRadioView";
import { DownloadsView } from "../../src/ui/DownloadsView";
import { WaveView } from "../../src/ui/WaveView";
import { WrappedView } from "../../src/ui/WrappedView";
import { NowPlayingView } from "../../src/ui/NowPlayingView";
import { SettingsView } from "../../src/ui/SettingsView";
import { DiagnosticsView } from "../../src/ui/DiagnosticsView";
import { AgentView } from "../../src/ui/AgentView";
import { AuthProvider } from "../../src/ui/AuthContext";
import { setCachedResults } from "../../src/app/searchCache";
import {BottomNav,MobilePlayerBar,MobileTopBar} from "../../src/ui/MobileNav";
const requestedView = new URLSearchParams(location.search).get("view");
const scenario = new URLSearchParams(location.search).get('scenario');
const trackCount = new URLSearchParams(location.search).get("tracks") === "10000" ? 10000 : 1000;
const tracks = Array.from({length: trackCount}, (_, i) => ({
  id: `layout-${i}`, provider: 'local', uri: '',
  title: scenario === 'long' ? 'Очень длинное название композиции — Extended Anniversary Edition / Необыкновенная история возвращения домой' : `Echoes ${i + 1}`,
  artist: scenario === 'long' ? 'Очень длинное имя исполнителя / Lumen featuring Another Artist' : 'Lumen',
  duration: 267, coverUrl: scenario === 'missing' ? undefined : '/src/assets/echoes-cover.png',
}));
const initial = useApp.getState();
useApp.setState({ snapshot: {...initial.snapshot, current: scenario === 'empty' ? null : tracks[0], queue: scenario === 'empty' ? [] : tracks, queueIndex: 0, state: 'paused'}, localTracks: tracks, compactPlayer: false });
const album = {id:'album-test',provider:'local',title: tracks[0].title,artist:'Lumen',coverUrl:tracks[0].coverUrl,year:2026};
useApp.setState({albumDetail:{album,tracks:tracks.slice(0,20)},artistDetail:{artist:{id:'artist-test',provider:'local',name:tracks[0].artist,coverUrl:tracks[0].coverUrl},topTracks:tracks.slice(0,10),albums:[album]},playlists:[{id:'pl-test',name:'Evening / Вечерняя коллекция',tracks:tracks.slice(0,40),trackIds:tracks.slice(0,40).map(t=>t.id),createdAt:1,updatedAt:1}],selectedPlaylistId:'pl-test'});
setCachedResults('Echoes:', [{provider:'local',tracks:tracks.slice(0,30),albums:[album],artists:[{id:'artist-test',provider:'local',name:'Lumen',coverUrl:tracks[0].coverUrl}]}]);
if (requestedView === 'downloads' && scenario !== 'empty') useApp.setState({downloads:[{id:'download-test',track:tracks[0],status:'running',percent:42,dir:''},{id:'download-error',track:tracks[1],status:'error',error:'Source temporarily unavailable / Источник временно недоступен',dir:''}]});
if (scenario === "lyrics-timing") {
  const params = new URLSearchParams(location.search);
  const section = Number(params.get("section")) || 0;
  const timestamp = section * 32;
  const moment = Number(params.get("moment")) || 3.4;
  const weather = params.get("motif") === "weather";
  useApp.setState({ lyricsOpen: true, position: timestamp + moment, duration: 12 + timestamp, lyrics: {
    trackId: tracks[0].id, title: "Test", synced: true, instrumental: false, source: "local",
    lines: [
      ...Array.from({ length: section * 8 }, (_, index) => ({ text: "I still love the rain", time: index * 4 })),
      weather ? { text: "Дождь и пламя", time: timestamp + 1, words: [
        { text: "Дождь ", time: timestamp + 3, end: timestamp + 3.7 },
        { text: "и ", time: timestamp + 3.35, end: timestamp + 3.5 },
        { text: "пламя", time: timestamp + 3.5, end: timestamp + 5 },
      ] } : { text: "I still love the rain", time: timestamp + 1, words: [
        { text: "I still ", time: timestamp + 1, end: timestamp + 1.8 },
        { text: "love ", time: timestamp + 3, end: timestamp + 3.8 },
        { text: "the ", time: timestamp + 4, end: timestamp + 4.2 },
        { text: "rain", time: timestamp + 4.2, end: timestamp + 5 },
      ] },
      { text: "The light comes back", time: timestamp + 7 },
    ],
  } });
}
if (scenario === "lyrics-reactions") {
  const params = new URLSearchParams(location.search);
  const word = params.get("word") || "люблю";
  const occurrence = Math.min(6, Math.max(1, Number(params.get("occurrence")) || 1));
  const time = occurrence * 6;
  const text = `Я хочу, чтобы ты услышал меня: ${word}, как прежде и навсегда`;
  useApp.setState({ lyricsOpen: true, position: time + 2.35, duration: time + 12, lyrics: {
    trackId: tracks[0].id, title: "Lyrics reaction sample", synced: true, instrumental: false, source: "local",
    lines: [
      { text: "Останься рядом ещё немного", time: 0 },
      ...Array.from({ length: occurrence - 1 }, (_, index) => ({ text, time: (index + 1) * 6 })),
      { text, time, words: [
        { text: "Я хочу, чтобы ты услышал меня: ", time, end: time + 2 },
        { text: word, time: time + 2, end: time + 3 },
        { text: ", как прежде и навсегда", time: time + 3, end: time + 5 },
      ] },
      { text: "Всё будет как раньше", time: time + 6 },
    ],
  } });
  window.addEventListener("lyrics-reaction-time", (event) => {
    useApp.setState({ position: time + 2 + (event as CustomEvent<number>).detail });
  });
}
function Fixture() {
 const ref = useRef<HTMLElement>(null);
 const [view,setView] = useState((requestedView || (scenario === 'library' ? 'library' : 'home')) as import('../../src/ui/Sidebar').ViewKey);
 const screens: Record<string, React.ReactNode> = {search:<SearchView query={scenario === "empty" ? "" : "Echoes"} onQuery={()=>{}} />,queue:<QueueView />,playlist:<PlaylistView />,album:<AlbumDetailView />,artist:<ArtistDetailView />,artistRadio:<ArtistRadioView />,downloads:<DownloadsView />,wave:<WaveView />,wrapped:<WrappedView />,nowPlaying:<NowPlayingView onNavigate={setView} />,settings:<SettingsView />,diagnostics:<DiagnosticsView />,agent:<AgentView />,library:<LibraryView />};
 return <I18nProvider><AuthProvider><AppShell view={view} contentRef={ref} navigation={<Sidebar view={view} onView={() => {}} />} player={<PlayerBar onOpenQueue={() => setView("queue")} onOpenPlayer={() => setView("nowPlaying")} onOpenLyrics={() => setView("nowPlaying")} />} mobile={<><MobileTopBar view={view} canGoBack={view !== 'home'} onBack={()=>setView('home')} /><MobilePlayerBar onOpenPlayer={()=>setView('nowPlaying')} onOpenQueue={()=>setView('queue')} /><BottomNav view={view} onView={setView} /></>} notices={null}>{screens[view] || <EchoesHome onNavigate={setView} />}</AppShell></AuthProvider></I18nProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);

import "../../src/design/art-direction.css";

import "../../src/design/screens.css";
import "../../src/design/polish.css";
