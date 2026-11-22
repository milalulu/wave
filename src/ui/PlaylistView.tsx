import { useState, useEffect, useMemo, useRef } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { usePopoverDismiss } from "./usePopoverDismiss";
import { TrackRow } from "./TrackRow";
import { VirtualList } from "./VirtualList";
import { Cover } from "./Cover";
import { ConfirmDialog } from "./ConfirmDialog";
import { PlaylistLinkImport } from "./PlaylistLinkImport";
import { OfflineCollectionStatus } from "./OfflineCollectionStatus";
import { PlayIcon, TrashIcon, DownloadIcon, UploadIcon, ShuffleIcon, ShareIcon, GridIcon, ListIcon } from "./icons";
import { tileStyle } from "./tileHue";
import { buildM3U, parseM3U } from "../core/library/m3u";
import { distinctCovers, groupPlaylistsByFolder } from "../core/library/playlistGroups";
import { shuffleArray } from "../core/util/shuffle";
import type { Playlist, Track } from "../core/types";
import { makePlaylistImportReport, type PlaylistImportReport } from "../core/import/playlistLink";

function parseJSON(text: string): Track[] | null {
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data.tracks)) return data.tracks as Track[];
    if (Array.isArray(data)) return data as Track[];
  } catch {
    
  }
  return null;
}

export function PlaylistView() {
  const { t, tf, locale } = useI18n();
  const playlists = useApp((s) => s.playlists);
  const selectedPlaylistId = useApp((s) => s.selectedPlaylistId);
  const setSelectedPlaylist = useApp((s) => s.setSelectedPlaylist);
  const createPlaylist = useApp((s) => s.createPlaylist);
  const deletePlaylist = useApp((s) => s.deletePlaylist);
  const dedupePlaylist = useApp((s) => s.dedupePlaylist);
  const reorderPlaylist = useApp((s) => s.reorderPlaylist);
  const play = useApp((s) => s.play);
  const downloadTracks = useApp((s) => s.downloadTracks);
  const notify = useApp((s) => s.notify);
  const currentId = useApp((s) => s.snapshot.current?.id ?? null);

  const [showCreate, setShowCreate] = useState(false);
  const [importReport, setImportReport] = useState<PlaylistImportReport | null>(null);
  const [newName, setNewName] = useState("");
  const [selectedTracks, setSelectedTracks] = useState<Track[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Playlist | null>(null);
  const [gridView, setGridView] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [sharePermission, setSharePermission] = useState<"editor" | "viewer">("editor");
  const [shareLoading, setShareLoading] = useState(false);
  const createModalRef = useRef<HTMLDivElement>(null);
  const shareModalRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(createModalRef, showCreate, () => setShowCreate(false));
  usePopoverDismiss(shareModalRef, showShare, () => setShowShare(false));
  const sharePlaylist = useApp((s) => s.sharePlaylist);
  const unsharePlaylist = useApp((s) => s.unsharePlaylist);
  const playlistShares = useApp((s) => s.playlistShares);
  const loadShares = useApp((s) => s.loadShares);

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
              meta: { noPlay: true },
            })) as Track[],
          );
        }
      }
    } else {
      setSelectedTracks([]);
    }
  }, [selectedPlaylistId, playlists, t]);

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
      const base = file.split(/[\\/]/).pop() ?? "imported";
      const name = base.replace(/\.(m3u8?|json)$/i, "");
      const report = makePlaylistImportReport(name, tracks, useApp.getState().services?.recordings);
      if (!report.tracks.length) notify(t("toasts").importEmpty);
      else setImportReport(report);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    }
  };

  const handleShare = async () => {
    if (!shareEmail.trim() || !selectedPlaylistId) return;
    setShareLoading(true);
    try {
      const ok = await sharePlaylist(selectedPlaylistId, shareEmail.trim(), sharePermission);
      if (ok) {
        setShareEmail("");
        notify(t("playlist").shareSuccess);
      } else {
        notify(t("playlist").shareFailed);
      }
    } finally {
      setShareLoading(false);
    }
  };

  const handleUnshare = async (email: string) => {
    if (!selectedPlaylistId) return;
    await unsharePlaylist(selectedPlaylistId, email);
  };

  useEffect(() => {
    if (showShare && selectedPlaylistId) {
      void loadShares(selectedPlaylistId);
    }
  }, [showShare, selectedPlaylistId, loadShares]);

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
  const groups = useMemo(() => groupPlaylistsByFolder(playlists), [playlists]);
  const folderNames = useMemo(
    () => [...new Set(playlists.map((p) => p.folder?.trim()).filter((f): f is string => Boolean(f)))].sort(),
    [playlists],
  );
  const covers = useMemo(() => distinctCovers(selectedTracks), [selectedTracks]);
  const setPlaylistFolder = useApp((s) => s.setPlaylistFolder);
  const setPlaylistCover = useApp((s) => s.setPlaylistCover);

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

  const handleExternalDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    const raw = e.dataTransfer.getData("application/x-wave-track");
    if (raw && selected) {
      try {
        const track = JSON.parse(raw) as Track;
        void useApp.getState().addToPlaylist(selected.id, track);
      } catch {
        // ignore malformed payload
      }
    }
    clearDrag();
  };

  return (
    <div className="view playlist-view">
      <header className="view-header">
        <h1>{t("playlist").title}</h1>
        <div className="header-actions">
          <button className="icon-btn" onClick={() => setGridView(!gridView)} title={gridView ? t("playlist").listView : t("playlist").gridView}>
            {gridView ? <ListIcon size={16} /> : <GridIcon size={16} />}
          </button>
          <button className="btn" onClick={() => setShowCreate(true)}>
            <PlayIcon size={18} /> {t("playlist").newPlaylist}
          </button>
          <button className="btn" onClick={() => void handleImport()}>
            <UploadIcon size={18} /> {t("playlist").import}
          </button>
          <PlaylistLinkImport />
        </div>
      </header>

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" ref={createModalRef} onClick={(e) => e.stopPropagation()}>
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
          {gridView ? (
            <div className="playlist-group-blocks">
              {groups.map((g) => (
                <div key={g.folder ?? ""} className="playlist-group">
                  {g.folder && <div className="playlist-group-title">{g.folder}</div>}
                  <div className="playlist-grid">
                    {g.playlists.map((pl) => (
                      <div
                        key={pl.id}
                        className={`playlist-grid-card ${selectedPlaylistId === pl.id ? "active" : ""}`}
                        onClick={() => setSelectedPlaylist(pl.id)}
                      >
                        {pl.coverUrl ? (
                          <Cover className="playlist-grid-cover" src={pl.coverUrl} alt="" />
                        ) : (
                          <div className="playlist-grid-cover playlist-grid-cover-empty" style={tileStyle(pl.name)}>{pl.name.charAt(0)}</div>
                        )}
                        <span className="playlist-grid-name">{pl.name}</span>
                        <small>{tf("playlist").tracksCount(pl.tracks?.length ?? pl.trackIds.length)}</small>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {playlists.length === 0 && <p className="muted">{t("playlist").empty}</p>}
            </div>
          ) : (
          <ul className="playlist-list">
            {groups.map((g) => (
              <li key={g.folder ?? ""} className="playlist-group">
                {g.folder && <div className="playlist-group-title">{g.folder}</div>}
                <ul className="playlist-list">
                  {g.playlists.map((pl) => (
                    <li
                      key={pl.id}
                      className={`playlist-item ${selectedPlaylistId === pl.id ? "active" : ""}`}
                      onClick={() => setSelectedPlaylist(pl.id)}
                    >
                      {pl.coverUrl ? (
                        <Cover className="playlist-cover" src={pl.coverUrl} alt="" />
                      ) : (
                        <span className="playlist-cover playlist-cover-empty" style={tileStyle(pl.name)}>{pl.name.charAt(0)}</span>
                      )}
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
                        onClick={(e) => { e.stopPropagation(); setConfirmDelete(pl); }}
                        title={t("common").delete}
                      >
                        <TrashIcon size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            {playlists.length === 0 && <li className="muted">{t("playlist").empty}</li>}
          </ul>
          )}
        </aside>

        {selected ? (
          <section className="playlist-detail">
            <header className="detail-header">
              {selected.coverUrl && <Cover className="detail-cover" src={selected.coverUrl} alt="" />}
              <div className="detail-info"><h2>{selected.name}</h2><OfflineCollectionStatus tracks={selectedTracks} /></div>
              <div className="detail-actions">
                <button type="button" className="btn" disabled={!selectedTracks.length} onClick={async () => {
                  const count = await downloadTracks(selectedTracks);
                  if (count) notify(locale === "ru" ? `В очередь загрузок: ${count}` : `Queued downloads: ${count}`);
                }}><DownloadIcon size={16} /> {locale === "ru" ? "Скачать плейлист" : "Download playlist"}</button>
                <button className="btn btn-primary" onClick={() => play(selectedTracks)} disabled={selectedTracks.length === 0}>
                  <PlayIcon size={18} /> {t("playlist").play}
                </button>
                <button className="btn" onClick={() => { play(shuffleArray(selectedTracks)); }} disabled={selectedTracks.length === 0}>
                  <ShuffleIcon size={18} /> {t("playlist").shuffle}
                </button>
                <button className="btn" onClick={() => void exportPlaylist(selected, "m3u")}>
                  <DownloadIcon size={18} /> {t("playlist").exportM3U}
                </button>
                <button className="btn" onClick={() => void exportPlaylist(selected, "json")}>
                  <DownloadIcon size={18} /> {t("playlist").exportJSON}
                </button>
                <button className="btn" onClick={() => setShowShare(true)}>
                  <ShareIcon size={18} /> {t("playlist").share}
                </button>
                <button className="btn" onClick={() => void dedupePlaylist(selected.id)}>
                  {t("queue").dedupe}
                </button>
              </div>
              <div className="playlist-meta-row">
                <label>
                  {t("playlist").folder}
                  <input
                    value={selected.folder ?? ""}
                    list="wave-folders"
                    placeholder={t("playlist").folderPlaceholder}
                    onChange={(e) => void setPlaylistFolder(selected.id, e.target.value || null)}
                  />
                  <datalist id="wave-folders">
                    {folderNames.map((f) => (
                      <option key={f} value={f} />
                    ))}
                  </datalist>
                </label>
              </div>
              {covers.length > 0 && (
                <div className="playlist-meta-row">
                  <span>{t("playlist").cover}</span>
                  <div className="cover-pick">
                    {covers.map((c) => (
                      <button
                        key={c}
                        className={`cover-pick-item ${selected.coverUrl === c ? "active" : ""}`}
                        onClick={() => void setPlaylistCover(selected.id, c)}
                        title={c}
                      >
                        <Cover src={c} alt="" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </header>
            <div className="track-list">
              {selectedTracks.length > 0 && (
                <VirtualList
                  items={selectedTracks}
                  rowKey={(track, i) => `${track.id}:${i}`}
                  renderRow={(track, i) => (
                    <div
                      className={`playlist-dropzone ${dragOverIndex === i ? "drag-over" : ""}`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOverIndex(i);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragIndex === null && e.dataTransfer.getData("application/x-wave-track")) {
                          handleExternalDrop(e);
                        } else {
                          handleDrop(i);
                        }
                      }}
                    >
                      <TrackRow
                        track={track}
                        index={i + 1}
                        nowPlaying={selectedTracks.findIndex((tr) => tr.id === currentId) === i}
                        onDragStart={() => setDragIndex(i)}
                        onDragEnd={clearDrag}
                      />
                    </div>
                  )}
                />
              )}
              {selectedTracks.length > 0 && (
                <div
                  className={`playlist-dropzone playlist-dropzone-end ${dragOverIndex === selectedTracks.length ? "drag-over" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverIndex(selectedTracks.length);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIndex === null && e.dataTransfer.getData("application/x-wave-track")) {
                      handleExternalDrop(e);
                    } else {
                      handleDrop(selectedTracks.length);
                    }
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

      {showShare && (
        <div className="modal-overlay" onClick={() => setShowShare(false)}>
          <div className="modal" ref={shareModalRef} onClick={(e) => e.stopPropagation()}>
            <h3>{t("playlist").share}</h3>
            <div className="form-group">
              <label>{t("playlist").shareEmail}</label>
              <input
                type="email"
                value={shareEmail}
                onChange={(e) => setShareEmail(e.target.value)}
                placeholder={t("playlist").shareEmailPlaceholder}
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>{t("playlist").sharePermission}</label>
              <select value={sharePermission} onChange={(e) => setSharePermission(e.target.value as "editor" | "viewer")}>
                <option value="editor">{t("playlist").editor}</option>
                <option value="viewer">{t("playlist").viewer}</option>
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => void handleShare()} disabled={shareLoading || !shareEmail.trim()}>
                {shareLoading ? "..." : t("playlist").share}
              </button>
              <button className="btn secondary" onClick={() => setShowShare(false)}>{t("common").cancel}</button>
            </div>
            {playlistShares.length > 0 && (
              <div className="share-list">
                <h4>{t("playlist").sharedWith}</h4>
                {playlistShares.map((s) => (
                  <div key={s.id} className="share-item">
                    <span>{s.collaboratorEmail ?? s.collaboratorId}</span>
                    <small>{s.permission === "editor" ? t("playlist").editor : t("playlist").viewer}</small>
                    <button className="icon-btn danger" onClick={() => void handleUnshare(s.collaboratorEmail ?? s.collaboratorId)}>
                      <TrashIcon size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {importReport && <ConfirmDialog
        message={locale === "ru"
          ? `«${importReport.name}» · к переносу ${importReport.tracks.length} · недоступно ${importReport.unavailable} · повторов ${importReport.repeats}`
          : `“${importReport.name}” · ready ${importReport.tracks.length} · unavailable ${importReport.unavailable} · repeats ${importReport.repeats}`}
        confirmLabel={t("playlist").import}
        onCancel={() => setImportReport(null)}
        onConfirm={() => {
          const report = importReport;
          setImportReport(null);
          void createPlaylist(report.name, report.tracks).then((playlist) => {
            if (!playlist) throw new Error(t("common").unknown);
            setSelectedPlaylist(playlist.id);
            notify(tf("toasts").importSuccess(report.tracks.length));
          }).catch((error: unknown) => notify(error instanceof Error ? error.message : String(error)));
        }}
      />}
      {confirmDelete && (
        <ConfirmDialog
          message={confirmDelete.name ? `${t("common").delete} "${confirmDelete.name}"?` : t("common").delete + "?"}
          onConfirm={() => { deletePlaylist(confirmDelete.id); if (selectedPlaylistId === confirmDelete.id) setSelectedPlaylist(null); setConfirmDelete(null); }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
