"use client";

import { useMemo, useRef } from "react";
import { pickRangeDate } from "../lib/calendar";
import { MonthGrid } from "./CalendarRangePicker";

type HorizontalCalendarRangePickerProps = {
  startDate: string;
  endDate: string;
  onChange: (range: { startDate: string; endDate: string }) => void;
};

const MONTHS_AHEAD = 12;

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
    el.scrollBy({ left: direction * el.clientWidth, behavior: "smooth" });
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => scrollByOneMonth(-1)}
          aria-label="Previous month"
          className="flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
        >
          ‹
        </button>
        <p className="text-xs font-medium text-slate-500">
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
          className="flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
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
            <MonthGrid year={year} month={month} startDate={startDate} endDate={endDate} onPick={handlePick} />
          </div>
        ))}
      </div>
    </div>
  );
}
