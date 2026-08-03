"use client";

import { useEffect, useMemo, useState } from "react";
import { getPopularDestinations } from "../data/popularDestinations";
import { useInfiniteHorizontalScroll } from "./useInfiniteHorizontalScroll";
import DestinationCard from "./DestinationCard";
import { IconSearch, IconX } from "./icons";
import type { SearchDestination } from "../page";

type DestinationResults = {
  countries: SearchDestination[];
  regions: SearchDestination[];
  cities: SearchDestination[];
  places: SearchDestination[];
};

type DestinationPickerOverlayProps = {
  query: string;
  onQueryChange: (query: string) => void;
  results: DestinationResults;
  destinationKey: (dest: SearchDestination) => string;
  selectedDestinations: SearchDestination[];
  closeOnSelect: boolean;
  onSelect: (dest: SearchDestination) => void;
  onClear: () => void;
  onClose: () => void;
};

export default function DestinationPickerOverlay({
  query,
  onQueryChange,
  results,
  destinationKey,
  selectedDestinations,
  closeOnSelect,
  onSelect,
  onClear,
  onClose,
}: DestinationPickerOverlayProps) {
  const [visible, setVisible] = useState(false);
  const isSearching = query.trim().length > 0;

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const popular = useMemo(
    () =>
      getPopularDestinations().map(
        (c): SearchDestination => ({ type: "country", code: c.isoCode, name: c.name }),
      ),
    [],
  );

  const searchItems = useMemo(
    () => [...results.countries, ...results.regions, ...results.cities, ...results.places],
    [results],
  );

  const baseItems = isSearching ? searchItems : popular;
  const { scrollerRef, displayItems, handleScroll } = useInfiniteHorizontalScroll(baseItems, !isSearching);

  const selectedKeys = useMemo(
    () => new Set(selectedDestinations.map((d) => destinationKey(d))),
    [selectedDestinations, destinationKey],
  );

  function handleSelect(dest: SearchDestination) {
    onSelect(dest);
    if (closeOnSelect) onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose a destination"
      className={`fixed inset-0 z-[1250] flex flex-col bg-slate-900/85 backdrop-blur-md transition-opacity duration-200 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="flex items-center gap-2 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+1rem)]">
        <div className="relative flex-1">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search continents, countries, cities…"
            className="w-full rounded-2xl border border-white/10 bg-white/10 py-2.5 pl-9 pr-3 text-sm text-white outline-none placeholder:text-slate-300 focus:border-orange-400/60 focus:ring-2 focus:ring-orange-400/30"
          />
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

      {selectedDestinations.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
          {selectedDestinations.map((d) => (
            <span
              key={destinationKey(d)}
              className="flex items-center gap-1 rounded-full bg-white/15 py-1 pl-2.5 pr-1.5 text-xs font-medium text-white"
            >
              {d.name}
              <button
                type="button"
                onClick={() => onSelect(d)}
                aria-label={`Remove ${d.name}`}
                className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-white/25"
              >
                <IconX className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={onClear}
            className="ml-1 text-xs font-semibold text-slate-300 transition hover:text-white hover:underline"
          >
            Clear
          </button>
        </div>
      )}

      <div className="flex flex-1 flex-col justify-center overflow-hidden">
        {displayItems.length === 0 ? (
          <p className="px-4 text-center text-sm text-slate-300">No matches found</p>
        ) : (
          <div
            ref={scrollerRef}
            onScroll={handleScroll}
            className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-[calc(50%-3rem)] py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {displayItems.map((d, i) => (
              <DestinationCard
                key={`${destinationKey(d)}-${i}`}
                dest={d}
                selected={selectedKeys.has(destinationKey(d))}
                onSelect={() => handleSelect(d)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
