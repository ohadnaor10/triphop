"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// Breathing room between the panel's bottom edge and the bottom of the visible viewport.
const VIEWPORT_GAP_PX = 12;
// Below this the panel is too cramped to be usable; better to let it overflow slightly
// (and scroll) than to collapse into a sliver.
const MIN_HEIGHT_PX = 200;

type HeroPanelShellProps = {
  children: React.ReactNode;
};

// Dropdown chrome shared by the destination and dates panels.
//
// The panel hangs off its trigger (absolute, directly beneath the search box) — anchoring
// it to the viewport instead makes it float free of the control that opened it. But a
// trigger sitting low on the screen used to push the panel's footer past the bottom edge,
// so the height is capped at whatever room is actually left below the trigger. Callers
// lay out their content as shrink-0 header / flex-1 body / shrink-0 footer, which keeps
// the Clear+Apply row on screen and scrolls the body in the rare case it doesn't fit.
//
// visualViewport (not innerHeight) is what's measured, so an open iOS keyboard shrinks the
// panel rather than hiding its buttons behind the keyboard.
export default function HeroPanelShell({ children }: HeroPanelShellProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState<number>();

  const measure = useCallback(() => {
    const el = panelRef.current;
    if (!el) return;
    const viewport = window.visualViewport;
    const viewportBottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight);
    // Measure against the panel's own top edge — where it lands depends on the trigger,
    // which differs between the compact header and the full-screen hero.
    const top = el.getBoundingClientRect().top;
    setMaxHeight(Math.max(MIN_HEIGHT_PX, viewportBottom - top - VIEWPORT_GAP_PX));
  }, []);

  // Layout effect: measure before the browser paints, so the panel never flashes at full
  // height on open.
  useLayoutEffect(measure, [measure]);

  useEffect(() => {
    const viewport = window.visualViewport;
    // Keyboard open/close and rotation both land here; scroll matters because iOS moves
    // the visual viewport rather than resizing it when the keyboard appears.
    viewport?.addEventListener("resize", measure);
    viewport?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    return () => {
      viewport?.removeEventListener("resize", measure);
      viewport?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  return (
    <div
      ref={panelRef}
      style={{ maxHeight }}
      className="absolute inset-x-4 z-50 mt-2 flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg"
    >
      {children}
    </div>
  );
}
