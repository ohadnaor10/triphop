"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getCountryByCode } from "../lib/geo";
import { getPopularDestinations } from "../data/popularDestinations";
import { IconGlobe, IconMapPin, IconSearch, IconX } from "./icons";
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
  selected: SearchDestination[];
  destinationKey: (dest: SearchDestination) => string;
  onToggle: (dest: SearchDestination) => void;
  onDone: () => void;
  onClose: () => void;
};

function destinationFlag(dest: SearchDestination): string | undefined {
  if (dest.type === "country") return getCountryByCode(dest.code)?.flag;
  if (dest.type === "city") return getCountryByCode(dest.countryCode)?.flag;
  return undefined;
}

function DestinationCard({
  dest,
  isSelected,
  onToggle,
}: {
  dest: SearchDestination;
  isSelected: boolean;
  onToggle: () => void;
}) {
  const flag = destinationFlag(dest);
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex w-24 shrink-0 snap-center flex-col items-center gap-2 rounded-3xl px-2 py-4 text-center transition ${
        isSelected ? "bg-orange-500 shadow-lg shadow-orange-500/30" : "bg-white/10 hover:bg-white/20"
      }`}
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-2xl">
        {flag ?? (dest.type === "region" ? <IconGlobe className="h-6 w-6 text-white" /> : <IconMapPin className="h-6 w-6 text-white" />)}
      </span>
      <span className="line-clamp-2 text-xs font-semibold text-white">
        {dest.name}
        {dest.type === "city" ? `, ${dest.countryName}` : ""}
      </span>
    </button>
  );
}

export default function DestinationPickerOverlay({
  query,
  onQueryChange,
  results,
  selected,
  destinationKey,
  onToggle,
  onDone,
  onClose,
}: DestinationPickerOverlayProps) {
  const [visible, setVisible] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
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
  const displayItems = isSearching ? baseItems : [...baseItems, ...baseItems, ...baseItems];

  useLayoutEffect(() => {
    if (isSearching) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth / 3;
  }, [isSearching]);

  function handleScroll() {
    if (isSearching) return;
    const el = scrollerRef.current;
    if (!el) return;
    const singleWidth = el.scrollWidth / 3;
    if (singleWidth <= 0) return;
    if (el.scrollLeft < singleWidth * 0.5) el.scrollLeft += singleWidth;
    else if (el.scrollLeft > singleWidth * 1.5) el.scrollLeft -= singleWidth;
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

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-3">
          {selected.map((d) => (
            <span
              key={destinationKey(d)}
              className="flex items-center gap-1 rounded-full bg-orange-500 py-1 pl-2.5 pr-1.5 text-xs font-medium text-white"
            >
              {d.name}
              <button
                type="button"
                onClick={() => onToggle(d)}
                aria-label={`Remove ${d.name}`}
                className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-orange-600"
              >
                <IconX className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
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
                isSelected={selected.some((s) => destinationKey(s) === destinationKey(d))}
                onToggle={() => onToggle(d)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <button
          type="button"
          onClick={onDone}
          className="w-full rounded-2xl bg-orange-500 py-3 text-sm font-semibold text-white transition active:scale-[0.98] active:bg-orange-600"
        >
          Done
        </button>
      </div>
    </div>
  );
}
