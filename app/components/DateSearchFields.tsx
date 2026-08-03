"use client";

import HorizontalCalendarRangePicker from "./HorizontalCalendarRangePicker";
import MonthCarousel from "./MonthCarousel";
import type { DateSearchUI } from "../page";

type DateSearchFieldsProps = {
  draft: DateSearchUI;
  onDraftChange: (updater: (d: DateSearchUI) => DateSearchUI) => void;
  monthOptions: string[];
  currentMonth: string;
  formatMonth: (ym: string) => string;
  onRangeComplete?: (range: { startDate: string; endDate: string }) => void;
};

// Shared "specific dates" vs "flexible months" picker — used by both the hero search's
// full-screen DatePickerOverlay and the post-creation wizard's dates step, so the two
// surfaces stay in lockstep instead of drifting apart.
export default function DateSearchFields({
  draft,
  onDraftChange,
  monthOptions,
  currentMonth,
  formatMonth,
  onRangeComplete,
}: DateSearchFieldsProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1 rounded-2xl bg-white/10 p-1">
        <button
          type="button"
          onClick={() => onDraftChange((d) => ({ ...d, mode: "specific" }))}
          className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${
            draft.mode === "specific" ? "bg-white text-slate-900" : "text-slate-200 hover:bg-white/10"
          }`}
        >
          Specific Dates
        </button>
        <button
          type="button"
          onClick={() => onDraftChange((d) => ({ ...d, mode: "flexible" }))}
          className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${
            draft.mode === "flexible" ? "bg-white text-slate-900" : "text-slate-200 hover:bg-white/10"
          }`}
        >
          Flexible Dates
        </button>
      </div>

      {draft.mode === "specific" ? (
        <div className="rounded-3xl bg-white/5 p-4 ring-1 ring-white/10">
          <HorizontalCalendarRangePicker
            startDate={draft.startDate}
            endDate={draft.endDate}
            onChange={(range) => {
              const next = { ...draft, ...range };
              onDraftChange(() => next);
              if (range.startDate && range.endDate) onRangeComplete?.({ startDate: range.startDate, endDate: range.endDate });
            }}
          />
        </div>
      ) : (
        <MonthCarousel
          months={monthOptions}
          selected={draft.months}
          formatMonth={formatMonth}
          currentMonth={currentMonth}
          onToggle={(month) =>
            onDraftChange((d) => ({
              ...d,
              months: d.months.includes(month) ? d.months.filter((m) => m !== month) : [...d.months, month],
            }))
          }
        />
      )}
    </div>
  );
}
