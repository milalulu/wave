import type { ReactNode } from "react";

interface IconProps {
  size?: number;
  className?: string;
  filled?: boolean;
}

function Svg({ size = 18, className, stroke = "currentColor", children }: IconProps & { children: ReactNode; stroke?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const PlayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 4l14 8-14 8z" fill="currentColor" stroke="none" />
  </Svg>
);

export const PauseIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" />
    <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" />
  </Svg>
);

export const NextIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5l9 7-9 7z" fill="currentColor" stroke="none" />
    <rect x="16" y="4" width="2.4" height="16" rx="1" fill="currentColor" stroke="none" />
  </Svg>
);

export const PreviousIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 5l-9 7 9 7z" fill="currentColor" stroke="none" />
    <rect x="5.6" y="4" width="2.4" height="16" rx="1" fill="currentColor" stroke="none" />
  </Svg>
);

export const ShuffleIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M16 3h5v5" />
    <path d="M4 20L21 3" />
    <path d="M21 16v5h-5" />
    <path d="M15 15l6 6" />
    <path d="M4 4l5 5" />
  </Svg>
);

export const RepeatIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M17 2l4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="M7 22l-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
  </Svg>
);

export const RepeatOneIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M17 2l4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="M7 22l-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    <text
      x="12"
      y="16.5"
      fontSize="10"
      textAnchor="middle"
      fill="currentColor"
      stroke="none"
    >
      1
    </text>
  </Svg>
);

export const VolumeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11 5L6 9H2v6h4l5 4z" fill="currentColor" stroke="none" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M18.5 5.5a9 9 0 0 1 0 13" />
  </Svg>
);

export const VolumeMuteIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11 5L6 9H2v6h4l5 4z" fill="currentColor" stroke="none" />
    <path d="M16 9l5 6" />
    <path d="M21 9l-5 6" />
  </Svg>
);

export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </Svg>
);

export const DownloadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M19 12l-7 7-7-7" />
    <path d="M4 19h16" />
  </Svg>
);

export const UploadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 19v-14M5 12l7-7 7 7" />
    <path d="M4 5h16" />
  </Svg>
);

export const SaveIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </Svg>
);

export const RefreshCwIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M21 12a9 9 0 1 1-9 9 9.75 9.75 0 0 1 6.74-2.74L21 16" />
  </Svg>
);

export const HeartIcon = (p: IconProps) => (
  <Svg {...p}>
    <path
      d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"
      fill={p.filled ? "currentColor" : "none"}
    />
  </Svg>
);

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </Svg>
);

export const HomeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 10.5L12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
  </Svg>
);

export const QueueIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6h16M4 12h10M4 18h7" />
    <path d="M16 16l3 2 3-4" />
  </Svg>
);

export const FolderIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Svg>
);

export { WaveLogo, WaveLogoMark, WaveAppIconBadge, WaveTitle } from "./WaveLogo";

export const WaveIcon = (p: IconProps) => (
  <svg
    width={p.size ?? 18}
    height={p.size ?? 18}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={p.className}
    aria-hidden="true"
  >
    <path
      d="M3 8.5C4.2 6.5 6.5 6.5 8 8.2L10.5 12C11.5 13.2 13 13.2 14 12L15.8 9.5C16.8 8.2 18.5 8 19.8 9.2L21.5 12.5C22.2 14 21.5 16 19.8 16H16.2C14.8 16 13.8 15 13.2 14L11.8 11.8C10.8 10.5 9.2 10.5 8.2 11.8L5.5 15.2C4.5 16.5 2.5 16 1.8 14.5C1.2 13 1.8 11 2.8 9.5L3 8.5Z"
      fill="currentColor"
    />
    <path d="M16 10.5L19.5 12.8L16 15.1V10.5Z" fill="var(--bg, #060814)" />
  </svg>
);

export const ListIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" />
    <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" />
  </Svg>
);

export const PlaylistIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="M6 8h12M6 12h12M6 16h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </Svg>
);

export const SettingsIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
  </Svg>
);;

export const BackIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </Svg>
);

export const LyricsIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5h16M4 12h10M4 19h7" />
    <path d="M16 16l3 2 3-4" />
  </Svg>
);

export const MoonIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </Svg>
);

export const MoreIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="5" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="12" cy="19" r="1.3" fill="currentColor" stroke="none" />
  </Svg>
);

export const SpeedIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 13a3 3 0 1 0-2.9-3.6" />
    <path d="M12 13l5-4" />
    <circle cx="12" cy="12" r="9" />
  </Svg>
);

export const SliderIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="8" cy="12" r="2" />
    <circle cx="14" cy="18" r="2" />
  </Svg>
);

export const MiniPlayerIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 9l6 6 6-6" />
    <path d="M6 15l6 6 6-6" />
  </Svg>
);

export const ExpandIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 15l6-6 6 6" />
  </Svg>
);

export const RadioIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    <path d="M8.5 8.5a5 5 0 0 0 0 7" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M5.5 5.5a9 9 0 0 0 0 13" />
    <path d="M18.5 5.5a9 9 0 0 1 0 13" />
  </Svg>
);

export const ChartIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </Svg>
);

export const TagIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 13l-7 7-9-9V4h7z" />
    <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
  </Svg>
);

export const SpinnerIcon = ({ size = 18, className }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    className={`spinner ${className ?? ""}`}
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" strokeOpacity="0.25" />
    <path d="M21 12a9 9 0 0 0-9-9" />
  </svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
);

export const ChevronUpIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 15l6-6 6 6" />
  </Svg>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);

export const ShareIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </Svg>
);
