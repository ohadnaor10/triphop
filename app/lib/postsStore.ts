"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { INITIAL_POSTS } from "../data/mockPosts";
import type { Destination, FocusedDestination, Gender, Post, SearchDestination, TripDate, TripVibe } from "../page";
import { postMatchesDestinationSearch, warmGeocode } from "./geo";
import { hasActiveDateSearch, rankByRelevance, type DateSearchInput } from "./relevance";
import { useClerkSupabaseClient } from "./supabase/useClerkSupabaseClient";
import { SUPABASE_CONFIGURED } from "./supabase/configured";

const AVATAR_COLORS = [
  "bg-gradient-to-br from-orange-400 to-pink-500",
  "bg-gradient-to-br from-sky-400 to-indigo-500",
  "bg-gradient-to-br from-emerald-400 to-teal-500",
  "bg-gradient-to-br from-fuchsia-400 to-purple-500",
];

function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export type PostInput = {
  destinations: Destination[];
  date: TripDate;
  vibes: TripVibe[];
  bio: string;
  shareContact: boolean;
};

// Everything app/page.tsx's search bar / filter row can constrain the feed by. Passed
// into usePostsStore so filtering can happen where the data actually lives — the
// Supabase-backed store sends this straight to the search_posts() RPC (see
// supabase/migrations/0013_search_posts_rpc.sql); the mock store applies the same
// matching logic locally, client-side, since it only ever holds a handful of posts.
export type PostsFilters = {
  destinations: SearchDestination[];
  vibe: TripVibe | "All";
  gender: Gender | "All";
  ageMin: string;
  ageMax: string;
  savedOnly: boolean;
  /** Null unless a date search has actually been applied (see page.tsx's appliedDateSearch). */
  dateSearch: DateSearchInput | null;
};

export type PostsStore = {
  posts: Post[];
  savedPostIds: Set<string>;
  loading: boolean;
  /** True while more posts exist beyond what's currently loaded. */
  hasMore: boolean;
  /** True while a loadMore() request is in flight. */
  loadingMore: boolean;
  /** Fetches the next page of older posts and appends them. No-op if already loading or hasMore is false. */
  loadMore: () => Promise<void>;
  /** Returns an error message on failure, or null on success. */
  addPost: (input: PostInput) => Promise<string | null>;
  /** Returns an error message on failure, or null on success. */
  editPost: (id: string, input: PostInput) => Promise<string | null>;
  removePost: (id: string) => Promise<void>;
  toggleSaved: (postId: string) => Promise<void>;
  /** Contact number is never included in the public feed — fetched on demand, only for signed-in callers. */
  revealContact: (postId: string) => Promise<string | null>;
};

// Feed posts are paginated by created_at cursor rather than offset: offset pagination
// shifts under newly-created posts (they land at the top, pushing the whole window down
// a slot), which would skip or duplicate rows across pages. PAGE_SIZE is a compromise
// between request count and per-request payload/render cost for a card-per-post feed.
const PAGE_SIZE = 20;

// SUPABASE_CONFIGURED is fixed for the lifetime of the build (an env var, not state),
// so resolving which hook to use at module scope keeps each one's call order stable —
// unlike branching inside a function body, which react-hooks/rules-of-hooks flags.
export const usePostsStore: (filters: PostsFilters) => PostsStore = SUPABASE_CONFIGURED
  ? useSupabasePostsStore
  : useMockPostsStore;

// ---------- Mock store (pre-Supabase-setup fallback) ----------

function useMockPostsStore(filters: PostsFilters): PostsStore {
  const { currentUser } = useAuth();
  const [posts, setPosts] = useState<Post[]>(INITIAL_POSTS);
  const [savedPostIds, setSavedPostIds] = useState<Set<string>>(new Set());

  // Cross-border spatial matching (e.g. search "Alps" vs a post in "France") needs bbox
  // data postMatchesDestinationSearch() can't fetch itself (it's pure/sync). Warm the
  // geocode cache for the active "place" search terms plus every country appearing in
  // posts, in the background — once populated, bumping geoWarmTick lets bbox-based
  // matches surface without ever blocking the filter computation on a network round-trip.
  const [geoWarmTick, setGeoWarmTick] = useState(0);
  useEffect(() => {
    const placeNames = filters.destinations.filter((d) => d.type === "place").map((d) => d.name);
    if (placeNames.length === 0) return;
    const countryNames = [
      ...new Set(
        posts
          .flatMap((p) => p.destinations)
          .filter((d): d is FocusedDestination => d.mode === "focused")
          .map((d) => d.country),
      ),
    ];
    let cancelled = false;
    Promise.all([...placeNames, ...countryNames].map((name) => warmGeocode(name))).then(() => {
      if (!cancelled) setGeoWarmTick((t) => t + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [filters.destinations, posts]);

  const filteredPosts = useMemo(() => {
    const base = posts.filter((post) => {
      const matchesRegion = postMatchesDestinationSearch(post.destinations, filters.destinations);
      const matchesVibe = filters.vibe === "All" || post.vibes.includes(filters.vibe);
      const matchesGender = filters.gender === "All" || post.user.gender === filters.gender;
      const ageMin = filters.ageMin.trim() === "" ? null : Number(filters.ageMin);
      const ageMax = filters.ageMax.trim() === "" ? null : Number(filters.ageMax);
      const matchesAge = (ageMin === null || post.user.age >= ageMin) && (ageMax === null || post.user.age <= ageMax);
      const matchesSaved = !filters.savedOnly || savedPostIds.has(post.id);
      return matchesRegion && matchesVibe && matchesGender && matchesAge && matchesSaved;
    });

    if (!filters.dateSearch || !hasActiveDateSearch(filters.dateSearch)) return base;
    return rankByRelevance(base, filters.dateSearch, (post) => post.date);
    // geoWarmTick isn't read directly — it forces a recompute once warmGeocode() has
    // populated the bbox cache that postMatchesDestinationSearch reads synchronously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts, filters, savedPostIds, geoWarmTick]);

  const addPost = useCallback(
    async (input: PostInput) => {
      if (!currentUser) return "Not signed in";
      const newPost: Post = {
        id: crypto.randomUUID(),
        userId: currentUser.id,
        user: {
          name: currentUser.name,
          age: 0,
          gender: "Male" as Gender,
          avatarColor: colorFor(currentUser.id),
          avatarUrl: currentUser.avatarUrl,
        },
        destinations: input.destinations,
        date: input.date,
        vibes: input.vibes,
        bio: input.bio,
        // No Supabase backing in this fallback store, so there's no saved-number check
        // or get_post_contact() to route through — the opt-in checkbox exists but has
        // nothing real to reveal here.
        whatsapp: "",
        shareContact: input.shareContact,
        createdAt: new Date().toISOString(),
      };
      setPosts((prev) => [newPost, ...prev]);
      return null;
    },
    [currentUser],
  );

  const editPost = useCallback(async (id: string, input: PostInput) => {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              destinations: input.destinations,
              date: input.date,
              vibes: input.vibes,
              bio: input.bio,
              shareContact: input.shareContact,
            }
          : p,
      ),
    );
    return null;
  }, []);

  const removePost = useCallback(async (id: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== id));
    setSavedPostIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const toggleSaved = useCallback(async (postId: string) => {
    setSavedPostIds((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  }, []);

  const revealContact = useCallback(
    async (postId: string) => {
      if (!currentUser) return null;
      return posts.find((p) => p.id === postId)?.whatsapp ?? null;
    },
    [currentUser, posts],
  );

  return {
    posts: filteredPosts,
    savedPostIds,
    loading: false,
    hasMore: false,
    loadingMore: false,
    loadMore: useCallback(async () => {}, []),
    addPost,
    editPost,
    removePost,
    toggleSaved,
    revealContact,
  };
}

// ---------- Real store (Supabase-backed) ----------

function toDestinationParam(d: SearchDestination): Record<string, unknown> {
  if (d.type === "country") return { kind: "country", code: d.code };
  if (d.type === "city") return { kind: "city", name: d.name, countryCode: d.countryCode };
  if (d.type === "region") return { kind: "region", region: d.name };
  return { kind: "place", name: d.name, countryCode: d.countryCode, bbox: d.bbox };
}

// Mirrors search_posts()'s RETURNS TABLE shape (supabase/migrations/0013_search_posts_rpc.sql)
// — a flattened join of posts + profiles, plus the relevance score search_posts computed
// server-side (only meaningful, non-null, when a date search is active).
type SearchPostsRow = {
  id: string;
  user_id: string;
  destinations: Destination[];
  date: TripDate;
  vibes: TripVibe[];
  bio: string;
  share_contact: boolean;
  created_at: string;
  profile_name: string | null;
  profile_age: number | null;
  profile_gender: Gender | null;
  profile_avatar_color: string | null;
  profile_avatar_url: string | null;
  profile_about: string | null;
  relevance_score: number | null;
};

function rowToPost(row: SearchPostsRow): Post {
  return {
    id: row.id,
    userId: row.user_id,
    user: {
      name: row.profile_name ?? "Traveler",
      age: row.profile_age ?? 0,
      gender: row.profile_gender ?? "Male",
      avatarColor: row.profile_avatar_color ?? colorFor(row.user_id),
      avatarUrl: row.profile_avatar_url,
      about: row.profile_about ?? undefined,
    },
    destinations: row.destinations,
    date: row.date,
    vibes: row.vibes,
    bio: row.bio,
    whatsapp: "",
    shareContact: row.share_contact,
    createdAt: row.created_at,
  };
}

// id is a required tiebreaker, not cosmetic: multiple posts can share the exact same
// created_at (bulk-inserted rows, e.g. seed data), and created_at-only cursors silently
// drop every row sharing that value once the cursor lands on it — see
// supabase/migrations/0014_search_posts_id_tiebreak.sql.
type SearchCursor = { score: number | null; createdAt: string; id: string };

function cursorOf(row: SearchPostsRow): SearchCursor {
  return { score: row.relevance_score, createdAt: row.created_at, id: row.id };
}

function useSupabasePostsStore(filters: PostsFilters): PostsStore {
  const { currentUser } = useAuth();
  const supabase = useClerkSupabaseClient();
  const [posts, setPosts] = useState<Post[]>([]);
  const [savedPostIds, setSavedPostIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState<SearchCursor | null>(null);

  // Bumped by both refresh() and loadMore() so whichever of them is the most recently
  // *started* request wins — otherwise a stale refresh() (e.g. the redundant one-time
  // refetch that fires when Clerk's session resolves and the Supabase client gets a new
  // identity, pre-existing behavior unrelated to pagination) can resolve after a
  // loadMore() and clobber its appended page with a fresh, shorter page-1-only list.
  const requestIdRef = useRef(0);

  // Reset saves synchronously on logout (adjusting state during render, not in an
  // effect, per https://react.dev/learn/you-might-not-need-an-effect).
  const [savedForUserId, setSavedForUserId] = useState<string | null>(null);
  if ((currentUser?.id ?? null) !== savedForUserId) {
    setSavedForUserId(currentUser?.id ?? null);
    if (!currentUser) setSavedPostIds(new Set());
  }

  // hasActiveDateSearch mirrors what the client-side ranking used to check before
  // calling rankByRelevance — search_posts() only scores/ranks by date (instead of
  // plain created_at) when this is non-null.
  const activeDateSearch = filters.dateSearch && hasActiveDateSearch(filters.dateSearch) ? filters.dateSearch : null;

  const rpcParams = useMemo(
    () => ({
      p_destinations: filters.destinations.map(toDestinationParam),
      p_vibe: filters.vibe === "All" ? null : filters.vibe,
      p_gender: filters.gender === "All" ? null : filters.gender,
      p_age_min: filters.ageMin.trim() === "" ? null : Number(filters.ageMin),
      p_age_max: filters.ageMax.trim() === "" ? null : Number(filters.ageMax),
      p_saved_only: filters.savedOnly,
      p_date_search: activeDateSearch,
    }),
    [filters, activeDateSearch],
  );

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    const { data, error } = await supabase.rpc("search_posts", { ...rpcParams, p_limit: PAGE_SIZE });
    if (requestId !== requestIdRef.current) return; // superseded by a newer refresh/loadMore
    if (error) {
      console.error("Failed to search posts:", error.message);
      setLoading(false);
      return;
    }
    const rows = (data as SearchPostsRow[] | null) ?? [];
    setPosts(rows.map(rowToPost));
    setHasMore(rows.length === PAGE_SIZE);
    setCursor(rows.length > 0 ? cursorOf(rows[rows.length - 1]) : null);
    setLoading(false);
  }, [supabase, rpcParams]);

  // Re-runs whenever the filters (or the signed-in user) change, since refresh is a
  // useCallback keyed on [supabase, rpcParams]. Deferred via setTimeout rather than a
  // bare refresh() call in the effect body, per this codebase's setState-in-effect lint
  // rule (see messagesStore.ts's polling hooks for the same pattern).
  useEffect(() => {
    const kick = setTimeout(refresh, 0);
    return () => clearTimeout(kick);
  }, [refresh]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !cursor) return;
    const requestId = ++requestIdRef.current;
    setLoadingMore(true);
    const { data, error } = await supabase.rpc("search_posts", {
      ...rpcParams,
      p_cursor_score: cursor.score,
      p_cursor_created_at: cursor.createdAt,
      p_cursor_id: cursor.id,
      p_limit: PAGE_SIZE,
    });
    if (requestId !== requestIdRef.current) return; // superseded by a newer refresh/loadMore
    if (error) {
      console.error("Failed to load more posts:", error.message);
      setLoadingMore(false);
      return;
    }
    const rows = (data as SearchPostsRow[] | null) ?? [];
    setPosts((prev) => [...prev, ...rows.map(rowToPost)]);
    setHasMore(rows.length === PAGE_SIZE);
    if (rows.length > 0) {
      setCursor(cursorOf(rows[rows.length - 1]));
    }
    setLoadingMore(false);
  }, [supabase, rpcParams, cursor, hasMore, loadingMore]);

  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    supabase
      .from("saved_posts")
      .select("post_id")
      .eq("user_id", currentUser.id)
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        setSavedPostIds(new Set(data.map((row: { post_id: string }) => row.post_id)));
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser, supabase]);

  const addPost = useCallback(
    async (input: PostInput) => {
      if (!currentUser) return "Not signed in";
      const { error } = await supabase.from("posts").insert({
        user_id: currentUser.id,
        destinations: input.destinations,
        date: input.date,
        vibes: input.vibes,
        bio: input.bio,
        share_contact: input.shareContact,
      });
      if (error) {
        console.error("Failed to create post:", error);
        return error.message;
      }
      await refresh();
      return null;
    },
    [currentUser, supabase, refresh],
  );

  const editPost = useCallback(
    async (id: string, input: PostInput) => {
      const { error } = await supabase
        .from("posts")
        .update({
          destinations: input.destinations,
          date: input.date,
          vibes: input.vibes,
          bio: input.bio,
          share_contact: input.shareContact,
        })
        .eq("id", id);
      if (error) {
        console.error("Failed to update post:", error);
        return error.message;
      }
      await refresh();
      return null;
    },
    [supabase, refresh],
  );

  const removePost = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("posts").delete().eq("id", id);
      if (error) {
        console.error("Failed to delete post:", error.message);
        return;
      }
      setSavedPostIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await refresh();
    },
    [supabase, refresh],
  );

  const toggleSaved = useCallback(
    async (postId: string) => {
      if (!currentUser) return;
      if (savedPostIds.has(postId)) {
        const { error } = await supabase
          .from("saved_posts")
          .delete()
          .eq("user_id", currentUser.id)
          .eq("post_id", postId);
        if (error) {
          console.error("Failed to unsave post:", error.message);
          return;
        }
        setSavedPostIds((prev) => {
          const next = new Set(prev);
          next.delete(postId);
          return next;
        });
      } else {
        const { error } = await supabase.from("saved_posts").insert({ user_id: currentUser.id, post_id: postId });
        if (error) {
          console.error("Failed to save post:", error.message);
          return;
        }
        setSavedPostIds((prev) => new Set(prev).add(postId));
      }
      // Only the "saved only" view can actually change composition when a save is
      // toggled — skip the round trip otherwise.
      if (filters.savedOnly) await refresh();
    },
    [currentUser, savedPostIds, supabase, filters.savedOnly, refresh],
  );

  const revealContact = useCallback(
    async (postId: string) => {
      if (!currentUser) return null;
      const { data, error } = await supabase.rpc("get_post_contact", { p_post_id: postId });
      if (error || !data) {
        if (error) console.error("Failed to reveal contact:", error.message);
        return null;
      }
      return `https://wa.me/${String(data).replace(/\D/g, "")}`;
    },
    [currentUser, supabase],
  );

  return {
    posts,
    savedPostIds,
    loading,
    hasMore,
    loadingMore,
    loadMore,
    addPost,
    editPost,
    removePost,
    toggleSaved,
    revealContact,
  };
}

// ---------- "My posts" (profile page) ----------
//
// A deliberately separate, unpaginated query — unlike the public feed, one signed-in
// user's own trip posts are bounded by realistic personal usage, not the size of the
// whole table, so there's no false-empty-state risk here the way there was for the
// paginated/filtered feed (search_posts). Kept out of search_posts entirely rather than
// added as another optional filter param there, since this has none of that RPC's
// destination/date-relevance matching — it's a plain "posts where user_id = me" lookup.

export type MyPostsStore = {
  posts: Post[];
  loading: boolean;
  removePost: (id: string) => Promise<void>;
};

export const useMyPosts: () => MyPostsStore = SUPABASE_CONFIGURED ? useSupabaseMyPosts : useMockMyPosts;

const MY_POST_SELECT =
  "id, user_id, destinations, date, vibes, bio, share_contact, created_at, profiles!user_id(name, age, gender, avatar_color, avatar_url, about)";

type MyPostRow = {
  id: string;
  user_id: string;
  destinations: Destination[];
  date: TripDate;
  vibes: TripVibe[];
  bio: string;
  share_contact: boolean;
  created_at: string;
  profiles: {
    name: string;
    age: number | null;
    gender: Gender | null;
    avatar_color: string | null;
    avatar_url: string | null;
    about: string | null;
  } | null;
};

function rowToPostFromEmbed(row: MyPostRow): Post {
  const profile = row.profiles;
  return {
    id: row.id,
    userId: row.user_id,
    user: {
      name: profile?.name ?? "Traveler",
      age: profile?.age ?? 0,
      gender: profile?.gender ?? "Male",
      avatarColor: profile?.avatar_color ?? colorFor(row.user_id),
      avatarUrl: profile?.avatar_url ?? null,
      about: profile?.about ?? undefined,
    },
    destinations: row.destinations,
    date: row.date,
    vibes: row.vibes,
    bio: row.bio,
    whatsapp: "",
    shareContact: row.share_contact,
    createdAt: row.created_at,
  };
}

function useSupabaseMyPosts(): MyPostsStore {
  const { currentUser } = useAuth();
  const supabase = useClerkSupabaseClient();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!currentUser) {
      setPosts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("posts")
      .select(MY_POST_SELECT)
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Failed to load your posts:", error.message);
      setLoading(false);
      return;
    }
    setPosts(((data as unknown as MyPostRow[] | null) ?? []).map(rowToPostFromEmbed));
    setLoading(false);
  }, [currentUser, supabase]);

  useEffect(() => {
    const kick = setTimeout(refresh, 0);
    return () => clearTimeout(kick);
  }, [refresh]);

  const removePost = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("posts").delete().eq("id", id);
      if (error) {
        console.error("Failed to delete post:", error.message);
        return;
      }
      await refresh();
    },
    [supabase, refresh],
  );

  return { posts, loading, removePost };
}

function useMockMyPosts(): MyPostsStore {
  const { currentUser } = useAuth();
  const [posts, setPosts] = useState<Post[]>(INITIAL_POSTS);

  const removePost = useCallback(async (id: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const myPosts = useMemo(() => posts.filter((p) => p.userId === currentUser?.id), [posts, currentUser]);

  return { posts: myPosts, loading: false, removePost };
}
