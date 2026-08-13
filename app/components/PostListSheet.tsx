"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "./Avatar";
import { IconX } from "./icons";
import type { Post } from "../page";

export type PostListSheetProps = {
  /** Heading for the list — the cluster's dominant place, or "Anywhere in <country>". */
  title: string;
  subtitle: string;
  posts: Post[];
  loading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  onClose: () => void;
  /** Focuses that post on the map. The sheet closes, and reopens where it left off on return. */
  onSelectPost: (postId: string) => void;
  initials: (name: string) => string;
  getDateLabel: (date: Post["date"], compact?: boolean) => string;
  getDestinationLabel: (destinations: Post["destinations"]) => string;
  /** Scroll offset to restore, so returning from a post lands where the user left. */
  initialScrollTop: number;
  onScrollChange: (scrollTop: number) => void;
};

// Bottom sheet listing the posts behind one map marker.
//
// It exists because some clusters can never be broken apart by zooming — 79 posts sharing
// Bangkok's single coordinate stay one bubble at any zoom — so "tap to zoom in" is a dead
// end and the posts inside are otherwise unreachable. The same sheet lists a country's
// cityless posts, which have the same problem for a different reason.
//
// A sheet rather than a full-screen overlay: the map above stays visible and interactive,
// so the list keeps the spatial context it came from.
const COLLAPSED_HEIGHT_VH = 60;
const EXPANDED_HEIGHT_VH = 92;
// Past this much drag the gesture is treated as intent rather than a twitch.
const DRAG_COMMIT_PX = 60;

export default function PostListSheet({
  title,
  subtitle,
  posts,
  loading,
  hasMore,
  loadMore,
  onClose,
  onSelectPost,
  initials,
  getDateLabel,
  getDestinationLabel,
  initialScrollTop,
  onScrollChange,
}: PostListSheetProps) {
  const [expanded, setExpanded] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const dragStartRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Restore the scroll position from before a post was opened. Layout effect timing isn't
  // needed — the list is already painted, and a one-frame jump is invisible against the
  // sheet's own entrance.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && initialScrollTop > 0) el.scrollTop = initialScrollTop;
    // Deliberately runs once per mount: re-running on every scroll would fight the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Infinite scroll, same sentinel-free approach the sheet can afford: the list is short
  // enough that a scroll handler is cheaper than an observer, and it doubles as the
  // scroll-position reporter.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    onScrollChange(el.scrollTop);
    if (!hasMore || loading) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) loadMore();
  }, [hasMore, loading, loadMore, onScrollChange]);

  const onDragStart = (clientY: number) => {
    dragStartRef.current = clientY;
  };

  const onDragMove = (clientY: number) => {
    if (dragStartRef.current === null) return;
    setDragOffset(clientY - dragStartRef.current);
  };

  const onDragEnd = () => {
    const offset = dragOffset;
    dragStartRef.current = null;
    setDragOffset(0);
    if (offset > DRAG_COMMIT_PX) {
      // Dragging down collapses an expanded sheet first, and only closes it once it is
      // already at its smaller height — so a single flick can't skip a step.
      if (expanded) setExpanded(false);
      else onClose();
    } else if (offset < -DRAG_COMMIT_PX) {
      setExpanded(true);
    }
  };

  const height = expanded ? EXPANDED_HEIGHT_VH : COLLAPSED_HEIGHT_VH;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={title}
      style={{
        height: `${height}dvh`,
        transform: dragOffset > 0 ? `translateY(${dragOffset}px)` : undefined,
      }}
      className="fixed inset-x-0 bottom-0 z-[1200] flex flex-col rounded-t-3xl border-t border-slate-200 bg-white shadow-[0_-8px_30px_rgba(15,23,42,0.18)] transition-[height] duration-200"
    >
      {/* Drag handle. Touch events only — the X covers pointer users, and mouse-dragging a
          sheet is not an interaction anyone expects on desktop. */}
      <div
        onTouchStart={(e) => onDragStart(e.touches[0].clientY)}
        onTouchMove={(e) => onDragMove(e.touches[0].clientY)}
        onTouchEnd={onDragEnd}
        className="shrink-0 cursor-grab px-4 pb-1 pt-2.5 active:cursor-grabbing"
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-slate-300" />
      </div>

      <div className="flex shrink-0 items-start gap-3 px-4 pb-2 pt-1">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-bold text-slate-900">{title}</h2>
          <p className="truncate text-xs text-slate-500">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close list"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition active:bg-slate-200"
        >
          <IconX className="h-4 w-4" />
        </button>
      </div>

      <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]">
        {posts.map((post) => (
          <button
            key={post.id}
            type="button"
            onClick={() => onSelectPost(post.id)}
            className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition active:bg-slate-50"
          >
            <Avatar
              url={post.user.avatarUrl}
              initials={initials(post.user.name)}
              colorClass={post.user.avatarColor}
              className="h-10 w-10 shrink-0 text-xs"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-slate-900">{getDestinationLabel(post.destinations)}</p>
              <p className="truncate text-xs text-slate-500">{getDateLabel(post.date, true)}</p>
              <p className="truncate text-[11px] text-slate-400">
                {post.user.name} · {post.user.age}
              </p>
            </div>
          </button>
        ))}

        {loading && <p className="px-3 py-4 text-center text-xs text-slate-400">Loading…</p>}
        {!loading && posts.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-slate-400">No trips to show here.</p>
        )}
      </div>
    </div>
  );
}
