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
  /** Total posts matching the filters, ignoring the viewport — for honest copy. */
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

export function useMapPoints(filters: PostsFilters, viewport: MapViewport | null): MapPointsStore {
  const supabase = useClerkSupabaseClient();
  const [locations, setLocations] = useState<MapLocation[]>([]);
  const [overview, setOverview] = useState<MapAggregate[] | null>(null);
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
      const [pointsResult, countResult] = await Promise.all([
        supabase.rpc("search_posts_map_points", { ...params, ...bbox, p_limit: LOCATION_CAP }),
        supabase.rpc("count_posts_map", params),
      ]);

      if (requestId !== requestIdRef.current) return; // superseded by a newer viewport

      if (pointsResult.error) {
        console.error("Failed to load map locations:", pointsResult.error.message);
        setLoading(false);
        return;
      }

      const rows = (pointsResult.data as LocationRow[] | null) ?? [];

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
            postId: row.post_id,
            placeId: String(row.place_id),
            label: row.label,
            lat: row.lat,
            lng: row.lng,
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

  return { locations, overview, totalCount, loading };
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
