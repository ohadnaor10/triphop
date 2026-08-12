import HeroPanelShell from "./HeroPanelShell";
import { IconX } from "./icons";
import type { SearchDestination } from "../page";

type DestinationResults = {
  countries: SearchDestination[];
  regions: SearchDestination[];
  cities: SearchDestination[];
  places: SearchDestination[];
};

export type DestinationPanelProps = {
  /** Whether the panel should render at all — mirrors `openHeroField === "destination"`. */
  isOpen: boolean;
  selectedDestinations: SearchDestination[];
  setSelectedDestinations: (value: SearchDestination[] | ((prev: SearchDestination[]) => SearchDestination[])) => void;
  destinationQuery: string;
  setDestinationQuery: (value: string) => void;
  destinationResults: DestinationResults;
  destinationKey: (d: SearchDestination) => string;
  toggleSelectedDestination: (dest: SearchDestination) => void;
  setOpenHeroField: (value: "destination" | "dates" | "filters" | null) => void;
};

export default function DestinationPanel({
  isOpen,
  selectedDestinations,
  setSelectedDestinations,
  destinationQuery,
  setDestinationQuery,
  destinationResults,
  destinationKey,
  toggleSelectedDestination,
  setOpenHeroField,
}: DestinationPanelProps) {
  if (!isOpen) return null;
  return (
    <HeroPanelShell>
      {/* Chips + search box stay pinned: the panel is height-capped, and an open keyboard
          shrinks it further, so letting the input scroll away with the results would hide
          the very field the keyboard is typing into. */}
      <div className="shrink-0 p-3 pb-0">
        {selectedDestinations.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {selectedDestinations.map((d) => (
              <span
                key={destinationKey(d)}
                className="flex items-center gap-1 rounded-full bg-orange-500 py-1 pl-2.5 pr-1.5 text-xs font-medium text-white"
              >
                {d.name}
                <button
                  type="button"
                  onClick={() => toggleSelectedDestination(d)}
                  aria-label={`Remove ${d.name}`}
                  className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-orange-600"
                >
                  <IconX className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => setSelectedDestinations([])}
              className="ml-1 text-xs font-semibold text-slate-400 transition hover:text-slate-700 hover:underline"
            >
              Clear
            </button>
          </div>
        )}

        <input
          type="text"
          autoFocus
          value={destinationQuery}
          onChange={(e) => setDestinationQuery(e.target.value)}
          placeholder="Search continents, regions, countries, cities…"
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-2">
        {destinationResults.countries.length === 0 &&
          destinationResults.regions.length === 0 &&
          destinationResults.cities.length === 0 &&
          destinationResults.places.length === 0 &&
          (destinationQuery.trim() === "" ? (
            <p className="px-2 py-2 text-xs text-slate-400">Start typing to search.</p>
          ) : (
            <p className="px-2 py-2 text-xs text-slate-400">No matches found</p>
          ))}

        {(
          [
            { key: "countries", label: "Countries", items: destinationResults.countries },
            { key: "regions", label: "Continents / Regions", items: destinationResults.regions },
            { key: "cities", label: "Cities / Specific Destinations", items: destinationResults.cities },
            { key: "places", label: "Natural Features & Places", items: destinationResults.places },
          ] as const
        ).map(
          ({ key, label, items }) =>
            items.length > 0 && (
              <div key={key}>
                <p className="mt-2 px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  {label}
                </p>
                {items.map((d) => (
                  <button
                    key={destinationKey(d)}
                    type="button"
                    onClick={() => toggleSelectedDestination(d)}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition ${
                      selectedDestinations.some((s) => destinationKey(s) === destinationKey(d))
                        ? "bg-orange-50 font-semibold text-orange-600"
                        : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {d.name}
                    {d.type === "city" ? `, ${d.countryName}` : ""}
                  </button>
                ))}
              </div>
            ),
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-slate-100 p-3">
        <button
          type="button"
          onClick={() => {
            setSelectedDestinations([]);
            setOpenHeroField(null);
          }}
          className="flex-1 rounded-xl bg-slate-100 py-2 text-xs font-semibold text-slate-700 transition active:bg-slate-200"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => setOpenHeroField(null)}
          className="flex-1 rounded-xl bg-orange-500 py-2 text-xs font-semibold text-white transition active:scale-[0.98] active:bg-orange-600"
        >
          Apply
        </button>
      </div>
    </HeroPanelShell>
  );
}
