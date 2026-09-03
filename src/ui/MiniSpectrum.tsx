import { memo } from "react";

export const MiniSpectrum = memo(function MiniSpectrum({ playing }: { playing: boolean }) {
  if (!playing) return null;
  return (
    <div className="mini-spectrum" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </div>
  );
});
