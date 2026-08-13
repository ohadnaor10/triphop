"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Post } from "../page";
import type { MapLocation } from "./cluster";
import { colorFor, type PostsFilters } from "./postsStore";
import { hasActiveDateSearch } from "./relevance";
import { useClerkSupabaseClient } from "./supabase/useClerkSupabaseClient";

// The map's own data source, deliberately independent of usePostsStore: the map paginates
// over space (what's in the viewport) where the feed paginates over time (how far you've
// scrolled), so sharing one store is what made the map's contents depend on feed scroll
// depth in the first place.

export type MapTier = "region" | "country" | "place" | "post";

/** An already-grouped marker from the server, used only in the over-cap overview mode. */
export type MapAggregate = {
  tier: MapTier;
  key: string;
  label: string;
  lat: number;
  lng: number;
  postCount: number;
};

export type MapViewport = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
  zoom: number;
};

/** One country's worth of posts that named the country but no city. */
export type MapGhost = {
  countryCode: string;
  countryName: string;
  postCount: number;
  singlePostId: string | null;
  singleAuthorName: string | null;
  singleAuthorAvatarUrl: string | null;
  singleAuthorAvatarColor: string | null;
};

export type MapPointsStore = {
  /**
   * Raw one-row-per-(post, place) locations for the viewport. The client clusters these
   * by on-screen distance (see app/lib/cluster.ts) — the server deliberately does no
   * grouping, because how far apart two markers *look* is only knowable client-side.
   */
  locations: MapLocation[];
  /**
   * Non-null only when the viewport holds more locations than are sensible to ship, in
   * which case the server's zoom-tier aggregation stands in. Counts stay exact; only the
   * grouping gets coarser.
   */
  overview: MapAggregate[] | null;
  /**
   * Country-level markers for posts with no city. Returned for every country at once
   * (bounded by ~250 rows) rather than filtered by viewport, because their coordinates
   * are resolved on the client — the database only has bounding boxes, whose centres put
   * Thailand out in the Gulf.
   */
  ghosts: MapGhost[];
  /** Total posts the map can represent, ignoring the viewport — for honest copy. */
  totalCount: number;
  loading: boolean;
};

// Locations per viewport before falling back to server-side aggregation. Rows are two
// floats and two ids, so this is a small payload; the real limit is how many markers the
// clustering pass can chew through on a phone between gestures.
const LOCATION_CAP = 3000;
const MOVE_DEBOUNCE_MS = 300;
// Fetch a viewport this much larger than what's on screen, so short pans are served from
// the response already in hand instead of firing a request per nudge.
const BUFFER_RATIO = 0.2;

function padViewport(viewport: MapViewport): MapViewport {
  const latPad = (viewport.maxLat - viewport.minLat) * BUFFER_RATIO;
  const lngSpan =
    viewport.maxLng >= viewport.minLng
      ? viewport.maxLng - viewport.minLng
      : 360 - viewport.minLng + viewport.maxLng;
  const lngPad = lngSpan * BUFFER_RATIO;
  return {
    minLat: Math.max(-90, viewport.minLat - latPad),
    maxLat: Math.min(90, viewport.maxLat + latPad),
    minLng: viewport.minLng - lngPad,
    maxLng: viewport.maxLng + lngPad,
    zoom: viewport.zoom,
  };
}

function isInside(inner: MapViewport, outer: MapViewport): boolean {
  // Only a plain, non-wrapping comparison is treated as "covered": once either box
  // crosses the antimeridian the containment test stops being a simple inequality, and
  // wrongly claiming coverage would leave the map showing stale markers.
  if (outer.minLng > outer.maxLng || inner.minLng > inner.maxLng) return false;
  return (
    inner.minLat >= outer.minLat &&
    inner.maxLat <= outer.maxLat &&
    inner.minLng >= outer.minLng &&
    inner.maxLng <= outer.maxLng
  );
}

type LocationRow = {
  post_id: string;
  place_id: number;
  label: string;
  lat: number;
  lng: number;
  author_name: string | null;
  author_avatar_url: string | null;
  author_avatar_color: string | null;
};
type AggregateRow = { tier: MapTier; key: string; label: string; lat: number; lng: number; post_count: number };
type GhostRow = {
  country_code: string;
  country_name: string;
  post_count: number;
  single_post_id: string | null;
  single_author_name: string | null;
  single_author_avatar_url: string | null;
  single_author_avatar_color: string | null;
};

export function useMapPoints(filters: PostsFilters, viewport: MapViewport | null): MapPointsStore {
  const supabase = useClerkSupabaseClient();
  const [locations, setLocations] = useState<MapLocation[]>([]);
  const [overview, setOverview] = useState<MapAggregate[] | null>(null);
  const [ghosts, setGhosts] = useState<MapGhost[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);

  // Whichever request started most recently wins. Panning fires overlapping requests and
  // they don't come back in order — without this, a slow early response can land after a
  // fast later one and repaint the map with the area the user already left. Same guard
  // postsStore.ts uses for refresh/loadMore.
  const requestIdRef = useRef(0);
  // The padded box the current locations were fetched for, so a pan that stays inside it
  // can skip the round trip entirely. Zoom is not part of this: the server returns raw
  // locations regardless of zoom now, and re-clustering them is a pure client-side pass.
  const coverageRef = useRef<MapViewport | null>(null);

  const activeDateSearch = filters.dateSearch && hasActiveDateSearch(filters.dateSearch) ? filters.dateSearch : null;
  // Destination is absent by design — on the map, the viewport is the destination filter.
  const filterParams = {
    p_vibe: filters.vibe === "All" ? null : filters.vibe,
    p_gender: filters.gender === "All" ? null : filters.gender,
    p_age_min: filters.ageMin.trim() === "" ? null : Number(filters.ageMin),
    p_age_max: filters.ageMax.trim() === "" ? null : Number(filters.ageMax),
    p_saved_only: filters.savedOnly,
    p_date_search: activeDateSearch,
  };
  // Serialized so the fetch effect can depend on the filters' *value* rather than on a
  // fresh object identity every render.
  const filterKey = JSON.stringify(filterParams);

  // Any filter change invalidates the cached coverage — the same box now holds a
  // different set of posts.
  useEffect(() => {
    coverageRef.current = null;
  }, [filterKey]);

  const fetchPoints = useCallback(
    async (target: MapViewport) => {
      const covered = coverageRef.current;
      if (covered && isInside(target, covered)) return;

      const padded = padViewport(target);
      const requestId = ++requestIdRef.current;
      setLoading(true);

      const params = JSON.parse(filterKey) as typeof filterParams;
      const bbox = {
        p_min_lng: padded.minLng,
        p_min_lat: padded.minLat,
        p_max_lng: padded.maxLng,
        p_max_lat: padded.maxLat,
      };
      const [pointsResult, countResult, ghostResult] = await Promise.all([
        supabase.rpc("search_posts_map_points", { ...params, ...bbox, p_limit: LOCATION_CAP }),
        supabase.rpc("count_posts_map", params),
        // Not bbox-filtered: the result is one row per country at most, and the client
        // needs the whole set anyway to place them at its own label points.
        supabase.rpc("search_posts_map_country_ghosts", params),
      ]);

      if (requestId !== requestIdRef.current) return; // superseded by a newer viewport

      if (pointsResult.error) {
        console.error("Failed to load map locations:", pointsResult.error.message);
        setLoading(false);
        return;
      }

      const rows = (pointsResult.data as LocationRow[] | null) ?? [];

      if (!ghostResult.error) {
        setGhosts(
          ((ghostResult.data as GhostRow[] | null) ?? []).map((row) => ({
            countryCode: row.country_code,
            countryName: row.country_name,
            postCount: Number(row.post_count),
            singlePostId: row.single_post_id,
            singleAuthorName: row.single_author_name,
            singleAuthorAvatarUrl: row.single_author_avatar_url,
            singleAuthorAvatarColor: row.single_author_avatar_color,
          })),
        );
      }

      if (rows.length >= LOCATION_CAP) {
        // Too dense to ship in full. Rather than clustering a truncated sample — which
        // would render confident-looking counts computed from part of the data — hand
        // over to the server's tiered aggregation, whose counts are exact.
        const aggregateResult = await supabase.rpc("search_posts_map", {
          ...params,
          ...bbox,
          p_zoom: target.zoom,
          p_limit: 500,
        });
        if (requestId !== requestIdRef.current) return;
        const aggregates = (aggregateResult.data as AggregateRow[] | null) ?? [];
        setOverview(
          aggregates.map((row) => ({
            tier: row.tier,
            key: row.key,
            label: row.label,
            lat: row.lat,
            lng: row.lng,
            postCount: Number(row.post_count),
          })),
        );
        setLocations([]);
      } else {
        setOverview(null);
        setLocations(
          rows.map((row) => ({
            kind: "place" as const,
            postId: row.post_id,
            placeId: String(row.place_id),
            label: row.label,
            lat: row.lat,
            lng: row.lng,
            postCount: 1,
            authorName: row.author_name ?? "Traveler",
            authorAvatarUrl: row.author_avatar_url,
            authorAvatarColor: row.author_avatar_color,
          })),
        );
      }

      if (!countResult.error) setTotalCount(Number(countResult.data ?? 0));
      coverageRef.current = padded;
      setLoading(false);
    },
    [supabase, filterKey],
  );

  // Debounced so a continuous drag results in one request at the end, not one per frame.
  useEffect(() => {
    if (!viewport) return;
    const timer = setTimeout(() => fetchPoints(viewport), MOVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [viewport, fetchPoints]);

  return { locations, overview, ghosts, totalCount, loading };
}

/**
 * What a list sheet is showing. Two shapes, because the two cases know their membership
 * differently: a cluster carries the ids of the posts merged into it, while a country
 * ghost knows only its country — the map never receives the individual posts behind it.
 */
export type PostListSource =
  | { kind: "cluster"; title: string; postIds: string[] }
  | { kind: "country"; title: string; countryCode: string; postCount: number };

export type PostListStore = {
  posts: Post[];
  loading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  total: number;
};

const LIST_PAGE_SIZE = 20;

// Posts behind an open list sheet, paged like the feed so a 79-post cluster shows its
// first rows immediately instead of waiting on the whole set.
//
// Paging state lives in refs rather than state deliberately: the sheet must keep its
// scroll position when the user opens a post and comes back, and a page counter in state
// would reset the list on every re-render of the parent.
export function usePostList(source: PostListSource | null, filters: PostsFilters): PostListStore {
  const supabase = useClerkSupabaseClient();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const activeDateSearch = filters.dateSearch && hasActiveDateSearch(filters.dateSearch) ? filters.dateSearch : null;
  const filterKey = JSON.stringify({
    p_vibe: filters.vibe === "All" ? null : filters.vibe,
    p_gender: filters.gender === "All" ? null : filters.gender,
    p_age_min: filters.ageMin.trim() === "" ? null : Number(filters.ageMin),
    p_age_max: filters.ageMax.trim() === "" ? null : Number(filters.ageMax),
    p_saved_only: filters.savedOnly,
    p_date_search: activeDateSearch,
  });

  // Identity of the list itself: same list, same key, no reload.
  const sourceKey = source
    ? source.kind === "cluster"
      ? `cluster:${source.postIds.join(",")}`
      : `country:${source.countryCode}`
    : null;

  const requestIdRef = useRef(0);
  const loadedCountRef = useRef(0);
  const total = source ? (source.kind === "cluster" ? source.postIds.length : source.postCount) : 0;

  const fetchPage = useCallback(
    async (offset: number) => {
      if (!source) return;
      const requestId = ++requestIdRef.current;
      setLoading(true);

      let fetched: Post[] = [];
      if (source.kind === "cluster") {
        // The ids are already in hand, so a page is a slice of them — no reason to make
        // the database re-derive membership it never computed in the first place.
        const pageIds = source.postIds.slice(offset, offset + LIST_PAGE_SIZE);
        if (pageIds.length > 0) {
          const { data, error } = await supabase
            .from("posts")
            .select(
              "id, user_id, destinations, date, vibes, bio, share_contact, created_at, profiles!posts_user_id_fkey(name, age, gender, avatar_color, avatar_url, about)",
            )
            .in("id", pageIds)
            .order("created_at", { ascending: false });
          if (error) console.error("Failed to load cluster posts:", error.message);
          fetched = ((data as unknown as PostRow[] | null) ?? []).map(postRowToPost);
        }
      } else {
        const { data, error } = await supabase.rpc("list_country_ghost_posts", {
          ...(JSON.parse(filterKey) as Record<string, unknown>),
          p_country_code: source.countryCode,
          p_limit: LIST_PAGE_SIZE,
          p_offset: offset,
        });
        if (error) console.error("Failed to load country posts:", error.message);
        fetched = ((data as GhostListRow[] | null) ?? []).map(ghostListRowToPost);
      }

      if (requestId !== requestIdRef.current) return; // a different list was opened
      setPosts((prev) => (offset === 0 ? fetched : [...prev, ...fetched]));
      loadedCountRef.current = offset + fetched.length;
      setHasMore(loadedCountRef.current < total);
      setLoading(false);
    },
    [source, supabase, filterKey, total],
  );

  // Only the first page is loaded automatically; the sheet asks for the rest as it is
  // scrolled. setState happens inside the async call, never synchronously in the effect.
  useEffect(() => {
    if (!sourceKey) return;
    loadedCountRef.current = 0;
    // Deferred rather than called inline: fetchPage flips `loading` before its first
    // await, which counts as a synchronous setState inside an effect. Same setTimeout
    // kick postsStore.ts uses for its own refresh.
    const kick = setTimeout(() => fetchPage(0), 0);
    return () => clearTimeout(kick);
    // fetchPage is keyed on the same source; depending on sourceKey alone keeps a
    // re-render of the parent from refetching the list under the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  const loadMore = useCallback(() => {
    if (loading || !hasMore) return;
    fetchPage(loadedCountRef.current);
  }, [fetchPage, loading, hasMore]);

  return { posts, loading, hasMore, loadMore, total };
}

export type FocusedPlace = { label: string; lat: number; lng: number };

type FocusedPlaceRow = { places: { name: string; lat: number; lng: number } | null };

// Every destination of the focused post, including the ones outside the current viewport.
//
// Fetched separately rather than filtered out of the loaded locations: a trip's other
// cities are frequently off-screen (that's rather the point of focusing on it), so the
// in-view set can't answer this. One small query per tap, against tables that are already
// publicly readable.
export function useFocusedPostPlaces(postId: string | null): FocusedPlace[] {
  const supabase = useClerkSupabaseClient();
  // Result and the id it belongs to are one piece of state, so "which post are these for?"
  // can be answered during render instead of being cleared by a second effect — clearing
  // it synchronously in an effect is both a cascading render and a lint error here.
  const [loaded, setLoaded] = useState<{ postId: string | null; places: FocusedPlace[] }>({
    postId: null,
    places: [],
  });

  useEffect(() => {
    if (!postId) return;
    let cancelled = false;
    supabase
      .from("post_places")
      .select("places(name, lat, lng)")
      .eq("post_id", postId)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Failed to load places for focused post:", error.message);
          return;
        }
        const rows = (data as unknown as FocusedPlaceRow[] | null) ?? [];
        setLoaded({
          postId,
          places: rows
            .map((row) => row.places)
            .filter((place): place is NonNullable<FocusedPlaceRow["places"]> => place !== null)
            .map((place) => ({ label: place.name, lat: place.lat, lng: place.lng })),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [postId, supabase]);

  // Guards against a flash of the previous post's pins while the new ones are in flight,
  // and empties the moment focus is cleared.
  return loaded.postId === postId ? loaded.places : [];
}

type PostRow = {
  id: string;
  user_id: string;
  destinations: Post["destinations"];
  date: Post["date"];
  vibes: Post["vibes"];
  bio: string;
  share_contact: boolean;
  created_at: string;
  profiles: {
    name: string | null;
    age: number | null;
    gender: Post["user"]["gender"] | null;
    avatar_color: string | null;
    avatar_url: string | null;
    about: string | null;
  } | null;
};

// The PostgREST embed shape and the RPC's flat shape carry the same post, spelled
// differently — both funnel through Post so callers never see the difference.
function postRowToPost(row: PostRow): Post {
  return {
    id: row.id,
    userId: row.user_id,
    user: {
      name: row.profiles?.name ?? "Traveler",
      age: row.profiles?.age ?? 0,
      gender: row.profiles?.gender ?? "Male",
      avatarColor: row.profiles?.avatar_color ?? colorFor(row.user_id),
      avatarUrl: row.profiles?.avatar_url ?? null,
      about: row.profiles?.about ?? undefined,
    },
    destinations: row.destinations,
    date: row.date,
    vibes: row.vibes,
    bio: row.bio,
    // Contact is never part of a public read — revealContact fetches it separately for
    // signed-in callers only.
    whatsapp: "",
    shareContact: row.share_contact,
    createdAt: row.created_at,
  };
}

type GhostListRow = {
  id: string;
  user_id: string;
  destinations: Post["destinations"];
  date: Post["date"];
  vibes: Post["vibes"];
  bio: string;
  share_contact: boolean;
  created_at: string;
  profile_name: string | null;
  profile_age: number | null;
  profile_gender: Post["user"]["gender"] | null;
  profile_avatar_color: string | null;
  profile_avatar_url: string | null;
  profile_about: string | null;
};

function ghostListRowToPost(row: GhostListRow): Post {
  return postRowToPost({
    ...row,
    profiles: {
      name: row.profile_name,
      age: row.profile_age,
      gender: row.profile_gender,
      avatar_color: row.profile_avatar_color,
      avatar_url: row.profile_avatar_url,
      about: row.profile_about,
    },
  });
}

// One post by id, from memory if the feed already has it and from the database if not.
//
// The map ships only coordinates — that is what keeps a viewport's worth of markers cheap
// — so any post reached through the map has to be fetched when it is opened. Checking
// `loadedPosts` first keeps feed interactions instant and keeps this working in the
// mock-data mode where the RPCs don't exist.
export function usePostById(postId: string | null, loadedPosts: Post[]): Post | null {
  const supabase = useClerkSupabaseClient();
  const [fetched, setFetched] = useState<Post | null>(null);

  const alreadyLoaded = postId ? loadedPosts.find((p) => p.id === postId) ?? null : null;

  useEffect(() => {
    if (!postId || alreadyLoaded) return;
    let cancelled = false;
    supabase
      .from("posts")
      // The FK is named explicitly because posts and profiles are related two ways —
      // directly via posts.user_id, and as a many-to-many through saved_posts — and
      // PostgREST refuses to guess ("more than one relationship was found"), failing the
      // whole request rather than picking one.
      .select(
        "id, user_id, destinations, date, vibes, bio, share_contact, created_at, profiles!posts_user_id_fkey(name, age, gender, avatar_color, avatar_url, about)",
      )
      .eq("id", postId)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          console.error("Failed to load post for map pin:", error?.message);
          return;
        }
        setFetched(postRowToPost(data as unknown as PostRow));
      });
    return () => {
      cancelled = true;
    };
  }, [postId, alreadyLoaded, supabase]);

  if (!postId) return null;
  if (alreadyLoaded) return alreadyLoaded;
  return fetched?.id === postId ? fetched : null;
}
