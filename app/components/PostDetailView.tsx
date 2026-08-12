import dynamic from "next/dynamic";
import type { useRouter } from "next/navigation";
import {
  IconCalendar,
  IconChevronLeft,
  IconEdit,
  IconHeart,
  IconMap,
  IconMapPin,
  IconMessageCircle,
  IconTrash,
  IconWhatsApp,
  IconX,
} from "./icons";
import type { DestinationPoint } from "./TripDestinationsMap";
import Avatar from "./Avatar";
import type { AuthUser } from "../context/AuthContext";
import type { Gender, Post, TripVibe } from "../page";

const TripDestinationsMap = dynamic(() => import("./TripDestinationsMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-slate-400">Loading map…</div>
  ),
});

export type ViewedProfile = {
  name: string;
  age: number | null;
  gender: Gender | null;
  avatarColor: string | null;
  avatarUrl: string | null;
  about: string | null;
};

export type PostDetailViewProps = {
  viewPost: Post;
  viewPostDestinationChips: { chips: string[]; moreCount: number } | null;
  currentUser: AuthUser | null;
  requireAuth: (fn: () => void) => void;
  router: ReturnType<typeof useRouter>;
  savedPostIds: Set<string>;
  toggleSavedPost: (postId: string) => void;
  startEditPost: (post: Post) => void;
  deletePost: (postId: string) => void;
  goToUserProfile: (userId: string, e?: { stopPropagation: () => void }) => void;
  revealedContact: string | null;
  revealContact: (postId: string) => Promise<string | null>;
  setRevealedContact: (contact: string | null) => void;
  onClose: () => void;
  isTripMapOpen: boolean;
  setIsTripMapOpen: (open: boolean) => void;
  tripMapPoints: DestinationPoint[];
  vibeStyles: Record<TripVibe, string>;
  initials: (name: string) => string;
  formatGender: (gender: Gender) => string;
  formatRelativeTime: (iso: string) => string;
  getDateLabel: (date: Post["date"], compact?: boolean) => string;
  getDestinationLabel: (destinations: Post["destinations"]) => string;
};

// Full-screen view for a selected post: destination chips, dates, user info, vibe
// tags, and description. Also renders the Trip Map modal (opened from "Show Trip
// Map") — tightly coupled to this view's open/close state, so it lives here as a
// sibling rather than being separately mounted from page.tsx. The User Profile
// overlay is a separate component (UserProfileOverlay below) since it's reachable
// independently of a post being open (e.g. via a /?user=<id> deep link).
export function PostDetailView({
  viewPost,
  viewPostDestinationChips,
  currentUser,
  requireAuth,
  router,
  savedPostIds,
  toggleSavedPost,
  startEditPost,
  deletePost,
  goToUserProfile,
  revealedContact,
  revealContact,
  setRevealedContact,
  onClose,
  isTripMapOpen,
  setIsTripMapOpen,
  tripMapPoints,
  vibeStyles,
  initials,
  formatGender,
  formatRelativeTime,
  getDateLabel,
  getDestinationLabel,
}: PostDetailViewProps) {
  return (
    <>
      <div className="fixed inset-0 z-[1200] flex justify-center bg-white sm:items-center sm:bg-slate-900/40 sm:p-4">
        <div className="flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white sm:h-auto sm:max-h-[90dvh] sm:rounded-3xl sm:shadow-2xl">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/90 px-4 py-3 backdrop-blur-md">
            <h2 className="text-sm font-bold text-slate-900">Trip details</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsTripMapOpen(true)}
                className="flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition active:scale-95"
              >
                <IconMap className="h-3.5 w-3.5" />
                Show Trip Map
              </button>
              {currentUser && viewPost.userId === currentUser.id && (
                <>
                  <button
                    type="button"
                    onClick={() => startEditPost(viewPost)}
                    aria-label="Edit trip"
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:text-slate-900 active:scale-90"
                  >
                    <IconEdit className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm("Delete this trip post?")) deletePost(viewPost.id);
                    }}
                    aria-label="Delete trip"
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:text-rose-600 active:scale-90"
                  >
                    <IconTrash className="h-4 w-4" />
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => toggleSavedPost(viewPost.id)}
                aria-label={savedPostIds.has(viewPost.id) ? "Remove from saved" : "Save trip"}
                aria-pressed={savedPostIds.has(viewPost.id)}
                className={`flex h-8 w-8 items-center justify-center rounded-full transition active:scale-90 ${
                  savedPostIds.has(viewPost.id)
                    ? "bg-rose-500 text-white"
                    : "bg-slate-100 text-slate-500 hover:text-rose-500"
                }`}
              >
                <IconHeart className="h-4 w-4" filled={savedPostIds.has(viewPost.id)} />
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  setIsTripMapOpen(false);
                }}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition active:bg-slate-200"
              >
                <IconX className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 px-5 py-5">
            {/* Destination — wrapped chips rather than one heading, so posts with many
                countries/regions read as a scannable list instead of a wall of text. */}
            <div className="flex items-start gap-2">
              <IconMapPin className="mt-1 h-5 w-5 shrink-0 text-orange-500" />
              <div className="flex flex-wrap gap-1.5">
                {viewPostDestinationChips?.chips.map((chip, i) => (
                  <span
                    key={i}
                    className="max-w-full truncate rounded-full bg-orange-50 px-3 py-1 text-sm font-bold text-orange-700 ring-1 ring-inset ring-orange-600/20"
                  >
                    {chip}
                  </span>
                ))}
                {!!viewPostDestinationChips?.moreCount && (
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-500">
                    +{viewPostDestinationChips.moreCount} more
                  </span>
                )}
              </div>
            </div>

            {/* Dates */}
            <div className="mt-2 flex items-center gap-1.5 pl-[26px] text-base font-medium text-slate-600">
              <IconCalendar className="h-4 w-4 shrink-0 text-slate-400" />
              {getDateLabel(viewPost.date)}
            </div>

            {viewPost.createdAt && (
              <p className="mt-1 pl-[26px] text-xs text-slate-400">
                Posted {formatRelativeTime(viewPost.createdAt)}
              </p>
            )}

            {/* User info */}
            <button
              type="button"
              onClick={() => goToUserProfile(viewPost.userId)}
              className="mt-5 flex w-full items-center gap-3 rounded-2xl bg-slate-50 p-3 text-left transition hover:bg-slate-100 active:scale-[0.99]"
            >
              <Avatar
                url={viewPost.user.avatarUrl}
                initials={initials(viewPost.user.name)}
                colorClass={viewPost.user.avatarColor}
                className="h-12 w-12 text-base"
              />
              <div className="min-w-0">
                <p className="text-sm text-slate-700">
                  <span className="font-semibold text-slate-900">{viewPost.user.name}</span>
                  {" · "}
                  {viewPost.user.age}
                  {" · "}
                  {formatGender(viewPost.user.gender)}
                </p>
                {viewPost.user.about && (
                  <p className="mt-0.5 text-xs italic text-slate-500">&ldquo;{viewPost.user.about}&rdquo;</p>
                )}
              </div>
            </button>

            {/* Vibe tags */}
            <div className="mt-4 flex flex-wrap gap-1.5">
              {viewPost.vibes.map((vibe) => (
                <span
                  key={vibe}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${vibeStyles[vibe]}`}
                >
                  {vibe}
                </span>
              ))}
            </div>

            {/* Description */}
            <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-slate-600">{viewPost.bio}</p>
          </div>

          {viewPost.userId !== currentUser?.id && (
            <div className="sticky bottom-0 flex items-center gap-2 border-t border-slate-100 bg-white p-4">
              <button
                type="button"
                onClick={() => requireAuth(() => router.push(`/messages/${viewPost.userId}`))}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition active:scale-[0.98] active:bg-slate-800"
              >
                <IconMessageCircle className="h-4 w-4" />
                Message
              </button>

              {viewPost.shareContact &&
                (revealedContact ? (
                  <a
                    href={revealedContact}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white transition active:scale-[0.98] active:bg-emerald-600"
                  >
                    <IconWhatsApp className="h-4 w-4" />
                    WhatsApp
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      requireAuth(() => {
                        revealContact(viewPost.id).then((contact) => setRevealedContact(contact));
                      })
                    }
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white transition active:scale-[0.98] active:bg-emerald-600"
                  >
                    <IconWhatsApp className="h-4 w-4" />
                    {currentUser ? "WhatsApp" : "Log in"}
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Trip Map modal */}
      {isTripMapOpen && (
        <div className="fixed inset-0 z-[1300] flex flex-col bg-white sm:items-center sm:justify-center sm:bg-slate-900/40 sm:p-4">
          <div className="flex h-full w-full max-w-lg flex-col overflow-hidden bg-white sm:h-[80dvh] sm:rounded-3xl sm:shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="min-w-0 truncate text-sm font-bold text-slate-900">
                {getDestinationLabel(viewPost.destinations)}
              </h2>
              <button
                type="button"
                onClick={() => setIsTripMapOpen(false)}
                aria-label="Close map"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition active:bg-slate-200"
              >
                <IconX className="h-4 w-4" />
              </button>
            </div>
            <div className="relative flex-1">
              <TripDestinationsMap points={tripMapPoints} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export type UserProfileOverlayProps = {
  viewUserId: string;
  setViewUserId: (userId: string | null) => void;
  viewedProfile: ViewedProfile | null;
  viewedProfileLoading: boolean;
  viewedUserPosts: Post[];
  setViewPostId: (postId: string | null) => void;
  requireAuth: (fn: () => void) => void;
  router: ReturnType<typeof useRouter>;
  initials: (name: string) => string;
  formatGender: (gender: Gender) => string;
  getDateLabel: (date: Post["date"], compact?: boolean) => string;
  getDestinationLabel: (destinations: Post["destinations"]) => string;
};

// Sits above the Post Detail View (z-[1200]) so opening a profile from within a
// post's user-info block layers on top rather than replacing it; closing this
// reveals whatever was open underneath untouched. Reachable independently of a post
// being open too — e.g. via a /?user=<id> deep link (see the old /users/[id] route
// redirect) — so this is a standalone component rather than nested in PostDetailView.
export function UserProfileOverlay({
  viewUserId,
  setViewUserId,
  viewedProfile,
  viewedProfileLoading,
  viewedUserPosts,
  setViewPostId,
  requireAuth,
  router,
  initials,
  formatGender,
  getDateLabel,
  getDestinationLabel,
}: UserProfileOverlayProps) {
  return (
    <div className="fixed inset-0 z-[1250] flex justify-center bg-white sm:items-center sm:bg-slate-900/40 sm:p-4">
      <div className="flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white sm:h-auto sm:max-h-[90dvh] sm:rounded-3xl sm:shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-100 bg-white/90 px-4 py-3 backdrop-blur-md">
          <button
            type="button"
            onClick={() => setViewUserId(null)}
            aria-label="Back"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition active:scale-95 active:bg-slate-200"
          >
            <IconChevronLeft className="h-4 w-4" />
          </button>
          <h2 className="text-sm font-bold text-slate-900">Profile</h2>
        </div>

        <div className="flex-1 px-5 py-5">
          {viewedProfileLoading ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : !viewedProfile ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
              This traveler couldn&apos;t be found.
            </div>
          ) : (
            <>
              <div className="flex flex-col items-center gap-3 text-center">
                <Avatar
                  url={viewedProfile.avatarUrl}
                  initials={initials(viewedProfile.name)}
                  colorClass={viewedProfile.avatarColor ?? undefined}
                  className="h-20 w-20 text-2xl"
                />
                <div>
                  <p className="text-lg font-bold text-slate-900">{viewedProfile.name}</p>
                  {(viewedProfile.age !== null || viewedProfile.gender) && (
                    <p className="text-sm text-slate-500">
                      {[viewedProfile.age, viewedProfile.gender ? formatGender(viewedProfile.gender) : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                </div>
                {viewedProfile.about && (
                  <p className="text-sm italic leading-relaxed text-slate-600">&ldquo;{viewedProfile.about}&rdquo;</p>
                )}
                <button
                  type="button"
                  onClick={() => requireAuth(() => router.push(`/messages/${viewUserId}`))}
                  className="mt-1 flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition active:scale-95 active:bg-slate-800"
                >
                  <IconMessageCircle className="h-4 w-4" />
                  Message
                </button>
              </div>

              <div className="mt-6">
                <h3 className="px-1 text-sm font-bold text-slate-900">
                  {viewedProfile.name.split(" ")[0]}&apos;s posts
                </h3>
                <div className="mt-2 flex flex-col gap-3">
                  {viewedUserPosts.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
                      No trips posted yet.
                    </div>
                  )}
                  {viewedUserPosts.map((post) => (
                    <button
                      key={post.id}
                      type="button"
                      onClick={() => {
                        setViewUserId(null);
                        setViewPostId(post.id);
                      }}
                      className="rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200 transition hover:shadow-md active:scale-[0.99]"
                    >
                      <div className="flex min-w-0 items-start gap-1.5">
                        <IconMapPin className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
                        <h4 className="min-w-0 truncate text-sm font-bold text-slate-900">
                          {getDestinationLabel(post.destinations)}
                        </h4>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 pl-[22px] text-xs text-slate-500">
                        <IconCalendar className="h-3.5 w-3.5 shrink-0" />
                        {getDateLabel(post.date, true)}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
