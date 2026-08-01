"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type ComboboxOption = { value: string; label: string; sublabel?: string };

function matchesPrefix(label: string, query: string): boolean {
  const words = label.toLowerCase().split(/[\s-]+/);
  return words.some((word) => word.startsWith(query));
}

type ComboboxProps = {
  options: ComboboxOption[];
  onSelect: (option: ComboboxOption) => void;
  placeholder: string;
  emptyMessage?: string;
  disabled?: boolean;
  selectedLabel?: string;
  maxResults?: number;
};

export default function Combobox({
  options,
  onSelect,
  placeholder,
  emptyMessage = "No matches",
  disabled = false,
  selectedLabel = "",
  maxResults = 50,
}: ComboboxProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q ? options.filter((o) => matchesPrefix(o.label, q)) : options;
    return matches.slice(0, maxResults);
  }, [options, query, maxResults]);

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={isOpen ? query : selectedLabel}
        disabled={disabled}
        onFocus={() => {
          setIsOpen(true);
          setQuery("");
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
        }}
        placeholder={placeholder}
        className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-50 disabled:text-slate-400"
      />
      {isOpen && !disabled && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {filtered.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">{emptyMessage}</li>}
          {filtered.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSelect(option);
                  setQuery("");
                  setIsOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-orange-50"
              >
                <span className="truncate">{option.label}</span>
                {option.sublabel && (
                  <span className="shrink-0 text-xs text-slate-400">{option.sublabel}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
