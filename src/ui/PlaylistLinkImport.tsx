import { useEffect, useId, useRef, useState } from "react";
import { useApp } from "../app/stores";
import { detectPlaylistLink, previewPlaylistImport, type PlaylistImportReport } from "../core/import/playlistLink";
import { useI18n } from "./I18nContext";
import { UploadIcon } from "./icons";

export function PlaylistLinkImport({ onImported }: { onImported?: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="btn" onClick={() => setOpen(true)}>
      <UploadIcon size={18} /> {t("playlist").importLink}
    </button>
    {open && <PlaylistLinkDialog close={() => setOpen(false)} onImported={onImported} />}
  </>;
}

function PlaylistLinkDialog({ close, onImported }: { close: () => void; onImported?: () => void }) {
  const { t, tf, locale } = useI18n();
  const notify = useApp((state) => state.notify);
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const id = useId();
  const [url, setUrl] = useState("");
  const desktopOnly = /Android/i.test(navigator.userAgent) && detectPlaylistLink(url)?.kind === "youtube-playlist";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<PlaylistImportReport | null>(null);
  const [keepRepeats, setKeepRepeats] = useState(true);
  const ru = locale === "ru";

  useEffect(() => {
    const element = dialog.current;
    if (element?.showModal && !element.open) element.showModal();
    else if (element) element.open = true;
    return () => {
      request.current?.abort();
      element?.close?.();
    };
  }, []);

  async function submit() {
    if (!url.trim() || request.current || desktopOnly) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const state = useApp.getState();
      if (!state.services) throw new Error(t("common").loading);
      if (!report) {
        const preview = await previewPlaylistImport(state.services, url.trim());
        if (!controller.signal.aborted) setReport(preview);
        return;
      }
      const tracks = keepRepeats ? report.tracks : [...new Map(report.tracks.map((track) => [track.id, track])).values()];
      if (tracks.length === 0) return;
      const playlist = await state.createPlaylist(report.name, tracks, controller.signal);
      if (controller.signal.aborted) return;
      if (!playlist) throw new Error(ru ? "Не удалось сохранить плейлист" : "Could not save the playlist");
      state.setSelectedPlaylist(playlist.id);
      notify(tf("toasts").importSuccess(tracks.length));
      close();
      onImported?.();
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <dialog className="modal playlist-link-dialog" ref={dialog} aria-labelledby={id}
    onCancel={(event) => { event.preventDefault(); close(); }}>
    <form aria-busy={busy} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <h3 id={id}>{t("playlist").importLink}</h3>
      <p id={`${id}-help`} className="muted">{ru
        ? "Вставь ссылку на трек, плейлист или публичные лайки SoundCloud (/likes, до 1 000 треков)."
        : "Paste a track, playlist, or public SoundCloud likes link (/likes, up to 1,000 tracks)."}</p>
      <input type="url" required autoFocus aria-label={ru ? "Ссылка на музыку" : "Music link"} aria-describedby={`${id}-help`}
        placeholder={t("playlist").linkPlaceholder} disabled={busy} value={url} onChange={(event) => {
          setUrl(event.target.value);
          setReport(null);
        }} />
      {report && <div role="status">
        <p><strong>{report.name}</strong></p>
        <p>{ru ? "Готово к переносу" : "Ready to import"} · {report.tracks.length}</p>
        {report.unavailable > 0 && <p>{ru ? "Недоступно" : "Unavailable"} · {report.unavailable}</p>}
        {report.repeats > 0 && <label><input type="checkbox" checked={keepRepeats} onChange={(event) => setKeepRepeats(event.target.checked)} />
          {ru ? "Сохранить повторы списка" : "Keep repeats in the playlist"} · {report.repeats}</label>}
      </div>}
      {error && <p className="playlist-link-error" role="alert">{error}</p>}
      {desktopOnly && <p className="muted" role="status">{ru ? "Плейлисты YouTube Music можно импортировать в настольной версии." : "YouTube Music playlist import is available on desktop."}</p>}
      <div className="modal-actions">
        <button className="btn" type="submit" disabled={busy || desktopOnly || !url.trim() || report?.tracks.length === 0}>
          {busy ? t("common").loading : report ? t("playlist").import : ru ? "Проверить ссылку" : "Preview import"}
        </button>
        <button className="btn secondary" type="button" onClick={close}>{t("common").cancel}</button>
      </div>
    </form>
  </dialog>;
}
