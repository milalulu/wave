import { memo, useState } from "react";
import { cacheCover, getCachedCover, invalidateCover } from "../core/cover/CoverCache";

import unavailableCover from "../assets/cover-unavailable.svg";

interface CoverProps {
  src?: string;
  className?: string;
  alt?: string;
  priority?: boolean;
}

export const Cover = memo(function Cover(props: CoverProps) {
  return <CoverImage key={props.src ?? "missing"} {...props} />;
});

function CoverImage({ src, className, alt, priority = false }: CoverProps) {
  const [resolved, setResolved] = useState<string | null>(() => src ? getCachedCover(src) ?? src : null);
  const [failed, setFailed] = useState<string | null>(null);

  if (!resolved || failed === resolved) return <span style={{ backgroundImage: `url("${unavailableCover}")` }} className={`cover-fallback ${className ?? ""}`} role={alt ? "img" : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : true} />;
  return (
    <img
      src={resolved}
      alt={alt ?? ""}
      className={className}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      draggable={false}
      onLoad={() => {
        if (src && resolved === src && /^https?:\/\//i.test(src)) void cacheCover(src);
      }}
      onError={() => {
        if (src && resolved !== src) {
          invalidateCover(src);
          setResolved(src);
          return;
        }
        setFailed(resolved);
      }}
    />
  );
}
