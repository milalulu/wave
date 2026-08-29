import { useEffect, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

interface VirtualListProps<T> {
  items: T[];
  rowKey: (item: T, index: number) => string;
  estimateSize?: number;
  overscan?: number;
  renderRow: (item: T, index: number) => ReactNode;
  skeleton?: boolean;
  skeletonCount?: number;
}

export function VirtualList<T>({
  items,
  rowKey,
  estimateSize = 52,
  overscan = 8,
  renderRow,
  skeleton = false,
  skeletonCount = 8,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const el = containerRef.current?.closest<HTMLElement>(".content");
    if (el) setScrollEl(el);
  }, []);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => estimateSize,
    getItemKey: (index) => rowKey(items[index], index),
    overscan,
  });

  if (!scrollEl || items.length === 0) {
    if (skeleton) {
      return (
        <div ref={containerRef} className="virtual-list virtual-skeleton" aria-hidden="true">
          {Array.from({ length: skeletonCount }).map((_, i) => (
            <div key={i} className="skeleton-row">
              <span className="skeleton-block skeleton-cover" />
              <span className="skeleton-block skeleton-line skeleton-line-title" />
              <span className="skeleton-block skeleton-line skeleton-line-artist" />
            </div>
          ))}
        </div>
      );
    }
    return <div ref={containerRef} />;
  }

  return (
    <div
      ref={containerRef}
      className="virtual-list"
      style={{ height: virtualizer.getTotalSize(), position: "relative" }}
    >
      {virtualizer.getVirtualItems().map((row) => (
        <div
          key={rowKey(items[row.index], row.index)}
          data-index={row.index}
          className="virtual-row"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            transform: `translateY(${row.start}px)`,
          }}
        >
          {renderRow(items[row.index], row.index)}
        </div>
      ))}
    </div>
  );
}
