import { useEffect, useState } from "react";
import { cacheCover, getCachedCover } from "../core/cover/CoverCache";

interface CoverProps {
  src?: string;
  className?: string;
  alt?: string;
}

export function Cover({ src, className, alt }: CoverProps) {
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    if (!src) {
      setResolved(null);
      return;
    }
    const cached = getCachedCover(src);
    if (cached) {
      setResolved(cached);
      return;
    }
    setResolved(src);
    let cancelled = false;
    void cacheCover(src).then((data) => {
      if (!cancelled && data) setResolved(data);
    });
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (!resolved) return null;
  return (
    <img
      src={resolved}
      alt={alt ?? ""}
      className={className}
      loading="lazy"
      draggable={false}
      onError={() => {
        if (src) {
          const stale = getCachedCover(src);
          if (stale) setResolved(stale);
        }
      }}
    />
  );
}
