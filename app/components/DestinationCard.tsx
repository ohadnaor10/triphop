"use client";

import { getCountryByCode } from "../lib/geo";
import { IconGlobe, IconMapPin } from "./icons";
import type { SearchDestination } from "../page";

function destinationFlag(dest: SearchDestination): string | undefined {
  if (dest.type === "country") return getCountryByCode(dest.code)?.flag;
  if (dest.type === "city") return getCountryByCode(dest.countryCode)?.flag;
  return undefined;
}

export default function DestinationCard({
  dest,
  selected,
  onSelect,
}: {
  dest: SearchDestination;
  selected: boolean;
  onSelect: () => void;
}) {
  const flag = destinationFlag(dest);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-24 shrink-0 snap-center flex-col items-center gap-2 rounded-3xl px-2 py-4 text-center transition active:scale-95 ${
        selected ? "bg-orange-500/25 ring-2 ring-orange-400" : "bg-white/10 hover:bg-white/20"
      }`}
    >
      <span
        className={`flex h-12 w-12 items-center justify-center rounded-full text-2xl ${
          selected ? "bg-orange-400/30" : "bg-white/10"
        }`}
      >
        {flag ?? (dest.type === "region" ? <IconGlobe className="h-6 w-6 text-white" /> : <IconMapPin className="h-6 w-6 text-white" />)}
      </span>
      <span className={`line-clamp-2 text-xs font-semibold ${selected ? "text-orange-200" : "text-white"}`}>
        {dest.name}
        {dest.type === "city" ? `, ${dest.countryName}` : ""}
      </span>
    </button>
  );
}
