import type { CSSProperties } from "react";

export function WaveLogoMark({
  size = 48,
  className,
  style,
  animated = false,
}: {
  size?: number;
  className?: string;
  style?: CSSProperties;
  animated?: boolean;
}) {
  return (
    <img
      src="/logo.svg"
      width={size}
      height={size}
      alt="Wave Logo"
      draggable={false}
      className={`wave-logo-mark ${animated ? "wave-logo-animated" : ""} ${className ?? ""}`}
      style={{ objectFit: "contain", ...style }}
    />
  );
}

/**
 * Full Wave Brand Logotype
 */
export function WaveLogo({
  size = 36,
  className,
  style,
  subtitle = true,
}: {
  size?: number;
  className?: string;
  style?: CSSProperties;
  subtitle?: boolean;
}) {
  const scale = size / 36;
  const height = subtitle ? 48 * scale : 36 * scale;

  return (
    <div
      className={`wave-brand-logo ${className ?? ""}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: `${10 * scale}px`,
        height: `${height}px`,
        userSelect: "none",
        ...style,
      }}
      aria-label="WAVE - Music Player"
    >
      <WaveLogoMark size={38 * scale} />

      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <svg
          width={130 * scale}
          height={26 * scale}
          viewBox="0 0 130 26"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="wave-a-bar" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#00F0FF" />
              <stop offset="50%" stopColor="#3B82F6" />
              <stop offset="100%" stopColor="#8B5CF6" />
            </linearGradient>
          </defs>

          <path
            d="M2 2H8.5L14 19L19.5 2H25.5L31 19L36.5 2H43L34.5 24H28L22.5 7L17 24H10.5L2 2Z"
            fill="currentColor"
          />

          <path
            d="M48 24L58.5 2H65.5L76 24H69L67 19H57L55 24H48ZM62 6.5L58.5 15H65.5L62 6.5Z"
            fill="currentColor"
          />

          <path
            d="M53 16.5C57 13.5 61 18.5 65 15.5C67.5 13.5 70.5 17 73 15"
            stroke="url(#wave-a-bar)"
            strokeWidth="3.2"
            strokeLinecap="round"
            fill="none"
          />

          <path
            d="M80 2H87L94.5 19L102 2H109L98 24H91L80 2Z"
            fill="currentColor"
          />

          <path
            d="M114 2H130V7.2H121V10.5H129V15.5H121V18.8H130V24H114V2Z"
            fill="currentColor"
          />
        </svg>

        {subtitle && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              marginTop: "2px",
              fontSize: `${8.5 * scale}px`,
              fontWeight: 800,
              letterSpacing: "0.22em",
              color: "var(--accent, #00F0FF)",
              textTransform: "uppercase",
              opacity: 0.95,
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: `${12 * scale}px`,
                height: "2px",
                background: "linear-gradient(90deg, #00F0FF, #3B82F6)",
                borderRadius: "1px",
              }}
            />
            <span>MUSIC PLAYER</span>
            <span
              style={{
                display: "inline-block",
                width: `${12 * scale}px`,
                height: "2px",
                background: "linear-gradient(90deg, #8B5CF6, #EC4899)",
                borderRadius: "1px",
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * App Icon Card (Squircle variant)
 */
export function WaveAppIconBadge({
  size = 64,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={`wave-app-icon-badge ${className ?? ""}`}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: `${size * 0.24}px`,
        background: "linear-gradient(145deg, #0C1226 0%, #060914 100%)",
        border: "1px solid rgba(0, 240, 255, 0.2)",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.6), inset 0 1px 1px rgba(255, 255, 255, 0.15)",
        display: "grid",
        placeItems: "center",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "-20%",
          left: "-20%",
          width: "140%",
          height: "140%",
          background: "radial-gradient(circle at 75% 30%, rgba(139, 92, 246, 0.25) 0%, rgba(0, 240, 255, 0.2) 35%, transparent 70%)",
          pointerEvents: "none",
        }}
      />
      <WaveLogoMark size={size * 0.72} />
    </div>
  );
}

/**
 * Compact crisp 24px Wave Icon for navigation and action buttons
 */
export function WaveIcon({
  size = 20,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="wave-ic-grad" x1="2" y1="12" x2="22" y2="12" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#00F0FF" />
          <stop offset="50%" stopColor="#3B82F6" />
          <stop offset="100%" stopColor="#A855F7" />
        </linearGradient>
      </defs>
      <path
        d="M2.5 8C3.5 6.5 5.5 6.5 7 8L9.5 12C10.5 13.5 12.5 13.5 13.5 12L15 9.5C16 8 18 8 19 9.5L21.5 13.5C22.5 15 21.5 17 19.5 17H16C14.5 17 13.5 16 13 14.8L11.5 12C10.5 10.5 8.5 10.5 7.5 12L5 16C4 17.5 2 17 1.5 15.5C1 14 1.5 12 2.5 10.5L3.5 9"
        fill="url(#wave-ic-grad)"
      />
      <path
        d="M15.5 9.5L19.5 12.5L15.5 15.5V9.5Z"
        fill="currentColor"
      />
    </svg>
  );
}
