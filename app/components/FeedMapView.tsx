import dynamic from "next/dynamic";
import { useState } from "react";
import { IconX } from "./icons";
import type { MapCluster } from "../lib/cluster";
import type { FocusedPlace, MapViewport } from "../lib/mapStore";
import Avatar from "./Avatar";
import type { Post } from "../page";

const TripMap = dynamic(() => import("./TripMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-slate-400">Loading map…</div>
  ),
});

export type FeedMapViewProps = {
  /** False while the map is mounted but hidden behind the feed — see page.tsx. */
  isVisible: boolean;
  clusters: MapCluster[];
  /** Total posts matching the filters, ignoring the viewport. */
  totalCount: number;
  /** True when the viewport was too dense to ship in full and server-side grouping stood in. */
  overviewMode: boolean;
  onViewportChange: (viewport: MapViewport) => void;
  initialBounds: [number, number, number, number] | null;
  /** A cluster zooming can never split — the caller opens a list of its posts instead. */
  onOpenClusterList: (cluster: MapCluster) => void;
  /** Dimming for everything outside the searched destinations; null when nothing applies. */
  spotlightMask: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null;
  /** Dashed spokes tying each trip's markers to its midpoint. */
  tripLinks: GeoJSON.FeatureCollection<GeoJSON.LineString>;
  focusedMapPostId: string | null;
  /** Destinations of the focused post; while non-empty the map shows only these. */
  focusedPlaces: FocusedPlace[];
  focusedCountryCodes: string[];
  /** Countries with no city chosen — these widen the focus camera; see TripMap. */
  focusedUnpinnedCountryCodes: string[];
  setFocusedMapPostId: (id: string | null) => void;
  focusedMapPost: Post | null;
  setViewPostId: (id: string | null) => void;
  goToUserProfile: (userId: string, e?: { stopPropagation: () => void }) => void;
  initials: (name: string) => string;
  getDateLabel: (date: Post["date"], compact?: boolean) => string;
  getDestinationLabel: (destinations: Post["destinations"]) => string;
};

export function FeedMapView({
  isVisible,
  clusters,
  totalCount,
  overviewMode,
  onViewportChange,
  initialBounds,
  onOpenClusterList,
  spotlightMask,
  tripLinks,
  focusedMapPostId,
  focusedPlaces,
  focusedCountryCodes,
  focusedUnpinnedCountryCodes,
  setFocusedMapPostId,
  focusedMapPost,
  setViewPostId,
  goToUserProfile,
  initials,
  getDateLabel,
  getDestinationLabel,
}: FeedMapViewProps) {
  // DEBUG ONLY — live zoom readout under the map, for tuning the zoom thresholds that
  // gate ghost markers and trip links. Delete this state, the onZoomChange prop and the
  // readout below to remove it.
  const [debugZoom, setDebugZoom] = useState<number | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <div className="px-1">
        <h1 className="text-lg font-bold text-slate-900">Where trips are happening</h1>
        <p className="text-xs text-slate-500">
          {totalCount > 0
            ? `${totalCount} ${totalCount === 1 ? "trip" : "trips"} match your filters. Tap a group to zoom into it.`
            : "Tap someone's photo to see where they're heading."}
        </p>
      </div>

      <div className="relative h-[420px] overflow-hidden rounded-2xl border border-slate-200">
        <TripMap
          isVisible={isVisible}
          clusters={clusters}
          focusedPostId={focusedMapPostId}
          focusedPlaces={focusedPlaces}
          focusedCountryCodes={focusedCountryCodes}
          focusedUnpinnedCountryCodes={focusedUnpinnedCountryCodes}
          onSelectPost={(id) => setFocusedMapPostId(id)}
          onOpenClusterList={onOpenClusterList}
          spotlightMask={spotlightMask}
          tripLinks={tripLinks}
          onViewportChange={onViewportChange}
          onZoomChange={setDebugZoom}
          initialBounds={initialBounds}
        />

        {/* Keyed off the focused *id*, not the loaded post: focus mode hides every other
            marker, so the close button is the only way back to the full map. Waiting for
            the post's details to arrive before rendering it means a slow or failed fetch
            leaves the user stranded on a map showing one trip and no way out. */}
        {focusedMapPostId && (
          <div className="pointer-events-none absolute inset-x-3 top-3 z-10">
            <div
              role={focusedMapPost ? "button" : undefined}
              tabIndex={focusedMapPost ? 0 : undefined}
              onClick={() => focusedMapPost && setViewPostId(focusedMapPost.id)}
              onKeyDown={(e) => {
                if (focusedMapPost && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  setViewPostId(focusedMapPost.id);
                }
              }}
              className={`pointer-events-auto flex items-center gap-3 rounded-2xl bg-white p-3 shadow-lg ring-1 ring-slate-200 transition ${
                focusedMapPost ? "active:scale-[0.99]" : ""
              }`}
            >
              {focusedMapPost ? (
                <>
                  <button
                    type="button"
                    onClick={(e) => goToUserProfile(focusedMapPost.userId, e)}
                    aria-label={`View ${focusedMapPost.user.name}'s profile`}
                    className="shrink-0 rounded-full transition active:scale-95"
                  >
                    <Avatar
                      url={focusedMapPost.user.avatarUrl}
                      initials={initials(focusedMapPost.user.name)}
                      colorClass={focusedMapPost.user.avatarColor}
                      className="h-10 w-10 text-xs"
                    />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-900">
                      {getDestinationLabel(focusedMapPost.destinations)}
                    </p>
                    <p className="truncate text-xs text-slate-500">{getDateLabel(focusedMapPost.date, true)}</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-slate-100" />
                  <div className="min-w-0 flex-1">
                    <div className="h-3.5 w-2/3 animate-pulse rounded bg-slate-100" />
                    <div className="mt-1.5 h-3 w-1/3 animate-pulse rounded bg-slate-100" />
                  </div>
                </>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setFocusedMapPostId(null);
                }}
                aria-label="Close preview"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition active:bg-slate-200"
              >
                <IconX className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
      {/* Says so out loud when the viewport holds more than the server will return, rather
          than quietly showing a subset — the failure the old feed-derived map had. */}
      <p className="px-1 text-center text-xs text-slate-400">
        {overviewMode
          ? "Too many trips in view to place individually — zoom in for exact pins."
          : focusedMapPostId
            ? "Showing this trip's destinations only — close the card to see everyone again."
            : "Tap someone's photo to preview their trip and message on WhatsApp."}
      </p>
      {/* DEBUG ONLY — see debugZoom above. */}
      <p className="px-1 text-center font-mono text-[11px] text-slate-400">
        zoom {debugZoom === null ? "—" : debugZoom.toFixed(2)}
      </p>
    </div>
  );
}

export default FeedMapView;
