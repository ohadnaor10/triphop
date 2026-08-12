"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Post } from "../page";
import { colorFor, type PostsFilters } from "./postsStore";
import { hasActiveDateSearch } from "./relevance";
import { useClerkSupabaseClient } from "./supabase/useClerkSupabaseClient";

// The map's own data source, deliberately independent of usePostsStore: the map paginates
// over space (what's in the viewport) where the feed paginates over time (how far you've
// scrolled), so sharing one store is what made the map's contents depend on feed scroll
// depth in the first place.

export type MapTier = "region" | "country" | "place" | "post";

export type MapPoint = {
  tier: MapTier;
  /** Stable identity for this marker within its tier — region name, ISO code, place id, or postId:placeId. */
  key: string;
  label: string;
  lat: number;
  lng: number;
  postCount: number;
  /** Set only on the "post" tier; null on aggregates. */
  postId: string | null;
};

export type MapViewport = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
  zoom: number;
};

export type MapPointsStore = {
  points: MapPoint[];
  /** Total posts matching the filters, ignoring the viewport — for honest truncation copy. */
  totalCount: number;
  loading: boolean;
  /** True when the server hit its row cap and the viewport is showing a subset. */
  truncated: boolean;
};

// Matches the server's tier thresholds in supabase/migrations/0016_search_posts_map.sql.
// Duplicated rather than fetched because it's needed synchronously, before any request,
// to decide whether a small pan can reuse the cached response.
function tierForZoom(zoom: number): MapTier {
  if (zoom < 3) return "region";
  if (zoom < 5) return "country";
  if (zoom < 8) return "place";
  return "post";
}

const ROW_CAP = 500;
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
  // wrongly claiming coverage would leave the map showing stale pins.
  if (outer.minLng > outer.maxLng || inner.minLng > inner.maxLng) return false;
  return (
    inner.minLat >= outer.minLat &&
    inner.maxLat <= outer.maxLat &&
    inner.minLng >= outer.minLng &&
    inner.maxLng <= outer.maxLng
  );
}

type MapRow = {
  tier: MapTier;
  key: string;
  label: string;
  lat: number;
  lng: number;
  post_count: number;
  post_id: string | null;
};

export function useMapPoints(filters: PostsFilters, viewport: MapViewport | null): MapPointsStore {
  const supabase = useClerkSupabaseClient();
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);

  // Whichever request started most recently wins. Panning fires overlapping requests and
  // they don't come back in order — without this, a slow early response can land after a
  // fast later one and repaint the map with the area the user already left. Same guard
  // postsStore.ts uses for refresh/loadMore.
  const requestIdRef = useRef(0);
  // The padded box (and tier) the current `points` were fetched for, so a pan that stays
  // inside it can skip the round trip entirely.
  const coverageRef = useRef<{ viewport: MapViewport; tier: MapTier } | null>(null);

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
      const tier = tierForZoom(target.zoom);
      const covered = coverageRef.current;
      if (covered && covered.tier === tier && isInside(target, covered.viewport)) return;

      const padded = padViewport(target);
      const requestId = ++requestIdRef.current;
      setLoading(true);

      const params = JSON.parse(filterKey) as typeof filterParams;
      const [pointsResult, countResult] = await Promise.all([
        supabase.rpc("search_posts_map", {
          ...params,
          p_min_lng: padded.minLng,
          p_min_lat: padded.minLat,
          p_max_lng: padded.maxLng,
          p_max_lat: padded.maxLat,
          p_zoom: target.zoom,
          p_limit: ROW_CAP,
        }),
        supabase.rpc("count_posts_map", params),
      ]);

      if (requestId !== requestIdRef.current) return; // superseded by a newer viewport

      if (pointsResult.error) {
        console.error("Failed to load map points:", pointsResult.error.message);
        setLoading(false);
        return;
      }

      const rows = (pointsResult.data as MapRow[] | null) ?? [];
      setPoints(
        rows.map((row) => ({
          tier: row.tier,
          key: row.key,
          label: row.label,
          lat: row.lat,
          lng: row.lng,
          postCount: Number(row.post_count),
          postId: row.post_id,
        })),
      );
      setTruncated(rows.length >= ROW_CAP);
      if (!countResult.error) setTotalCount(Number(countResult.data ?? 0));
      coverageRef.current = { viewport: padded, tier };
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

  return { points, totalCount, loading, truncated };
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

// The post behind a tapped pin, fetched on demand.
//
// The map no longer carries full post payloads — it ships only coordinates, which is what
// keeps a viewport's worth of pins cheap — so the details for the one post the user
// actually tapped are fetched when they tap it. `loadedPosts` is checked first so a post
// already in the feed's memory costs nothing, which also keeps this working in the
// mock-data mode where the RPCs don't exist.
export function useFocusedMapPost(postId: string | null, loadedPosts: Post[]): Post | null {
  const supabase = useClerkSupabaseClient();
  const [fetched, setFetched] = useState<Post | null>(null);

  const alreadyLoaded = postId ? loadedPosts.find((p) => p.id === postId) ?? null : null;

  useEffect(() => {
    if (!postId || alreadyLoaded) return;
    let cancelled = false;
    supabase
      .from("posts")
      .select(
        "id, user_id, destinations, date, vibes, bio, share_contact, created_at, profiles(name, age, gender, avatar_color, avatar_url, about)",
      )
      .eq("id", postId)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          console.error("Failed to load post for map pin:", error?.message);
          return;
        }
        const row = data as unknown as PostRow;
        setFetched({
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
          // Contact is never part of a public read — revealContact fetches it separately
          // for signed-in callers only.
          whatsapp: "",
          shareContact: row.share_contact,
          createdAt: row.created_at,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [postId, alreadyLoaded, supabase]);

  if (!postId) return null;
  if (alreadyLoaded) return alreadyLoaded;
  return fetched?.id === postId ? fetched : null;
}
