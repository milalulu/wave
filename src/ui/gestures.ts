import { useEffect, useRef } from "react";
import type { RefObject } from "react";

/**
 * Свайп назад от левого края экрана (Android/iOS паттерн).
 * Срабатывает только на touch-устройствах: mouse не эмитит TouchEvents.
 */
export function useEdgeSwipeBack(onBack: () => void): void {
  const onBackRef = useRef(onBack);

  useEffect(() => {
    onBackRef.current = onBack;
  });

  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let active = false;

    const onStart = (e: TouchEvent): void => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX > 28) return;
      active = true;
      startX = t.clientX;
      startY = t.clientY;
    };

    const onEnd = (e: TouchEvent): void => {
      if (!active) return;
      active = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (dx > 72 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        onBackRef.current();
      }
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchend", onEnd);
    };
  }, []);
}

/**
 * Свайп вниз на элементе (используется для сворачивания «Сейчас играет»).
 * Срабатывает только когда контент прокручен вверх. Возвращает ref,
 * который нужно повесить на корневой элемент вьюхи.
 */
export function useSwipeDown<T extends HTMLElement>(onSwipe: () => void): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const onSwipeRef = useRef(onSwipe);

  useEffect(() => {
    onSwipeRef.current = onSwipe;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let active = false;

    const onStart = (e: TouchEvent): void => {
      const scrollEl = el.closest<HTMLElement>(".content");
      if (scrollEl && scrollEl.scrollTop > 4) return;
      if (e.touches.length !== 1) return;
      active = true;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    };

    const onEnd = (e: TouchEvent): void => {
      if (!active) return;
      active = false;
      const t = e.changedTouches[0];
      const dy = t.clientY - startY;
      const dx = t.clientX - startX;
      if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) {
        onSwipeRef.current();
      }
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchend", onEnd);
    };
  }, []);

  return ref;
}
