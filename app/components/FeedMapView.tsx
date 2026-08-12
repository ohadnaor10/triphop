import dynamic from "next/dynamic";
import { IconX } from "./icons";
import type { FeedMapPost } from "./TripMap";
import Avatar from "./Avatar";
import type { Post } from "../page";

const TripMap = dynamic(() => import("./TripMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-slate-400">Loading map…</div>
  ),
});

export type FeedMapViewProps = {
  mapMarkers: FeedMapPost[];
  activeFocusedMapPostId: string | null;
  setFocusedMapPostId: (id: string | null) => void;
  focusedMapPost: Post | null;
  setViewPostId: (id: string | null) => void;
  goToUserProfile: (userId: string, e?: { stopPropagation: () => void }) => void;
  initials: (name: string) => string;
  getDateLabel: (date: Post["date"], compact?: boolean) => string;
  getDestinationLabel: (destinations: Post["destinations"]) => string;
};

export function FeedMapView({
  mapMarkers,
  activeFocusedMapPostId,
  setFocusedMapPostId,
  focusedMapPost,
  setViewPostId,
  goToUserProfile,
  initials,
  getDateLabel,
  getDestinationLabel,
}: FeedMapViewProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="px-1">
        <h1 className="text-lg font-bold text-slate-900">Where trips are happening</h1>
        <p className="text-xs text-slate-500">Tap a pin to see who&apos;s heading there.</p>
      </div>

      <div className="relative h-[420px] overflow-hidden rounded-2xl border border-slate-200">
        <TripMap
          posts={mapMarkers}
          focusedPostId={activeFocusedMapPostId}
          onSelectPost={(id) => setFocusedMapPostId(id)}
        />

        {focusedMapPost && (
          <div className="pointer-events-none absolute inset-x-3 top-3 z-10">
            <div
              role="button"
              tabIndex={0}
              onClick={() => setViewPostId(focusedMapPost.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setViewPostId(focusedMapPost.id);
                }
              }}
              className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-white p-3 shadow-lg ring-1 ring-slate-200 transition active:scale-[0.99]"
            >
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
      <p className="px-1 text-center text-xs text-slate-400">
        Tap a pin to preview that trip and message on WhatsApp.
      </p>
    </div>
  );
}

export default FeedMapView;
