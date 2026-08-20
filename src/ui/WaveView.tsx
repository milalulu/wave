import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { WaveAppIconBadge } from "./WaveLogo";

export function WaveView() {
  const { t } = useI18n();
  const startWave = useApp((s) => s.startWave);
  const likedIds = useApp((s) => s.likedIds);
  const services = useApp((s) => s.services);

  return (
    <div className="view wave-view">
      <div className="wave-hero">
        <WaveAppIconBadge size={80} />
        <h2>{t("wave").title}</h2>
        <p>{t("wave").empty}</p>
        <div className="wave-stats">
          <span>{t("library").liked}: {likedIds.size}</span>
          <span>{t("common").open}: {services?.providers.map((p) => p.name).join(", ") ?? "—"}</span>
        </div>
        <button className="btn btn-primary btn-lg" onClick={() => void startWave()}>
          {t("wave").start}
        </button>
        <p className="muted">
          {t("wave").hint}
        </p>
      </div>
    </div>
  );
}
