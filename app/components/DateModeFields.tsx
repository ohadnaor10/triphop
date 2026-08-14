"use client";

import CalendarRangePicker from "./CalendarRangePicker";
import MonthCarousel from "./MonthCarousel";
import type { DateSearchUI } from "../page";

type DateModeFieldsProps = {
  draft: DateSearchUI;
  onDraftChange: (updater: (d: DateSearchUI) => DateSearchUI) => void;
  monthOptions: string[];
  currentMonth: string;
  formatMonth: (ym: string) => string;
  /** Fired once both ends of a specific range are picked — the search panel auto-applies on that. */
  onRangeComplete?: (range: { startDate: string; endDate: string }) => void;
};

// "Specific dates" vs "flexible months", shared by the search bar's dates dropdown and the
// post-creation wizard.
//
// These were two separate implementations — the wizard's rendered dark, with a different
// calendar component behind it — which is how a user could pick dates one way when
// searching and a visibly different way when posting the same trip. One component means
// they cannot drift again, and the wizard inherits the search's light styling for free.
export default function DateModeFields({
  draft,
  onDraftChange,
  monthOptions,
  currentMonth,
  formatMonth,
  onRangeComplete,
}: DateModeFieldsProps) {
  return (
    <div className="flex flex-col">
      <div className="flex gap-1 border-b border-slate-100 p-1.5">
        <button
          type="button"
          onClick={() => onDraftChange((d) => ({ ...d, mode: "specific" }))}
          className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${
            draft.mode === "specific" ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"
          }`}
        >
          Specific Dates
        </button>
        <button
          type="button"
          onClick={() => onDraftChange((d) => ({ ...d, mode: "flexible" }))}
          className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${
            draft.mode === "flexible" ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"
          }`}
        >
          Flexible Dates
        </button>
      </div>

      <div className="p-2">
        {draft.mode === "specific" ? (
          <CalendarRangePicker
            months={1}
            startDate={draft.startDate}
            endDate={draft.endDate}
            onChange={(range) => {
              onDraftChange((d) => ({ ...d, ...range }));
              if (range.startDate && range.endDate) onRangeComplete?.(range);
            }}
          />
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
    </div>
  );
}
