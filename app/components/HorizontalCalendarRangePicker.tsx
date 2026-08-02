"use client";

import { useMemo, useRef } from "react";
import { buildMonthGrid, pickRangeDate, toISO, WEEKDAYS } from "../lib/calendar";

type HorizontalCalendarRangePickerProps = {
  startDate: string;
  endDate: string;
  onChange: (range: { startDate: string; endDate: string }) => void;
};

const MONTHS_AHEAD = 12;
const SCROLL_DURATION_MS = 180;

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function fastScrollTo(el: HTMLElement, target: number) {
  const start = el.scrollLeft;
  const change = target - start;
  if (change === 0) return;
  const startTime = performance.now();
  function step(now: number) {
    const progress = Math.min((now - startTime) / SCROLL_DURATION_MS, 1);
    el.scrollLeft = start + change * easeOutCubic(progress);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function DarkMonthGrid({
  year,
  month,
  startDate,
  endDate,
  onPick,
}: {
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  onPick: (iso: string) => void;
}) {
  const label = new Date(year, month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const cells = buildMonthGrid(year, month);
  const todayISO = toISO(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  return (
    <div>
      <p className="mb-2 text-center text-sm font-semibold text-white">{label}</p>
      <div className="grid grid-cols-7 text-center text-[10px] font-medium text-slate-400">
        {WEEKDAYS.map((d, i) => (
          <div key={i} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-2xl border border-white/10">
        {cells.map((iso, i) => {
          if (!iso) return <div key={i} className="h-11 border border-white/5" />;
          const isToday = iso === todayISO;
          const isPast = iso < todayISO;
          const isStart = iso === startDate;
          const isEnd = iso === endDate;
          const inRange = startDate && endDate && iso > startDate && iso < endDate;
          const isEdge = isStart || isEnd;
          return (
            <button
              key={iso}
              type="button"
              disabled={isPast}
              onClick={() => onPick(iso)}
              className={`flex h-11 items-center justify-center border border-white/5 text-sm font-medium transition ${
                isEdge
                  ? "bg-orange-500 text-white"
                  : inRange
                    ? "bg-orange-500/20 text-orange-200"
                    : isPast
                      ? "text-slate-600"
                      : "text-white hover:bg-white/10"
              } ${isToday ? (isEdge ? "ring-2 ring-inset ring-white" : "ring-2 ring-inset ring-orange-400") : ""}`}
            >
              {Number(iso.slice(-2))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function HorizontalCalendarRangePicker({
  startDate,
  endDate,
  onChange,
}: HorizontalCalendarRangePickerProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  const months = useMemo(() => {
    const now = new Date();
    return Array.from({ length: MONTHS_AHEAD }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }, []);

  function handlePick(iso: string) {
    onChange(pickRangeDate({ startDate, endDate }, iso));
  }

  function scrollByOneMonth(direction: 1 | -1) {
    const el = scrollerRef.current;
    if (!el) return;
    fastScrollTo(el, el.scrollLeft + direction * el.clientWidth);
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => scrollByOneMonth(-1)}
          aria-label="Previous month"
          className="flex h-7 w-7 items-center justify-center rounded-full text-white transition hover:bg-white/10"
        >
          ‹
        </button>
        <p className="text-xs font-medium text-slate-300">
          {startDate && endDate
            ? `${startDate} → ${endDate}`
            : startDate
              ? "Pick an end date"
              : "Pick a start date"}
        </p>
        <button
          type="button"
          onClick={() => scrollByOneMonth(1)}
          aria-label="Next month"
          className="flex h-7 w-7 items-center justify-center rounded-full text-white transition hover:bg-white/10"
        >
          ›
        </button>
      </div>
      <div
        ref={scrollerRef}
        className="flex snap-x snap-mandatory overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {months.map(({ year, month }) => (
          <div key={`${year}-${month}`} className="w-full shrink-0 snap-center px-1">
            <DarkMonthGrid year={year} month={month} startDate={startDate} endDate={endDate} onPick={handlePick} />
          </div>
        ))}
      </div>
    </div>
  );
}
