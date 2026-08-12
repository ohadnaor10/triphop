import CalendarRangePicker from "./CalendarRangePicker";
import MonthCarousel from "./MonthCarousel";
import type { DateSearchUI } from "../page";

export type DatesPanelProps = {
  /** Whether the panel should render at all — mirrors `openHeroField === "dates"`. */
  isOpen: boolean;
  dateSearchDraft: DateSearchUI;
  setDateSearchDraft: (value: DateSearchUI | ((prev: DateSearchUI) => DateSearchUI)) => void;
  setAppliedDateSearch: (value: DateSearchUI | null) => void;
  setOpenHeroField: (value: "destination" | "dates" | "filters" | null) => void;
  monthOptions: string[];
  formatMonth: (ym: string) => string;
  currentMonthKey: () => string;
  emptyDateSearch: DateSearchUI;
};

export default function DatesPanel({
  isOpen,
  dateSearchDraft,
  setDateSearchDraft,
  setAppliedDateSearch,
  setOpenHeroField,
  monthOptions,
  formatMonth,
  currentMonthKey,
  emptyDateSearch,
}: DatesPanelProps) {
  if (!isOpen) return null;
  return (
    // Fixed to the viewport bottom (rather than positioned relative to the trigger)
    // so the whole panel — including the Apply/Clear buttons — always stays within
    // the visible screen, regardless of where the trigger sits or how tall the page is.
    <div className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+1rem)] top-auto z-50 flex max-h-[75dvh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
      <div className="flex shrink-0 gap-1 border-b border-slate-100 p-1.5">
        <button
          type="button"
          onClick={() => setDateSearchDraft((d) => ({ ...d, mode: "specific" }))}
          className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${
            dateSearchDraft.mode === "specific" ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"
          }`}
        >
          Specific Dates
        </button>
        <button
          type="button"
          onClick={() => setDateSearchDraft((d) => ({ ...d, mode: "flexible" }))}
          className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${
            dateSearchDraft.mode === "flexible" ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"
          }`}
        >
          Flexible Dates
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {dateSearchDraft.mode === "specific" ? (
          <CalendarRangePicker
            months={1}
            startDate={dateSearchDraft.startDate}
            endDate={dateSearchDraft.endDate}
            onChange={(range) => {
              const next = { ...dateSearchDraft, ...range };
              setDateSearchDraft(next);
              if (range.startDate && range.endDate) {
                setAppliedDateSearch(next);
                setOpenHeroField(null);
              }
            }}
          />
        ) : (
          <MonthCarousel
            months={monthOptions}
            selected={dateSearchDraft.months}
            formatMonth={formatMonth}
            currentMonth={currentMonthKey()}
            onToggle={(month) =>
              setDateSearchDraft((d) => ({
                ...d,
                months: d.months.includes(month) ? d.months.filter((m) => m !== month) : [...d.months, month],
              }))
            }
          />
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-slate-100 p-2.5">
        <button
          type="button"
          onClick={() => {
            setDateSearchDraft(emptyDateSearch);
            setAppliedDateSearch(null);
            setOpenHeroField(null);
          }}
          className="flex-1 rounded-xl bg-slate-100 py-2 text-xs font-semibold text-slate-700 transition active:bg-slate-200"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => {
            const hasContent =
              dateSearchDraft.mode === "specific"
                ? Boolean(dateSearchDraft.startDate && dateSearchDraft.endDate)
                : dateSearchDraft.months.length > 0;
            setAppliedDateSearch(hasContent ? dateSearchDraft : null);
            setOpenHeroField(null);
          }}
          className="flex-1 rounded-xl bg-orange-500 py-2 text-xs font-semibold text-white transition active:scale-[0.98] active:bg-orange-600"
        >
          Apply
        </button>
      </div>
    </div>
  );
}
