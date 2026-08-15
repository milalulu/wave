import { useState, useEffect } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { TrackRow } from "./TrackRow";
import { PlayIcon, TrashIcon, DownloadIcon, UploadIcon, ShuffleIcon } from "./icons";
import { buildM3U, parseM3U } from "../core/library/m3u";
import type { Playlist, Track } from "../core/types";

function parseJSON(text: string): Track[] | null {
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data.tracks)) return data.tracks as Track[];
    if (Array.isArray(data)) return data as Track[];
  } catch {}
  return null;
}

export function PlaylistView() {
  const { t, tf } = useI18n();
  const playlists = useApp((s) => s.playlists);
  const selectedPlaylistId = useApp((s) => s.selectedPlaylistId);
  const setSelectedPlaylist = useApp((s) => s.setSelectedPlaylist);
  const createPlaylist = useApp((s) => s.createPlaylist);
  const deletePlaylist = useApp((s) => s.deletePlaylist);
  const reorderPlaylist = useApp((s) => s.reorderPlaylist);
  const play = useApp((s) => s.play);
  const notify = useApp((s) => s.notify);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [selectedTracks, setSelectedTracks] = useState<Track[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  useEffect(() => {
    if (selectedPlaylistId) {
      const pl = playlists.find((p) => p.id === selectedPlaylistId);
      if (pl) {
        if (pl.tracks && pl.tracks.length > 0) {
          setSelectedTracks(pl.tracks);
        } else {
          setSelectedTracks(
            pl.trackIds.map((id, i) => ({
              id,
              provider: "local",
              uri: "",
              title: `${t("common").unknown} ${i + 1}`,
            })) as Track[],
          );
        }
      }
    } else {
      setSelectedTracks([]);
    }
  }, [selectedPlaylistId, playlists]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createPlaylist(newName.trim());
    setNewName("");
    setShowCreate(false);
  };

  const handleImport = async () => {
    const file = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Playlists", extensions: ["m3u", "m3u8", "json"] }],
    });
    if (!file || typeof file !== "string") return;
    try {
      const text = await invoke<string>("read_text_file", { path: file });
      let tracks: Track[] | null = null;
      if (file.toLowerCase().endsWith(".json")) {
        tracks = parseJSON(text);
      } else {
        tracks = parseM3U(text, convertFileSrc);
      }
      if (!tracks || tracks.length === 0) {
        notify(t("toasts").importEmpty);
        return;
      }
      const base = file.split("/").pop() ?? "imported";
      const name = base.replace(/\.(m3u8?|json)$/i, "");
      await createPlaylist(name, tracks);
      notify(tf("toasts").importSuccess(tracks.length));
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    }
  };

  const exportPlaylist = async (playlist: Playlist, format: "m3u" | "json") => {
    const tracks = playlist.tracks ?? [];
    const defaultPath = `${playlist.name}.${format === "m3u" ? "m3u" : "json"}`;
    const path = await save({
      defaultPath,
      filters:
        format === "m3u"
          ? [{ name: "M3U", extensions: ["m3u"] }]
          : [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return;
    try {
      const content =
        format === "m3u"
          ? buildM3U(tracks)
          : JSON.stringify(
              {
                format: "wave-playlist",
                version: 1,
                name: playlist.name,
                tracks,
              },
              null,
              2,
            );
      await invoke("write_text_file", { path, content });
      notify(t("toasts").exportSuccess);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    }
  };

  const selected = playlists.find((p) => p.id === selectedPlaylistId);

  const clearDrag = (): void => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleDrop = (targetIndex: number): void => {
    if (dragIndex !== null && dragIndex !== targetIndex) {
      reorderPlaylist(selected?.id ?? "", dragIndex, targetIndex);
    }
    clearDrag();
  };

  return (
    <div className="view playlist-view">
      <header className="view-header">
        <h1>{t("playlist").title}</h1>
        <div className="header-actions">
          <button className="btn" onClick={() => setShowCreate(true)}>
            <PlayIcon size={18} /> {t("playlist").newPlaylist}
          </button>
          <button className="btn" onClick={() => void handleImport()}>
            <UploadIcon size={18} /> {t("playlist").import}
          </button>
        </div>
      </header>

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t("playlist").newPlaylist}</h3>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("playlist").namePlaceholder}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <div className="modal-actions">
              <button className="btn" onClick={handleCreate}>{t("playlist").create}</button>
              <button className="btn secondary" onClick={() => setShowCreate(false)}>{t("common").cancel}</button>
            </div>
          </div>
        </div>
      )}

      <div className="playlist-split">
        <aside className="playlist-sidebar">
          <ul className="playlist-list">
            {playlists.map((pl) => (
              <li
                key={pl.id}
                className={`playlist-item ${selectedPlaylistId === pl.id ? "active" : ""}`}
                onClick={() => setSelectedPlaylist(pl.id)}
              >
                <span>{pl.name}</span>
                <small>{tf("playlist").tracksCount(pl.tracks?.length ?? pl.trackIds.length)}</small>
                <button
                  className="icon-btn"
                  onClick={(e) => { e.stopPropagation(); void exportPlaylist(pl, "json"); }}
                  title={t("playlist").exportJSON}
                >
                  <DownloadIcon size={14} />
                </button>
                <button
                  className="icon-btn danger"
                  onClick={(e) => { e.stopPropagation(); deletePlaylist(pl.id); if (selectedPlaylistId === pl.id) setSelectedPlaylist(null); }}
                  title={t("common").delete}
                >
                  <TrashIcon size={14} />
                </button>
              </li>
            ))}
            {playlists.length === 0 && <li className="muted">{t("playlist").empty}</li>}
          </ul>
        </aside>

        {selected ? (
          <section className="playlist-detail">
            <header className="detail-header">
              <h2>{selected.name}</h2>
              <div className="detail-actions">
                <button className="btn btn-primary" onClick={() => play(selectedTracks)} disabled={selectedTracks.length === 0}>
                  <PlayIcon size={18} /> {t("playlist").play}
                </button>
                <button className="btn" onClick={() => { const shuffled = [...selectedTracks].sort(() => Math.random() - 0.5); play(shuffled); }} disabled={selectedTracks.length === 0}>
                  <ShuffleIcon size={18} /> {t("playlist").shuffle}
                </button>
                <button className="btn" onClick={() => void exportPlaylist(selected, "m3u")}>
                  <DownloadIcon size={18} /> {t("playlist").exportM3U}
                </button>
                <button className="btn" onClick={() => void exportPlaylist(selected, "json")}>
                  <DownloadIcon size={18} /> {t("playlist").exportJSON}
                </button>
              </div>
            </header>
            <div className="track-list">
              {selectedTracks.map((track, i) => (
                <div
                  key={track.id}
                  className={`playlist-dropzone ${dragOverIndex === i ? "drag-over" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverIndex(i);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDrop(i);
                  }}
                >
                  <TrackRow
                    track={track}
                    index={i + 1}
                    onDragStart={() => setDragIndex(i)}
                    onDragEnd={clearDrag}
                  />
                </div>
              ))}
              {selectedTracks.length > 0 && (
                <div
                  className={`playlist-dropzone playlist-dropzone-end ${dragOverIndex === selectedTracks.length ? "drag-over" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverIndex(selectedTracks.length);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDrop(selectedTracks.length);
                  }}
                >
                  <span className="muted">{t("playlist").dropHere}</span>
                </div>
              )}
              {selectedTracks.length === 0 && <p className="muted">{t("playlist").emptyHint}</p>}
            </div>
          </section>
        ) : (
          <section className="playlist-empty">
            <p className="muted">{t("playlist").emptyHint}</p>
          </section>
        )}
      </div>
    </div>
  );
}
