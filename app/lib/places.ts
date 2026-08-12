"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Destination } from "../page";
import { geocodePlace, getCitiesOfCountry } from "./geo";

// Resolves a post's city-level destinations to rows in `places` (see
// supabase/migrations/0015_places.sql), so the map can read coordinates out of the
// database instead of geocoding them in every visitor's browser.
//
// Resolution is deliberately ordered cheapest-first:
//   1. an existing `places` row      — free, and the common case once a city is popular
//   2. the bundled country-state-city dataset — free and offline; the create-post city
//      picker sources its options from exactly this dataset (see getCitiesOfCountry),
//      so nearly every city a user can pick is already resolvable without any network
//   3. Mapbox forward geocoding      — last resort, and the only tier that costs money
//
// In practice tier 3 fires only for destinations typed outside the picker's dataset,
// which is why "2,000 posts about Bangkok" costs at most one geocode, and usually zero.

export type PlaceKey = {
  name: string;
  countryCode: string;
  countryName: string;
};

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function keyOf(place: PlaceKey): string {
  return `${normalizeName(place.name)}|${place.countryCode.toUpperCase()}`;
}

// City-level destinations only. A bare country ("Japan") or a broad region ("Europe")
// carries no pinpoint location, so it gets no place row and stays feed-only — matching
// what the map already does today.
export function specificPlacesOf(destinations: Destination[]): PlaceKey[] {
  const out = new Map<string, PlaceKey>();
  for (const destination of destinations) {
    if (destination.mode !== "focused") continue;
    for (const city of destination.cities) {
      if (!city.trim()) continue;
      const place: PlaceKey = {
        name: city.trim(),
        countryCode: destination.countryCode.toUpperCase(),
        countryName: destination.country,
      };
      out.set(keyOf(place), place);
    }
  }
  return [...out.values()];
}

type Coordinates = { lat: number; lng: number; mapboxId?: string };

// Tier 2: the offline dataset the city picker itself is built from. Matched on the
// normalized name so casing/whitespace differences between a stored value and the
// dataset don't force an unnecessary Mapbox call.
function coordinatesFromBundledCities(place: PlaceKey): Coordinates | null {
  const match = getCitiesOfCountry(place.countryCode).find((c) => normalizeName(c.name) === normalizeName(place.name));
  // The dataset carries a few entries with unparseable coordinates, which getCitiesOfCountry
  // surfaces as 0/0 — indistinguishable from a real point in the Gulf of Guinea, so they're
  // treated as a miss and fall through to geocoding rather than planting a pin in the ocean.
  if (!match || (match.lat === 0 && match.lng === 0)) return null;
  return { lat: match.lat, lng: match.lng };
}

async function coordinatesFromMapbox(place: PlaceKey): Promise<Coordinates | null> {
  const geocoded = await geocodePlace(`${place.name}, ${place.countryName}`);
  if (!geocoded) return null;
  return { lat: geocoded.lat, lng: geocoded.lng, mapboxId: geocoded.mapboxId };
}

type PlaceRow = { id: number; name: string; country_code: string };

// Looks up every already-stored place for the countries involved in one query, rather
// than one query per city. Filtering by country only (not by name) is intentional: a
// name-based `in` filter would miss rows whose stored casing differs from the value
// being resolved, and a false miss costs a real geocoding request.
async function findExistingPlaces(
  supabase: SupabaseClient,
  places: PlaceKey[],
): Promise<Map<string, number>> {
  const countryCodes = [...new Set(places.map((p) => p.countryCode))];
  if (countryCodes.length === 0) return new Map();

  const { data, error } = await supabase.from("places").select("id, name, country_code").in("country_code", countryCodes);
  if (error) {
    console.error("Failed to look up places:", error.message);
    return new Map();
  }

  const byKey = new Map<string, number>();
  for (const row of (data as PlaceRow[] | null) ?? []) {
    byKey.set(`${normalizeName(row.name)}|${row.country_code.toUpperCase()}`, row.id);
  }
  return byKey;
}

// Returns the place ids for a post's destinations, creating any that don't exist yet.
//
// Never throws and never blocks the caller: a destination that can't be resolved is
// simply left out, so a Mapbox outage costs a missing pin rather than a post the user
// couldn't publish. scripts/backfill-places.mjs re-runs over unlinked posts and is the
// retry path for exactly these cases.
export async function resolvePlaceIds(supabase: SupabaseClient, destinations: Destination[]): Promise<number[]> {
  const places = specificPlacesOf(destinations);
  if (places.length === 0) return [];

  const existing = await findExistingPlaces(supabase, places);
  const ids: number[] = [];

  for (const place of places) {
    const known = existing.get(keyOf(place));
    if (known !== undefined) {
      ids.push(known);
      continue;
    }

    const coordinates = coordinatesFromBundledCities(place) ?? (await coordinatesFromMapbox(place));
    if (!coordinates) {
      console.warn(`Could not resolve coordinates for ${place.name}, ${place.countryName} — pin omitted`);
      continue;
    }

    // resolve_place upserts, so two callers racing on the same new city both end up with
    // the same id rather than creating duplicate rows.
    const { data, error } = await supabase.rpc("resolve_place", {
      p_name: place.name,
      p_country_code: place.countryCode,
      p_country_name: place.countryName,
      p_lat: coordinates.lat,
      p_lng: coordinates.lng,
      p_mapbox_id: coordinates.mapboxId ?? null,
    });
    if (error) {
      console.error(`Failed to store place ${place.name}:`, error.message);
      continue;
    }
    if (typeof data === "number") ids.push(data);
  }

  return ids;
}

// Links a post to its places, replacing whatever set it had before — an edit that drops
// a city has to drop that city's pin, which an insert-only path can't express.
export async function syncPostPlaces(
  supabase: SupabaseClient,
  postId: string,
  destinations: Destination[],
): Promise<void> {
  const placeIds = await resolvePlaceIds(supabase, destinations);
  const { error } = await supabase.rpc("set_post_places", { p_post_id: postId, p_place_ids: placeIds });
  if (error) console.error("Failed to link post to places:", error.message);
}
