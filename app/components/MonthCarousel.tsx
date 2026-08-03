"use client";

import { useLayoutEffect, useMemo, useRef } from "react";

type MonthCarouselProps = {
  months: string[];
  selected: string[];
  onToggle: (month: string) => void;
  formatMonth: (ym: string) => string;
  currentMonth?: string;
};

// Bounded horizontal scroller (no infinite loop) — `months` is expected to already be a
// fixed range (e.g. 2 years back / 2 years forward). Starts centered on `currentMonth`.
export default function MonthCarousel({ months, selected, onToggle, formatMonth, currentMonth }: MonthCarouselProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const currentIndex = useMemo(
    () => (currentMonth ? months.indexOf(currentMonth) : -1),
    [months, currentMonth],
  );

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || currentIndex < 0) return;
    const item = el.children[currentIndex] as HTMLElement | undefined;
    if (!item) return;
    el.scrollLeft = item.offsetLeft - el.clientWidth / 2 + item.clientWidth / 2;
  }, [currentIndex]);

  if (months.length === 0) return null;

  return (
    <div
      ref={scrollerRef}
      className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-[calc(50%-3rem)] py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {months.map((month) => {
        const isSelected = selected.includes(month);
        const isCurrent = month === currentMonth;
        return (
          <button
            key={month}
            type="button"
            onClick={() => onToggle(month)}
            className={`flex w-20 shrink-0 snap-center flex-col items-center justify-center gap-0.5 rounded-3xl px-2 py-5 text-center transition active:scale-95 ${
              isSelected ? "bg-orange-500 text-white" : "bg-slate-200/90 text-slate-600 hover:bg-slate-300/90"
            } ${isCurrent && !isSelected ? "ring-2 ring-inset ring-orange-400" : ""}`}
          >
            <span className="text-sm font-bold leading-tight">{formatMonth(month)}</span>
            {/* A ring alone would vanish once the pill turns solid orange on select, so the
                "current month" cue also gets its own always-visible caption. */}
            {isCurrent && (
              <span
                className={`text-[9px] font-bold uppercase tracking-wide ${
                  isSelected ? "text-white/80" : "text-orange-500"
                }`}
              >
                Today
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
