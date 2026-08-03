"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

// Renders 3 copies of `items` back to back and silently snaps the scroll
// position by one copy-width once scrolling has settled at either end, so it
// looks like an endless loop. The snap is deferred until scroll comes to a
// rest (rather than applied on every scroll event) so it never fights the
// browser's momentum/inertia scrolling — doing it mid-flick is what causes a
// visible stutter, since the browser has to reconcile a moving scrollLeft
// against a target position it just computed.
export function useInfiniteHorizontalScroll<T>(items: T[], enabled: boolean) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const settleTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const displayItems = enabled ? [...items, ...items, ...items] : items;

  useLayoutEffect(() => {
    if (!enabled) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth / 3;
  }, [enabled, items.length]);

  useEffect(
    () => () => {
      if (settleTimeout.current) clearTimeout(settleTimeout.current);
    },
    [],
  );

  function handleScroll() {
    if (!enabled) return;
    if (settleTimeout.current) clearTimeout(settleTimeout.current);
    settleTimeout.current = setTimeout(() => {
      const el = scrollerRef.current;
      if (!el) return;
      const singleWidth = el.scrollWidth / 3;
      if (singleWidth <= 0) return;
      if (el.scrollLeft < singleWidth * 0.5) el.scrollLeft += singleWidth;
      else if (el.scrollLeft > singleWidth * 1.5) el.scrollLeft -= singleWidth;
    }, 120);
  }

  return { scrollerRef, displayItems, handleScroll };
}
