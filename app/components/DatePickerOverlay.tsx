"use client";

import { useEffect, useState } from "react";
import HorizontalCalendarRangePicker from "./HorizontalCalendarRangePicker";
import DurationInput from "./DurationInput";
import { IconX } from "./icons";
import type { DateSearchUI } from "../page";

type DatePickerOverlayProps = {
  draft: DateSearchUI;
  onDraftChange: (updater: (d: DateSearchUI) => DateSearchUI) => void;
  monthOptions: string[];
  formatMonth: (ym: string) => string;
  onAutoApply: (draft: DateSearchUI) => void;
  onApply: () => void;
  onClear: () => void;
  onClose: () => void;
};

export default function DatePickerOverlay({
  draft,
  onDraftChange,
  monthOptions,
  formatMonth,
  onAutoApply,
  onApply,
  onClear,
  onClose,
}: DatePickerOverlayProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose dates"
      className={`fixed inset-0 z-[1250] flex flex-col bg-slate-900/85 backdrop-blur-md transition-opacity duration-200 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="flex items-center gap-2 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+1rem)]">
        <div className="flex flex-1 gap-1 rounded-2xl bg-white/10 p-1">
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
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition active:scale-95 active:bg-white/20"
        >
          <IconX className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-1 flex-col justify-center overflow-y-auto px-4 py-2">
        {draft.mode === "specific" ? (
          <div className="rounded-3xl bg-white/5 p-4 ring-1 ring-white/10">
            <HorizontalCalendarRangePicker
              startDate={draft.startDate}
              endDate={draft.endDate}
              onChange={(range) => {
                const next = { ...draft, ...range };
                onDraftChange(() => next);
                if (range.startDate && range.endDate) onAutoApply(next);
              }}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-1.5">
              {monthOptions.map((month) => (
                <button
                  key={month}
                  type="button"
                  onClick={() =>
                    onDraftChange((d) => ({
                      ...d,
                      months: d.months.includes(month) ? d.months.filter((m) => m !== month) : [...d.months, month],
                    }))
                  }
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition ${
                    draft.months.includes(month)
                      ? "bg-orange-500 text-white ring-orange-500"
                      : "bg-white/10 text-white ring-white/20 hover:bg-white/20"
                  }`}
                >
                  {formatMonth(month)}
                </button>
              ))}
            </div>
            <div className="rounded-2xl bg-white p-3">
              <DurationInput
                value={draft.duration}
                onChange={(duration) => onDraftChange((d) => ({ ...d, duration }))}
                label="Optional: trip duration"
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <button
          type="button"
          onClick={onClear}
          className="flex-1 rounded-2xl bg-white/10 py-3 text-sm font-semibold text-white transition active:bg-white/20"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={onApply}
          className="flex-1 rounded-2xl bg-orange-500 py-3 text-sm font-semibold text-white transition active:scale-[0.98] active:bg-orange-600"
        >
          Apply
        </button>
      </div>
    </div>
  );
}
