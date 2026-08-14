import DateModeFields from "./DateModeFields";
import HeroPanelShell from "./HeroPanelShell";
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
    <HeroPanelShell>
      {/* Tabs + calendar shared with the post wizard, so searching for dates and setting
          them on a post look and behave identically. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <DateModeFields
          draft={dateSearchDraft}
          onDraftChange={(updater) => setDateSearchDraft((d) => updater(d))}
          monthOptions={monthOptions}
          currentMonth={currentMonthKey()}
          formatMonth={formatMonth}
          onRangeComplete={(range) => {
            // The search applies a complete range immediately — picking both ends is the
            // whole interaction, so making the user confirm it again is a wasted tap.
            setAppliedDateSearch({ ...dateSearchDraft, ...range });
            setOpenHeroField(null);
          }}
        />
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
    </HeroPanelShell>
  );
}
