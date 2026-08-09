import turfArea from "@turf/area";
import turfBbox from "@turf/bbox";
import turfUnion from "@turf/union";
import { City, Country } from "country-state-city";
import worldCountries from "world-countries";
// Real (Natural Earth 1:50m) country boundary polygons, precomputed offline by
// scripts/build-country-boundaries.mjs — decoded from TopoJSON, antimeridian-unwrapped,
// and stripped of far-flung overseas territories ahead of time so this ships as a plain
// static GeoJSON file. The standard Mapbox Geocoding API doesn't return real admin
// polygons (that requires the paid Mapbox Boundaries tileset), so we ship real country
// geometry client-side instead — with zero Mapbox calls and zero runtime topology
// processing needed to render one. Re-run the build script (see its header comment) if
// world-atlas/world-countries are upgraded.
import countryBoundariesData from "../data/countryBoundaries.json";

export const REGIONS = [
  "Europe",
  "North America",
  "South America",
  "East Asia/SE Asia",
  "Australia",
  "Middle East",
  "Africa",
] as const;
export type Region = (typeof REGIONS)[number];

// UN subregions bucketed into this app's 7-region travel taxonomy.
const SUBREGION_TO_REGION: Record<string, Region> = {
  "Northern Europe": "Europe",
  "Western Europe": "Europe",
  "Southern Europe": "Europe",
  "Eastern Europe": "Europe",
  "Central Europe": "Europe",
  "Southeast Europe": "Europe",
  "North America": "North America",
  "Central America": "North America",
  Caribbean: "North America",
  "South America": "South America",
  "Eastern Asia": "East Asia/SE Asia",
  "South-Eastern Asia": "East Asia/SE Asia",
  "Southern Asia": "East Asia/SE Asia",
  "Central Asia": "East Asia/SE Asia",
  "Western Asia": "Middle East",
  "Australia and New Zealand": "Australia",
  Melanesia: "Australia",
  Micronesia: "Australia",
  Polynesia: "Australia",
  "Northern Africa": "Africa",
  "Eastern Africa": "Africa",
  "Middle Africa": "Africa",
  "Southern Africa": "Africa",
  "Western Africa": "Africa",
};

const REGION_FALLBACK: Record<string, Region> = {
  Americas: "North America",
  Asia: "East Asia/SE Asia",
  Africa: "Africa",
  Europe: "Europe",
  Oceania: "Australia",
};

export const REGION_CENTROIDS: Record<Region, { lat: number; lng: number }> = {
  Europe: { lat: 54, lng: 15 },
  "North America": { lat: 45, lng: -100 },
  "South America": { lat: -15, lng: -60 },
  "East Asia/SE Asia": { lat: 15, lng: 105 },
  Australia: { lat: -25, lng: 135 },
  "Middle East": { lat: 27, lng: 45 },
  Africa: { lat: 2, lng: 20 },
};

const ISO_TO_REGION: Record<string, Region> = {};
for (const c of worldCountries) {
  // Countries with no travel-taxonomy mapping (e.g. UN region "Antarctic": Antarctica,
  // Bouvet Island, French Southern Territories, South Georgia, Heard/McDonald Islands)
  // must be left out entirely rather than defaulted to a region — a fallback default
  // here previously misclassified Antarctica as "Europe", which fed its polygon into
  // the Europe region-boundary union (see getRegionBoundaries below).
  const region = SUBREGION_TO_REGION[c.subregion] ?? REGION_FALLBACK[c.region];
  if (region) ISO_TO_REGION[c.cca2] = region;
}

// ---------- Real country boundary geometry ----------

export type BoundaryGeometry = GeoJSON.MultiPolygon | GeoJSON.Polygon;

// Reference land area (km²) per ISO code, straight from world-countries — used as a
// sanity check against whatever polygon we end up caching for that code.
const REFERENCE_AREA_KM2: Record<string, number> = {};
for (const c of worldCountries) {
  if (c.area) REFERENCE_AREA_KM2[c.cca2] = c.area;
}

// Countries whose real territory legitimately spans a huge longitude range — either
// genuinely wide (Canada, Russia) or circumpolar (Antarctica has no "mainland side" of
// the seam to unwrap against — it isn't a bug for its bbox to span the whole globe).
// Exempted from the wide-bbox warning below so it doesn't cry wolf on known,
// already-understood shapes.
const KNOWN_WIDE_COUNTRIES = new Set(["RU", "CA", "US", "FJ", "KI", "NZ", "AQ"]);

// world-atlas' 1:50m simplification distorts a micro-state's coastline (relative to its
// real area) far more than a large country's — Monaco's simplified polygon can easily
// be 5x its real 2 km², purely from simplification, not a wrong-feature bug. Below this
// size the area check is too noisy to be useful, so skip it.
const MIN_AREA_FOR_RATIO_CHECK_KM2 = 50;

// Dev-time guardrail: flag any country whose precomputed boundary (see
// scripts/build-country-boundaries.js) looks wrong, so a future world-atlas bump or a
// not-yet-seen data quirk surfaces immediately in the console instead of shipping as a
// silent "why does this map show the South Pole" bug report. The build script runs this
// same check at generation time; this is a live safety net in case app/data/countryBoundaries.json
// is ever hand-edited or regenerated without re-running the script's own check.
function warnIfBoundarySuspicious(isoCode: string, f: GeoJSON.Feature<BoundaryGeometry>) {
  const computedAreaKm2 = turfArea(f) / 1e6;
  const referenceAreaKm2 = REFERENCE_AREA_KM2[isoCode];
  // Antarctica's circumpolar ring has no clean single-ring area in this simplified,
  // non-dateline-safe data model — a real, understood limitation, not a wrong-feature
  // bug like the others this check exists to catch.
  if (referenceAreaKm2 && referenceAreaKm2 >= MIN_AREA_FOR_RATIO_CHECK_KM2 && isoCode !== "AQ") {
    const ratio = computedAreaKm2 / referenceAreaKm2;
    if (ratio < 0.2 || ratio > 5) {
      console.warn(
        `[geo] boundary for "${isoCode}" has area ${Math.round(computedAreaKm2)} km², expected ~${referenceAreaKm2} km² ` +
          `(ratio ${ratio.toFixed(2)}) — likely picked the wrong feature (e.g. a shared numeric ISO ID).`,
      );
    }
  }

  if (!KNOWN_WIDE_COUNTRIES.has(isoCode)) {
    const [minLng, , maxLng] = turfBbox(f);
    const lngSpan = maxLng - minLng;
    if (lngSpan > 170) {
      console.warn(
        `[geo] boundary for "${isoCode}" spans ${lngSpan.toFixed(1)}° of longitude — likely an unhandled ` +
          `antimeridian split (a part stored on the wrong side of +/-180°) rather than a real shape.`,
      );
    }
  }
}

let countryBoundaries: Map<string, GeoJSON.Feature<BoundaryGeometry>> | null = null;

function getCountryBoundaries(): Map<string, GeoJSON.Feature<BoundaryGeometry>> {
  if (!countryBoundaries) {
    countryBoundaries = new Map();
    const collection = countryBoundariesData as unknown as GeoJSON.FeatureCollection<BoundaryGeometry, { iso: string }>;
    for (const f of collection.features) {
      countryBoundaries.set(f.properties.iso, f);
    }
    if (process.env.NODE_ENV !== "production") {
      for (const [isoCode, boundary] of countryBoundaries) warnIfBoundarySuspicious(isoCode, boundary);
    }
  }
  return countryBoundaries;
}

/** Real (Natural Earth 1:50m) administrative boundary polygon for a country, if known. */
export function getCountryBoundary(isoCode: string): GeoJSON.Feature<BoundaryGeometry> | undefined {
  return getCountryBoundaries().get(isoCode);
}

let regionBoundaries: Map<Region, GeoJSON.Feature<BoundaryGeometry>> | null = null;

// A region ("East Asia/SE Asia", ...) is this app's own multi-country grouping, not a
// real admin area with its own boundary data — so its shape is built by dissolving every
// member country's real polygon (the same geometry already used to draw individual
// countries) into one seamless shape, rather than a collection with internal borders.
function getRegionBoundaries(): Map<Region, GeoJSON.Feature<BoundaryGeometry>> {
  if (!regionBoundaries) {
    regionBoundaries = new Map();
    const featuresByRegion = new Map<Region, GeoJSON.Feature<BoundaryGeometry>[]>();
    for (const [isoCode, region] of Object.entries(ISO_TO_REGION)) {
      const boundary = getCountryBoundary(isoCode);
      if (!boundary) continue;
      const existing = featuresByRegion.get(region) ?? [];
      featuresByRegion.set(region, [...existing, boundary]);
    }
    for (const [region, features] of featuresByRegion) {
      if (features.length === 0) continue;
      if (features.length === 1) {
        regionBoundaries.set(region, features[0]);
        continue;
      }
      try {
        const dissolved = turfUnion({ type: "FeatureCollection", features });
        if (dissolved) regionBoundaries.set(region, dissolved);
      } catch {
        // A handful of simplified 1:50m polygons can be topologically invalid enough to
        // make union() throw — fall back to the pre-dissolve behavior (still real
        // geometry, just with member-country borders visible) rather than no shape at all.
        regionBoundaries.set(region, {
          type: "Feature",
          properties: {},
          geometry: {
            type: "MultiPolygon",
            coordinates: features.flatMap((f) =>
              f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates,
            ),
          },
        });
      }
    }
  }
  return regionBoundaries;
}

/** Real boundary polygon for a broad region, dissolved from its member countries' shapes. */
export function getRegionBoundary(region: Region): GeoJSON.Feature<BoundaryGeometry> | undefined {
  return getRegionBoundaries().get(region);
}

export type GeoCountry = {
  name: string;
  isoCode: string;
  flag: string;
  region: Region;
  lat: number;
  lng: number;
};

let countryCache: GeoCountry[] | null = null;

export function getAllCountries(): GeoCountry[] {
  if (!countryCache) {
    countryCache = Country.getAllCountries()
      .filter((c) => ISO_TO_REGION[c.isoCode])
      .map((c) => ({
        name: c.name,
        isoCode: c.isoCode,
        flag: c.flag,
        region: ISO_TO_REGION[c.isoCode],
        lat: parseFloat(c.latitude) || 0,
        lng: parseFloat(c.longitude) || 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return countryCache;
}

export function getCountryByCode(isoCode: string): GeoCountry | undefined {
  return getAllCountries().find((c) => c.isoCode === isoCode);
}

export type GeoCity = { name: string; lat: number; lng: number };

const cityCache = new Map<string, GeoCity[]>();

export function getCitiesOfCountry(isoCode: string): GeoCity[] {
  if (!isoCode) return [];
  let cities = cityCache.get(isoCode);
  if (!cities) {
    cities = (City.getCitiesOfCountry(isoCode) ?? []).map((c) => ({
      name: c.name,
      lat: parseFloat(c.latitude ?? "") || 0,
      lng: parseFloat(c.longitude ?? "") || 0,
    }));
    cityCache.set(isoCode, cities);
  }
  return cities;
}

// ---------- Mapbox Forward Geocoding ----------

export type GeocodeResult = {
  lat: number;
  lng: number;
  bbox?: [number, number, number, number];
  countryCode?: string;
};

type MapboxFeature = {
  text: string;
  place_type?: string[];
  center: [number, number];
  bbox?: [number, number, number, number];
  properties?: { short_code?: string };
  context?: { id: string; short_code?: string }[];
};

// Mapbox's `context` array carries the enclosing hierarchy (country/region/place) for
// any resolved feature — this is how a freeform result like "Chamonix" or "French Alps"
// (which our static country/city taxonomy has no entry for) still yields a parent country.
function extractCountryCode(feature: MapboxFeature): string | undefined {
  if (feature.place_type?.includes("country")) {
    return feature.properties?.short_code?.toUpperCase();
  }
  const countryContext = feature.context?.find((c) => c.id.startsWith("country."));
  return countryContext?.short_code?.toUpperCase();
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
const geocodeCache = new Map<string, GeocodeResult | null>();

export async function geocodePlace(query: string): Promise<GeocodeResult | null> {
  if (!query || !MAPBOX_TOKEN) return null;
  if (geocodeCache.has(query)) return geocodeCache.get(query) ?? null;

  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
      query,
    )}.json?access_token=${MAPBOX_TOKEN}&limit=1`;
    const res = await fetch(url);
    if (!res.ok) {
      geocodeCache.set(query, null);
      return null;
    }
    const data = await res.json();
    const feature: MapboxFeature | undefined = data?.features?.[0];
    if (!feature?.center) {
      geocodeCache.set(query, null);
      return null;
    }
    const [lng, lat] = feature.center;
    const result: GeocodeResult = {
      lat,
      lng,
      bbox: feature.bbox,
      countryCode: extractCountryCode(feature),
    };
    geocodeCache.set(query, result);
    return result;
  } catch {
    geocodeCache.set(query, null);
    return null;
  }
}

// Sync read of whatever geocodePlace() has already resolved for this query — used by
// isGeographicallyRelevant() so spatial checks never block the filtering render path
// on a network call. Call warmGeocode() ahead of time to populate the cache.
export function getCachedGeocode(query: string): GeocodeResult | null | undefined {
  return geocodeCache.get(query);
}

export function warmGeocode(query: string): Promise<void> {
  if (!query || geocodeCache.has(query)) return Promise.resolve();
  return geocodePlace(query).then(() => undefined);
}

export function bboxesOverlap(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  const [aMinLng, aMinLat, aMaxLng, aMaxLat] = a;
  const [bMinLng, bMinLat, bMaxLng, bMaxLat] = b;
  return aMinLng <= bMaxLng && aMaxLng >= bMinLng && aMinLat <= bMaxLat && aMaxLat >= bMinLat;
}

// Broad spatial search: continents, regions/natural features (e.g. "French Alps",
// "Patagonia"), on top of the country/city taxonomy already covered elsewhere.
export type GeocodeSuggestion = { name: string; placeType: string } & GeocodeResult;

const suggestionCache = new Map<string, GeocodeSuggestion[]>();

export async function geocodeSuggestions(query: string): Promise<GeocodeSuggestion[]> {
  if (!query || query.length < 2 || !MAPBOX_TOKEN) return [];
  const cached = suggestionCache.get(query);
  if (cached) return cached;

  try {
    // No `types` filter: Mapbox has no "continent" type and tags natural features
    // (e.g. "Patagonia", "French Alps") inconsistently across region/district/place,
    // so an unrestricted query surfaces the widest range of spatial entities.
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
      query,
    )}.json?access_token=${MAPBOX_TOKEN}&limit=6`;
    const res = await fetch(url);
    if (!res.ok) {
      suggestionCache.set(query, []);
      return [];
    }
    const data = await res.json();
    const suggestions: GeocodeSuggestion[] = (data?.features ?? [])
      .filter((f: MapboxFeature) => Boolean(f.center))
      .map((f: MapboxFeature) => ({
        name: f.text,
        placeType: f.place_type?.[0] ?? "place",
        lng: f.center[0],
        lat: f.center[1],
        bbox: f.bbox,
        countryCode: extractCountryCode(f),
      }));
    suggestionCache.set(query, suggestions);
    return suggestions;
  } catch {
    suggestionCache.set(query, []);
    return [];
  }
}

// ---------- Hierarchical & spatial destination matching ----------

// Structurally compatible with app/page.tsx's `Destination` union (focused/broad),
// plus a "place" variant for freeform natural features/regions with no structured
// entry in our taxonomy (e.g. "French Alps", "Patagonia", "Chamonix").
export type GeoDestination =
  | { mode: "focused"; country: string; countryCode: string; cities: string[] }
  | { mode: "broad"; regions: Region[] }
  | { mode: "place"; name: string };

type GeoEntity =
  | { level: "region"; region: Region }
  | { level: "country"; countryCode: string; countryName: string; region?: Region }
  | { level: "city"; countryCode: string; countryName: string; cityName: string; region?: Region }
  | { level: "place"; name: string; countryCode?: string };

function namesMatch(a: string, b: string): boolean {
  const an = a.trim().toLowerCase();
  const bn = b.trim().toLowerCase();
  if (!an || !bn) return false;
  return an === bn || an.includes(bn) || bn.includes(an);
}

function toEntities(dest: GeoDestination): GeoEntity[] {
  if (dest.mode === "broad") {
    return dest.regions.map((region) => ({ level: "region", region }));
  }
  if (dest.mode === "place") {
    return [{ level: "place", name: dest.name, countryCode: getCachedGeocode(dest.name)?.countryCode }];
  }
  const country = getCountryByCode(dest.countryCode);
  const region = country?.region;
  if (dest.cities.length === 0) {
    return [{ level: "country", countryCode: dest.countryCode, countryName: dest.country, region }];
  }
  return dest.cities.map((cityName) => ({
    level: "city",
    countryCode: dest.countryCode,
    countryName: dest.country,
    cityName,
    region,
  }));
}

// Does `outer` contain (or equal) `inner`? Region ⊇ Country ⊇ City; place-vs-place is
// name equality only (containment between natural features isn't a clean hierarchy).
function contains(outer: GeoEntity, inner: GeoEntity): boolean {
  if (outer.level === "region") {
    if (inner.level === "region") return outer.region === inner.region;
    if (inner.level === "place") return false;
    return inner.region !== undefined && inner.region === outer.region;
  }
  if (outer.level === "country") {
    if (inner.level === "country") return outer.countryCode === inner.countryCode;
    if (inner.level === "city") return outer.countryCode === inner.countryCode;
    if (inner.level === "place") return Boolean(inner.countryCode) && inner.countryCode === outer.countryCode;
  }
  if (outer.level === "city" && inner.level === "city") {
    return outer.countryCode === inner.countryCode && namesMatch(outer.cityName, inner.cityName);
  }
  if (outer.level === "place" && inner.level === "place") {
    return namesMatch(outer.name, inner.name);
  }
  return false;
}

function bboxKey(entity: GeoEntity): string | undefined {
  if (entity.level === "country") return entity.countryName;
  if (entity.level === "city") return `${entity.cityName}, ${entity.countryName}`;
  if (entity.level === "place") return entity.name;
  return undefined;
}

// Cross-border overlap: a natural feature (place) spanning a searched country, or vice
// versa — e.g. search "France" vs a post tagged "Alps", or search "Alps" vs a post in
// "Italy". Only resolvable once both sides' bboxes are cached; see warmGeocode().
function bboxOverlap(a: GeoEntity, b: GeoEntity): boolean {
  if (a.level === "region" || b.level === "region") return false;
  if (a.level !== "place" && b.level !== "place") return false;
  const keyA = bboxKey(a);
  const keyB = bboxKey(b);
  if (!keyA || !keyB) return false;
  const bboxA = getCachedGeocode(keyA)?.bbox;
  const bboxB = getCachedGeocode(keyB)?.bbox;
  if (!bboxA || !bboxB) return false;
  return bboxesOverlap(bboxA, bboxB);
}

function entitiesRelated(a: GeoEntity, b: GeoEntity): boolean {
  return contains(a, b) || contains(b, a) || bboxOverlap(a, b);
}

/**
 * True if ANY search destination is geographically related to ANY post destination:
 * exact/partial name match, hierarchy down (search=parent, post=child), hierarchy up
 * (search=child, post=parent), or cross-border bbox overlap for natural features.
 * Pure/synchronous — spatial (bbox) checks only fire once warmGeocode() has cached the
 * relevant places, so this never blocks the UI on a network round-trip.
 */
export function isGeographicallyRelevant(
  searchDestinations: GeoDestination[],
  postDestinations: GeoDestination[],
): boolean {
  if (searchDestinations.length === 0) return true;
  const searchEntities = searchDestinations.flatMap(toEntities);
  const postEntities = postDestinations.flatMap(toEntities);
  return searchEntities.some((s) => postEntities.some((p) => entitiesRelated(s, p)));
}
