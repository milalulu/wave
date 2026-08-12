import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { WaveIcon } from "./icons";

export function WaveView() {
  const { t } = useI18n();
  const startWave = useApp((s) => s.startWave);
  const likedIds = useApp((s) => s.likedIds);
  const services = useApp((s) => s.services);

  return (
    <div className="view wave-view">
      <div className="wave-hero">
        <WaveIcon size={64} />
        <h2>{t("wave").title}</h2>
        <p>{t("wave").empty.replace("пуст", "построенная на ваших лайках, истории и любимых жанрах")}</p>
        <div className="wave-stats">
          <span>{t("library").liked}: {likedIds.length}</span>
          <span>{t("common").open}: {services?.providers.map((p) => p.name).join(", ") ?? "—"}</span>
        </div>
        <button className="btn btn-primary btn-lg" onClick={() => void startWave()}>
          <WaveIcon size={20} />
          {t("wave").start}
        </button>
        <p className="muted">
          {t("wave").empty.replace("пуст", "Каждый запуск — свежая подборка: лайки и часто слушаемые жанры получают больший вес")}
        </p>
      </div>
    </div>
  );
}
