import type { RefObject } from "react";
import type { useRouter } from "next/navigation";
import { IconGlobe, IconGrid, IconHeart, IconMap, IconMessageCircle } from "./icons";
import ProfileMenu from "./ProfileMenu";
import type { AuthUser } from "../context/AuthContext";

export type TopNavBarProps = {
  view: "feed" | "map";
  switchToFeedView: () => void;
  switchToMapView: () => void;
  showSavedOnly: boolean;
  setShowSavedOnly: (value: boolean | ((prev: boolean) => boolean)) => void;
  currentUser: AuthUser | null;
  unreadMessageCount: number;
  router: ReturnType<typeof useRouter>;
  showProfileMenu: boolean;
  setShowProfileMenu: (value: boolean | ((prev: boolean) => boolean)) => void;
  profileMenuRef: RefObject<HTMLDivElement | null>;
  logout: () => void;
  /** Tapping the wordmark returns to the first-run hero (with a view-transition + clearing stored scroll). */
  onLogoClick: () => void;
};

// Sticky top row shown once the user has searched: wordmark/back button, feed/map
// toggle, language, saved-only, messages, auth actions and the profile menu. The
// search bar beneath it (destination/dates triggers + filters) lives in HeroSearch.
export default function TopNavBar({
  view,
  switchToFeedView,
  switchToMapView,
  showSavedOnly,
  setShowSavedOnly,
  currentUser,
  unreadMessageCount,
  router,
  showProfileMenu,
  setShowProfileMenu,
  profileMenuRef,
  logout,
  onLogoClick,
}: TopNavBarProps) {
  return (
    // Three-column grid rather than flex: the two 1fr side columns are equal by
    // definition, so the auto-width middle column (the feed/map toggle) sits on the exact
    // horizontal center of the bar no matter how wide the wordmark or the icon row get.
    <div className="mx-auto grid max-w-lg grid-cols-[1fr_auto_1fr] items-center gap-1 px-4 py-3">
      <div className="flex min-w-0 justify-start">
        <button
          type="button"
          onClick={onLogoClick}
          aria-label="Back to search"
          style={{ viewTransitionName: "logo" }}
          className="truncate text-xl font-extrabold tracking-tight text-slate-900 transition active:scale-95"
        >
          trip<span className="text-orange-500">hop</span>
        </button>
      </div>

      <div className="flex items-stretch gap-0.5 rounded-full bg-slate-100 p-0.5">
        <button
          type="button"
          onClick={switchToFeedView}
          className={`flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-semibold transition ${
            view === "feed" ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <IconGrid className="h-3.5 w-3.5" />
          Feed
        </button>
        <button
          type="button"
          onClick={switchToMapView}
          className={`flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-semibold transition ${
            view === "map" ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <IconMap className="h-3.5 w-3.5" />
          Map
        </button>
      </div>

      <div className="flex min-w-0 items-center justify-end gap-1">
        <button
          type="button"
          aria-label="Language and region"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition active:scale-95 active:bg-slate-200"
        >
          <IconGlobe className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setShowSavedOnly((v) => !v)}
          aria-label={showSavedOnly ? "Show all posts" : "Show saved posts"}
          aria-pressed={showSavedOnly}
          className={`flex h-8 w-8 items-center justify-center rounded-full transition active:scale-95 ${
            showSavedOnly ? "bg-rose-500 text-white" : "bg-slate-100 text-slate-600 active:bg-slate-200"
          }`}
        >
          <IconHeart className="h-4 w-4" filled={showSavedOnly} />
        </button>
        {currentUser && (
          <button
            type="button"
            onClick={() => router.push("/messages")}
            aria-label={unreadMessageCount > 0 ? `Messages, ${unreadMessageCount} unread` : "Messages"}
            className="relative flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition active:scale-95 active:bg-slate-200"
          >
            <IconMessageCircle className="h-4 w-4" />
            {unreadMessageCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[9px] font-bold text-white ring-2 ring-white">
                {unreadMessageCount > 9 ? "9+" : unreadMessageCount}
              </span>
            )}
          </button>
        )}
        {/* One entry point only — /sign-in covers new accounts too — styled as another
            slate-100 pill so it sits in the same row as the icon buttons beside it. */}
        {!currentUser && (
          <button
            type="button"
            onClick={() => router.push("/sign-in")}
            className="flex h-8 shrink-0 items-center rounded-full bg-slate-100 px-3 text-xs font-semibold text-slate-700 transition active:scale-95 active:bg-slate-200"
          >
            Log in
          </button>
        )}
        <ProfileMenu
          size="sm"
          currentUser={currentUser}
          showProfileMenu={showProfileMenu}
          setShowProfileMenu={setShowProfileMenu}
          profileMenuRef={profileMenuRef}
          router={router}
          logout={logout}
        />
      </div>
    </div>
  );
}
