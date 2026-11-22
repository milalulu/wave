import type { ReactNode } from "react";

const shapes: Record<string, ReactNode> = {
  home: <><path d="m3.5 10 7-6a2.3 2.3 0 0 1 3 0l7 6M5.5 8.5v10a2 2 0 0 0 2 2h3v-6h3v6h3a2 2 0 0 0 2-2v-10" /></>,
  nowPlaying: <><rect x="3" y="3" width="18" height="18" rx="6"/><path d="m10 8 6 4-6 4Z" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.8"/><path d="m15.5 15.5 5 5"/></>,
  library: <><path d="m3 8 9-5 9 5-9 5Zm0 5 9 5 9-5M3 18l9 5 9-5" transform="translate(0 -1)"/></>,
  wave: <><path d="M9 9a4.5 4.5 0 0 0 0 6m6-6a4.5 4.5 0 0 1 0 6M5.5 5.5a9 9 0 0 0 0 13m13-13a9 9 0 0 1 0 13"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/></>,
  wrapped: <><path d="M4 19V12m4 7V6m4 13V3m4 16V9m4 10V5"/></>,
  playlist: <><path d="M5 5h10M5 10h8M5 15h5m8-7v10"/><ellipse cx="15" cy="18" rx="3" ry="2.5"/><path d="m18 8 3 1"/></>,
  downloads: <><path d="M12 3v12m-4-4 4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></>,
  settings: <><path d="M4 7h7m5 0h4M4 17h3m5 0h8"/><circle cx="13.5" cy="7" r="2.5"/><circle cx="9.5" cy="17" r="2.5"/></>,
  queue: <><path d="M4 5h16M4 10h12M4 15h7m4 0 5 3-5 3Z"/></>,
  agent: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/></>,
  folder: <><path d="M3 8V6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Zm0 2h18"/></>,
};

export function SidebarIcon({name, size = 24}: {name: string; size?: number}) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.65} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name] ?? shapes.home}</svg>;
}
