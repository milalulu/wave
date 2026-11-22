export function EchoesMark({ compact = false }: { compact?: boolean }) {
  const heights = compact ? [10, 20, 30, 38, 26, 16, 8] : [6, 16, 30, 48, 64, 42, 24, 12, 22, 36, 52, 32, 18, 28, 40, 22, 12, 18, 10, 6];
  return <svg aria-hidden="true" viewBox={`0 0 ${heights.length * 10} 70`} fill="currentColor">{heights.map((height, i) => <rect key={i} x={i * 10} y={(70 - height) / 2} width="5" height={height} rx="2.5" opacity={compact ? 1 : 1 - i * .025} />)}</svg>;
}
