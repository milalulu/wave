import { useEffect, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

interface VirtualListProps<T> {
  items: T[];
  rowKey: (item: T, index: number) => string;
  estimateSize?: number;
  overscan?: number;
  renderRow: (item: T, index: number) => ReactNode;
}

export function VirtualList<T>({
  items,
  rowKey,
  estimateSize = 52,
  overscan = 8,
  renderRow,
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
    overscan,
  });

  if (!scrollEl || items.length === 0) {
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
          ref={virtualizer.measureElement}
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
