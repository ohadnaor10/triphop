"use client";

import { useEffect, useState } from "react";
import DateSearchFields from "./DateSearchFields";
import { IconX } from "./icons";
import type { DateSearchUI } from "../page";

type DatePickerOverlayProps = {
  draft: DateSearchUI;
  onDraftChange: (updater: (d: DateSearchUI) => DateSearchUI) => void;
  monthOptions: string[];
  currentMonth: string;
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
  currentMonth,
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
      <div className="flex items-center justify-end px-4 pb-3 pt-[calc(env(safe-area-inset-top)+1rem)]">
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
        <DateSearchFields
          draft={draft}
          onDraftChange={onDraftChange}
          monthOptions={monthOptions}
          currentMonth={currentMonth}
          formatMonth={formatMonth}
          onRangeComplete={(range) => onAutoApply({ ...draft, ...range })}
        />
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
