import { IconCalendar, IconEdit, IconHeart, IconMapPin, IconTrash } from "./icons";
import Avatar from "./Avatar";
import type { AuthUser } from "../context/AuthContext";
import type { Post, TripVibe } from "../page";

export type FeedListProps = {
  posts: Post[];
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreSentinelRef: (node: HTMLDivElement | null) => void;
  currentUser: AuthUser | null;
  savedPostIds: Set<string>;
  toggleSavedPost: (postId: string) => void;
  startEditPost: (post: Post) => void;
  deletePost: (postId: string) => void;
  setViewPostId: (id: string | null) => void;
  goToUserProfile: (userId: string, e?: { stopPropagation: () => void }) => void;
  vibeStyles: Record<TripVibe, string>;
  initials: (name: string) => string;
  formatGender: (gender: Post["user"]["gender"]) => string;
  getDateLabel: (date: Post["date"], compact?: boolean) => string;
  getDestinationLabel: (destinations: Post["destinations"]) => string;
};

export function FeedList({
  posts,
  loading,
  hasMore,
  loadingMore,
  loadMoreSentinelRef,
  currentUser,
  savedPostIds,
  toggleSavedPost,
  startEditPost,
  deletePost,
  setViewPostId,
  goToUserProfile,
  vibeStyles,
  initials,
  formatGender,
  getDateLabel,
  getDestinationLabel,
}: FeedListProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="px-1">
        <h1 className="text-lg font-bold text-slate-900">Trips looking for a travel partner</h1>
        <p className="text-xs text-slate-500">Browse trips and reach out to plan together.</p>
      </div>

      {loading && posts.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
          Loading trips…
        </div>
      )}

      {!loading && posts.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
          No trips match your filters yet.
        </div>
      )}

      {posts.map((post) => (
        <div
          key={post.id}
          role="button"
          tabIndex={0}
          onClick={() => setViewPostId(post.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setViewPostId(post.id);
            }
          }}
          className="relative overflow-hidden rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200 transition hover:shadow-md active:scale-[0.99]"
        >
          <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
            {currentUser && post.userId === currentUser.id && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    startEditPost(post);
                  }}
                  aria-label="Edit trip"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-slate-400 ring-1 ring-slate-200 transition hover:text-slate-700 active:scale-90"
                >
                  <IconEdit className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm("Delete this trip post?")) deletePost(post.id);
                  }}
                  aria-label="Delete trip"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-slate-400 ring-1 ring-slate-200 transition hover:text-rose-600 active:scale-90"
                >
                  <IconTrash className="h-4 w-4" />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleSavedPost(post.id);
              }}
              aria-label={savedPostIds.has(post.id) ? "Remove from saved" : "Save trip"}
              className={`flex h-8 w-8 items-center justify-center rounded-full transition active:scale-90 ${
                savedPostIds.has(post.id)
                  ? "bg-rose-500 text-white"
                  : "bg-white/90 text-slate-400 ring-1 ring-slate-200 hover:text-rose-500"
              }`}
            >
              <IconHeart className="h-4 w-4" filled={savedPostIds.has(post.id)} />
            </button>
          </div>

          {/* 1. Destination — primary header */}
          <div
            className={`flex min-w-0 items-start gap-1.5 ${
              currentUser && post.userId === currentUser.id ? "pr-28" : "pr-9"
            }`}
          >
            <IconMapPin className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
            <h3 className="min-w-0 truncate text-lg font-bold leading-snug text-slate-900">
              {getDestinationLabel(post.destinations)}
            </h3>
          </div>

          {/* 2. Dates / timing — secondary header */}
          <div className="mt-1 flex min-w-0 items-center gap-1.5 pl-[22px] text-sm font-medium text-slate-600">
            <IconCalendar className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="truncate">{getDateLabel(post.date, true)}</span>
          </div>

          {/* 3. User info */}
          <button
            type="button"
            onClick={(e) => goToUserProfile(post.userId, e)}
            className="mt-3 flex items-center gap-2.5 text-left transition active:opacity-70"
          >
            <Avatar
              url={post.user.avatarUrl}
              initials={initials(post.user.name)}
              colorClass={post.user.avatarColor}
              className="h-9 w-9 text-xs"
            />
            <p className="truncate text-sm text-slate-700">
              <span className="font-semibold text-slate-900">{post.user.name}</span>
              {" · "}
              {post.user.age}
              {" · "}
              {formatGender(post.user.gender)}
            </p>
          </button>

          {/* 4. Style / vibe tags */}
          <div className="mt-3 flex flex-nowrap gap-1.5 overflow-hidden">
            {post.vibes.map((vibe) => (
              <span
                key={vibe}
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${vibeStyles[vibe]}`}
              >
                {vibe}
              </span>
            ))}
          </div>

          {/* 5. Description */}
          <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-slate-600">{post.bio}</p>
        </div>
      ))}

      {hasMore && (
        <div ref={loadMoreSentinelRef} className="flex justify-center py-4 text-xs text-slate-400">
          {loadingMore ? "Loading more trips…" : ""}
        </div>
      )}
    </div>
  );
}

export default FeedList;
