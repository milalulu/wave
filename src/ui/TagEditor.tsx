import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Track } from "../core/types";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { usePopoverDismiss } from "./usePopoverDismiss";

interface TagEditorProps {
  track: Track;
  onClose: () => void;
}

interface AudioTags {
  title: string;
  artist: string;
  album: string;
  genre: string;
  year: number | null;
  trackNumber: number | null;
  cover?: string;
}

export function TagEditor({ track, onClose }: TagEditorProps) {
  const { t } = useI18n();
  const updateLocalTrack = useApp((s) => s.updateLocalTrack);
  const notify = useApp((s) => s.notify);
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist ?? "");
  const [album, setAlbum] = useState(track.album ?? "");
  const [genre, setGenre] = useState(track.genre ?? "");
  const [year, setYear] = useState(track.year ? String(track.year) : "");
  const [trackNumber, setTrackNumber] = useState(
    typeof track.meta?.trackNumber === "number" ? String(track.meta.trackNumber) : "",
  );
  const [cover, setCover] = useState<string | undefined>(track.coverUrl);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const modalRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(modalRef, true, onClose);

  useEffect(() => {
    const path = track.meta?.path;
    if (typeof path !== "string") {
      setLoading(false);
      return;
    }
    void invoke<AudioTags>("read_audio_tags", { path })
      .then((tags) => {
        if (tags.title) setTitle(tags.title);
        setArtist(tags.artist);
        setAlbum(tags.album);
        setGenre(tags.genre);
        if (tags.year) setYear(String(tags.year));
        if (tags.trackNumber) setTrackNumber(String(tags.trackNumber));
        if (tags.cover) setCover(tags.cover);
      })
      .catch((e) => notify(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [track, notify]);

  const save = async (): Promise<void> => {
    const path = track.meta?.path;
    if (typeof path !== "string") return;
    setSaving(true);
    try {
      const y = year.trim() ? Number(year) : null;
      const n = trackNumber.trim() ? Number(trackNumber) : null;
      await invoke("write_audio_tags", {
        path,
        title,
        artist,
        album,
        genre,
        year: Number.isFinite(y) ? y : null,
        trackNumber: Number.isFinite(n) ? n : null,
      });
      updateLocalTrack(track.id, {
        title,
        artist,
        album,
        genre,
        year: Number.isFinite(y) && y ? y : undefined,
      });
      notify(t("toasts").tagsSaved);
      onClose();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal tag-editor" ref={modalRef} onClick={(e) => e.stopPropagation()}>
        <h3>{t("trackMenu").editTags}</h3>
        {loading && <p className="muted">{t("common").loading}</p>}
        {!loading && (
          <>
            {cover && <img className="tag-editor-cover" src={cover} alt="" />}
            <label>
              <span>{t("tagEditor").title}</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            </label>
            <label>
              <span>{t("tagEditor").artist}</span>
              <input value={artist} onChange={(e) => setArtist(e.target.value)} />
            </label>
            <label>
              <span>{t("tagEditor").album}</span>
              <input value={album} onChange={(e) => setAlbum(e.target.value)} />
            </label>
            <label>
              <span>{t("tagEditor").genre}</span>
              <input value={genre} onChange={(e) => setGenre(e.target.value)} />
            </label>
            <div className="tag-editor-row">
              <label>
                <span>{t("tagEditor").year}</span>
                <input
                  value={year}
                  onChange={(e) => setYear(e.target.value.replace(/[^\d]/g, ""))}
                  inputMode="numeric"
                  maxLength={4}
                />
              </label>
              <label>
                <span>{t("tagEditor").trackNumber}</span>
                <input
                  value={trackNumber}
                  onChange={(e) => setTrackNumber(e.target.value.replace(/[^\d]/g, ""))}
                  inputMode="numeric"
                  maxLength={3}
                />
              </label>
            </div>
          </>
        )}
        <div className="modal-actions">
          <button
            className="btn btn-primary"
            onClick={() => void save()}
            disabled={saving || loading}
          >
            {t("trackMenu").save}
          </button>
          <button className="btn secondary" onClick={onClose}>
            {t("trackMenu").cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
