"use client";

import { useState } from "react";

type CalendarRangePickerProps = {
  startDate: string;
  endDate: string;
  onChange: (range: { startDate: string; endDate: string }) => void;
};

function toISO(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function buildMonthGrid(year: number, month: number): (string | null)[] {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array(firstDay).fill(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(toISO(year, month, day));
  }
  return cells;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function MonthGrid({
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
      <p className="mb-2 text-center text-sm font-semibold text-slate-900">{label}</p>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-slate-400">
        {WEEKDAYS.map((d, i) => (
          <div key={i}>{d}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((iso, i) => {
          if (!iso) return <div key={i} />;
          const isPast = iso < todayISO;
          const isStart = iso === startDate;
          const isEnd = iso === endDate;
          const inRange = startDate && endDate && iso > startDate && iso < endDate;
          return (
            <button
              key={iso}
              type="button"
              disabled={isPast}
              onClick={() => onPick(iso)}
              className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition ${
                isStart || isEnd
                  ? "bg-orange-500 text-white"
                  : inRange
                    ? "bg-orange-100 text-orange-700"
                    : isPast
                      ? "text-slate-300"
                      : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              {Number(iso.slice(-2))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function CalendarRangePicker({ startDate, endDate, onChange }: CalendarRangePickerProps) {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());

  function handlePick(iso: string) {
    if (!startDate || (startDate && endDate)) {
      onChange({ startDate: iso, endDate: "" });
      return;
    }
    if (iso < startDate) {
      onChange({ startDate: iso, endDate: "" });
      return;
    }
    onChange({ startDate, endDate: iso });
  }

  function goPrevMonth() {
    const next = new Date(viewYear, viewMonth - 1, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  }

  function goNextMonth() {
    const next = new Date(viewYear, viewMonth + 1, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  }

  const second = new Date(viewYear, viewMonth + 1, 1);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={goPrevMonth}
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
          onClick={goNextMonth}
          aria-label="Next month"
          className="flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <MonthGrid year={viewYear} month={viewMonth} startDate={startDate} endDate={endDate} onPick={handlePick} />
        <MonthGrid
          year={second.getFullYear()}
          month={second.getMonth()}
          startDate={startDate}
          endDate={endDate}
          onPick={handlePick}
        />
      </div>
    </div>
  );
}
