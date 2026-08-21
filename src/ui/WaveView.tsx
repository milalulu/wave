import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { WaveIcon, HeartIcon, ShuffleIcon, ChartIcon } from "./icons";

export function WaveView() {
  const { t } = useI18n();
  const startWave = useApp((s) => s.startWave);
  const likedIds = useApp((s) => s.likedIds);
  const services = useApp((s) => s.services);
  const discoveryRate = useApp((s) => s.discoveryRate);
  const setDiscoveryRate = useApp((s) => s.setDiscoveryRate);
  const historyDecayDays = useApp((s) => s.historyDecayDays);
  const setHistoryDecayDays = useApp((s) => s.setHistoryDecayDays);

  const providerNames = services?.providers.map((p) => p.name).join(", ") ?? "\u2014";

  return (
    <div className="view wave-view">
      <div className="wave-hero">
        <div className="wave-hero-bg">
          <div className="wave-hero-orb wave-hero-orb-1" />
          <div className="wave-hero-orb wave-hero-orb-2" />
          <div className="wave-hero-orb wave-hero-orb-3" />
          <svg className="wave-hero-svg" viewBox="0 0 1200 200" preserveAspectRatio="none">
            <path className="wave-hero-path wave-hero-path-1" d="M0,100 C200,150 400,50 600,100 C800,150 1000,50 1200,100 L1200,200 L0,200Z" />
            <path className="wave-hero-path wave-hero-path-2" d="M0,120 C300,80 500,160 700,110 C900,60 1100,140 1200,120 L1200,200 L0,200Z" />
            <path className="wave-hero-path wave-hero-path-3" d="M0,140 C150,110 350,170 600,130 C850,90 1050,160 1200,140 L1200,200 L0,200Z" />
          </svg>
        </div>
        <div className="wave-hero-inner">
          <div className="wave-hero-icon">
            <WaveIcon size={40} />
          </div>
          <h1 className="wave-hero-title">{t("wave").title}</h1>
          <p className="wave-hero-desc">{t("wave").empty}</p>
          <button
            className="btn btn-primary btn-lg wave-start-btn"
            onClick={() => void startWave()}
          >
            <WaveIcon size={20} />
            {t("wave").start}
          </button>
          <p className="wave-hero-hint">{t("wave").hint}</p>
        </div>
      </div>

      <div className="wave-stats-grid">
        <div className="wave-stat-card">
          <div className="wave-stat-icon wave-stat-icon-heart">
            <HeartIcon size={20} filled />
          </div>
          <div className="wave-stat-value">{likedIds.size}</div>
          <div className="wave-stat-label">{t("library").liked}</div>
        </div>
        <div className="wave-stat-card">
          <div className="wave-stat-icon wave-stat-icon-discovery">
            <ShuffleIcon size={20} />
          </div>
          <div className="wave-stat-value">{discoveryRate}%</div>
          <div className="wave-stat-label">{t("settings").discoveryRate}</div>
        </div>
        <div className="wave-stat-card">
          <div className="wave-stat-icon wave-stat-icon-decay">
            <ChartIcon size={20} />
          </div>
          <div className="wave-stat-value">{historyDecayDays}d</div>
          <div className="wave-stat-label">{t("settings").historyDecay}</div>
        </div>
        <div className="wave-stat-card">
          <div className="wave-stat-icon wave-stat-icon-sources">
            <WaveIcon size={20} />
          </div>
          <div className="wave-stat-value wave-stat-value-sm">{providerNames}</div>
          <div className="wave-stat-label">{t("nav").search}</div>
        </div>
      </div>

      <div className="wave-controls">
        <div className="wave-control-card">
          <div className="wave-control-header">
            <ShuffleIcon size={16} />
            <span>{t("settings").discoveryRate}</span>
            <span className="wave-control-value">{discoveryRate}%</span>
          </div>
          <p className="wave-control-desc">{t("settings").discoveryRateDesc}</p>
          <input
            type="range"
            className="wave-slider"
            min={0}
            max={100}
            value={discoveryRate}
            onChange={(e) => setDiscoveryRate(Number(e.target.value))}
          />
          <div className="wave-control-range">
            <span>{t("library").liked}</span>
            <span>{t("wave").title}</span>
          </div>
        </div>
        <div className="wave-control-card">
          <div className="wave-control-header">
            <ChartIcon size={16} />
            <span>{t("settings").historyDecay}</span>
            <span className="wave-control-value">{historyDecayDays}{t("settings").days}</span>
          </div>
          <p className="wave-control-desc">{t("settings").historyDecayDesc}</p>
          <input
            type="range"
            className="wave-slider"
            min={7}
            max={90}
            value={historyDecayDays}
            onChange={(e) => setHistoryDecayDays(Number(e.target.value))}
          />
          <div className="wave-control-range">
            <span>7{t("settings").days}</span>
            <span>90{t("settings").days}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
