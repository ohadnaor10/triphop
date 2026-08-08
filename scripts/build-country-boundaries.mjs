#!/usr/bin/env node
// Precomputes real country boundary polygons — at Natural Earth's highest available
// precision (1:10m, via the bundled `world-atlas` package, fully offline) — into a
// static GeoJSON file checked into the repo. This replaces the old approach of
// decoding+cleaning a lower-resolution (1:50m) topology at runtime on every cold
// start: app/lib/geo.ts now just imports the output of this script directly, with
// zero Mapbox API calls and zero runtime topology processing involved in rendering a
// country polygon. Re-run with `node scripts/build-country-boundaries.mjs` if
// world-atlas or world-countries are ever upgraded.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { feature } from "topojson-client";
import { area as turfArea } from "@turf/area";
import { bbox as turfBbox } from "@turf/bbox";
import { centroid as turfCentroid } from "@turf/centroid";
import { distance as turfDistance } from "@turf/distance";
import worldCountries from "world-countries";
import countriesTopology from "world-atlas/countries-10m.json" with { type: "json" };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "..", "app", "data", "countryBoundaries.json");

// world-atlas keys its topology by ISO 3166-1 *numeric* code; bridge to the alpha-2
// codes used everywhere else in the app via world-countries' `ccn3`.
const ALPHA2_BY_NUMERIC = {};
for (const c of worldCountries) {
  if (c.ccn3) ALPHA2_BY_NUMERIC[c.ccn3] = c.cca2;
}

const REFERENCE_AREA_KM2 = {};
for (const c of worldCountries) {
  if (c.area) REFERENCE_AREA_KM2[c.cca2] = c.area;
}

// Natural Earth bundles a country's overseas territories into the same MultiPolygon
// as its mainland (e.g. France's feature includes French Guiana, Réunion, ...). Drop
// any polygon part implausibly far from the country's largest (mainland) part.
const OVERSEAS_DISTANCE_THRESHOLD_KM = 2000;

// Recursively adds `deltaLng` to every [lng, lat] pair in a Polygon's ring/coordinate
// nesting (works for both Polygon coordinates and a single MultiPolygon part).
function shiftLng(coords, deltaLng) {
  if (Array.isArray(coords) && typeof coords[0] === "number") {
    const [lng, lat] = coords;
    return [lng + deltaLng, lat];
  }
  return coords.map((c) => shiftLng(c, deltaLng));
}

// Some countries' *own single ring* crosses the antimeridian in the raw data (e.g.
// Fiji, Russia's mainland) — consecutive points jump straight from ~179° to ~-179°
// instead of continuing past 180°. Unwrap each ring to be internally continuous by
// letting its longitude run past +/-180° when that's shorter than jumping back.
function unwrapRing(ring) {
  const out = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    const prevLng = out[i - 1][0];
    const [, lat] = ring[i];
    let lng = ring[i][0];
    while (lng - prevLng > 180) lng -= 360;
    while (lng - prevLng < -180) lng += 360;
    out.push([lng, lat]);
  }
  return out;
}

// Keeps a hole ring aligned with its outer ring after both are independently unwrapped.
function unwrapPolygon(rings) {
  if (rings.length === 0) return rings;
  const [first, ...rest] = rings.map(unwrapRing);
  const referenceLng = first[0][0];
  const aligned = rest.map((ring) => {
    let delta = 0;
    while (ring[0][0] + delta - referenceLng > 180) delta -= 360;
    while (ring[0][0] + delta - referenceLng < -180) delta += 360;
    return delta === 0 ? ring : shiftLng(ring, delta);
  });
  return [first, ...aligned];
}

function unwrapAntimeridianSelfCrossing(f) {
  if (f.geometry.type === "Polygon") {
    return { ...f, geometry: { ...f.geometry, coordinates: unwrapPolygon(f.geometry.coordinates) } };
  }
  return {
    ...f,
    geometry: { ...f.geometry, coordinates: f.geometry.coordinates.map(unwrapPolygon) },
  };
}

function dropOverseasTerritories(f) {
  if (f.geometry.type !== "MultiPolygon") return f;
  const polygons = f.geometry.coordinates;
  if (polygons.length <= 1) return f;

  const polygonFeatures = polygons.map((coords) => ({
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: coords },
  }));
  const areas = polygonFeatures.map((p) => turfArea(p));
  const mainlandIndex = areas.indexOf(Math.max(...areas));
  const mainlandCentroid = turfCentroid(polygonFeatures[mainlandIndex]);
  const mainlandLng = mainlandCentroid.geometry.coordinates[0];

  const keptIndices = polygons
    .map((_, i) => i)
    .filter((i) => {
      if (i === mainlandIndex) return true;
      const distanceKm = turfDistance(mainlandCentroid, turfCentroid(polygonFeatures[i]), { units: "kilometers" });
      return distanceKm <= OVERSEAS_DISTANCE_THRESHOLD_KM;
    });

  // A country that straddles the antimeridian (e.g. New Zealand's mainland plus its
  // Chatham Islands) stores those parts on opposite sides of the +/-180 seam. Shift any
  // part by +/-360 when that puts it closer to the mainland's longitude, so the whole
  // feature's coordinates are contiguous and plain bbox math stays correct.
  const kept = keptIndices.map((i) => {
    const partLng = turfCentroid(polygonFeatures[i]).geometry.coordinates[0];
    const delta = partLng - mainlandLng;
    if (delta > 180) return shiftLng(polygons[i], -360);
    if (delta < -180) return shiftLng(polygons[i], 360);
    return polygons[i];
  });

  return { ...f, geometry: { ...f.geometry, coordinates: kept } };
}

// Countries whose real territory legitimately spans a huge longitude range — either
// genuinely wide (Canada, Russia) or circumpolar (Antarctica). Exempted from the
// wide-bbox warning below so it doesn't cry wolf on known, already-understood shapes.
const KNOWN_WIDE_COUNTRIES = new Set(["RU", "CA", "US", "FJ", "KI", "NZ", "AQ"]);

// A micro-state's simplified coastline distorts its area (relative to its real size)
// far more than a large country's — below this size the area check is too noisy to be
// useful.
const MIN_AREA_FOR_RATIO_CHECK_KM2 = 50;

let suspiciousCount = 0;

function warnIfBoundarySuspicious(isoCode, f) {
  const computedAreaKm2 = turfArea(f) / 1e6;
  const referenceAreaKm2 = REFERENCE_AREA_KM2[isoCode];
  if (referenceAreaKm2 && referenceAreaKm2 >= MIN_AREA_FOR_RATIO_CHECK_KM2 && isoCode !== "AQ") {
    const ratio = computedAreaKm2 / referenceAreaKm2;
    if (ratio < 0.2 || ratio > 5) {
      console.warn(
        `[build-country-boundaries] "${isoCode}" area ${Math.round(computedAreaKm2)} km², expected ~${referenceAreaKm2} km² ` +
          `(ratio ${ratio.toFixed(2)}) — likely picked the wrong feature (e.g. a shared numeric ISO ID).`,
      );
      suspiciousCount++;
    }
  }

  if (!KNOWN_WIDE_COUNTRIES.has(isoCode)) {
    const [minLng, , maxLng] = turfBbox(f);
    const lngSpan = maxLng - minLng;
    if (lngSpan > 170) {
      console.warn(
        `[build-country-boundaries] "${isoCode}" spans ${lngSpan.toFixed(1)}° of longitude — likely an unhandled ` +
          `antimeridian split rather than a real shape.`,
      );
      suspiciousCount++;
    }
  }
}

function build() {
  const collection = feature(countriesTopology, countriesTopology.objects.countries);

  const boundaries = new Map();
  let skippedNoIso = 0;
  for (const f of collection.features) {
    const numericId = String(f.id ?? "");
    const isoCode = ALPHA2_BY_NUMERIC[numericId];
    if (!isoCode) {
      skippedNoIso++;
      continue;
    }
    const normalized = isoCode === "AQ" ? f : unwrapAntimeridianSelfCrossing(f);
    const existing = boundaries.get(isoCode);
    if (existing && turfArea(existing) >= turfArea(normalized)) continue;
    boundaries.set(isoCode, dropOverseasTerritories(normalized));
  }

  for (const [isoCode, boundary] of boundaries) warnIfBoundarySuspicious(isoCode, boundary);

  const features = [...boundaries.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([isoCode, f]) => ({
      type: "Feature",
      properties: { iso: isoCode },
      geometry: f.geometry,
    }));

  const output = { type: "FeatureCollection", features };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output));

  const sizeMb = (fs.statSync(OUTPUT_PATH).size / (1024 * 1024)).toFixed(2);
  console.log(
    `[build-country-boundaries] wrote ${features.length} country boundaries (${sizeMb} MB) to ${path.relative(process.cwd(), OUTPUT_PATH)}`,
  );
  console.log(`[build-country-boundaries] source features: ${collection.features.length}, skipped (no ISO alpha-2 mapping): ${skippedNoIso}`);
  if (suspiciousCount > 0) {
    console.warn(`[build-country-boundaries] ${suspiciousCount} suspicious boundary warning(s) above — review before shipping.`);
    process.exitCode = 1;
  } else {
    console.log(`[build-country-boundaries] accuracy check passed: no suspicious boundaries.`);
  }
}

build();
