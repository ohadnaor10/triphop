#!/usr/bin/env node
// Populates `places` / `post_places` (see supabase/migrations/0015_places.sql) for posts
// that predate them — the seed posts from 0008 and anything created before the write
// path in app/lib/places.ts landed.
//
// Mirrors resolvePlaceIds() in app/lib/places.ts on purpose, including its
// cheapest-first resolution order (existing row -> bundled country-state-city dataset ->
// Mapbox), so a backfilled place is indistinguishable from one created by a real post.
// Every distinct (city, country) is resolved at most once per run, and existing rows are
// reused across runs, so re-running costs no geocoding for anything already stored.
//
// Idempotent by design: it replaces each post's links rather than appending, so it
// doubles as the retry path for posts whose geocode failed at creation time.
//
// Usage: node scripts/backfill-places.mjs [--dry-run | --emit-sql]
//
// --emit-sql writes the resolved places to a migration instead of inserting them, which
// is how the initial backfill was actually run: it needs no service role key, it applies
// through the same `supabase db push` as everything else, and it keeps the seeded rows
// reproducible across environments (the same reasoning behind the seed data in 0008).
// The post->place links are expressed as a set-based join over posts.destinations rather
// than as hardcoded ids, so the same file works against any database.
// Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (writes bypass RLS —
// there is no signed-in user here to satisfy set_post_places' ownership check).
// NEXT_PUBLIC_MAPBOX_TOKEN is optional; without it, cities missing from the bundled
// dataset are skipped rather than geocoded.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { City } from "country-state-city";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMIT_SQL = process.argv.includes("--emit-sql");
// --emit-sql never writes to the database either, so it takes the same read-only path.
const DRY_RUN = process.argv.includes("--dry-run") || EMIT_SQL;
const SQL_OUTPUT_PATH = "supabase/migrations/0017_backfill_places.sql";

// Minimal .env.local reader — this repo has no dotenv dependency, and adding one for a
// maintenance script isn't worth it.
function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "").trim();
  }
}

loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

// A dry run only ever reads posts/places, both publicly readable, so it can fall back to
// the anon key — useful for checking what a run *would* do without handing a script the
// service role key.
const KEY = SERVICE_ROLE_KEY || (DRY_RUN ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY : null);

if (!SUPABASE_URL || !KEY) {
  console.error(
    "[backfill-places] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (--dry-run accepts the anon key)",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });

const normalize = (value) => value.trim().toLowerCase();
const keyOf = (place) => `${normalize(place.name)}|${place.countryCode.toUpperCase()}`;

// Mirrors specificPlacesOf() in app/lib/places.ts: city-level destinations only. Bare
// countries and broad regions have no pinpoint location and stay feed-only.
function specificPlacesOf(destinations) {
  const out = new Map();
  for (const destination of destinations ?? []) {
    if (destination?.mode !== "focused") continue;
    for (const city of destination.cities ?? []) {
      if (!city?.trim()) continue;
      const place = {
        name: city.trim(),
        countryCode: String(destination.countryCode ?? "").toUpperCase(),
        countryName: destination.country ?? "",
      };
      if (place.countryCode) out.set(keyOf(place), place);
    }
  }
  return [...out.values()];
}

const cityCache = new Map();
function bundledCoordinates(place) {
  if (!cityCache.has(place.countryCode)) {
    cityCache.set(place.countryCode, City.getCitiesOfCountry(place.countryCode) ?? []);
  }
  const match = cityCache.get(place.countryCode).find((c) => normalize(c.name) === normalize(place.name));
  if (!match) return null;
  const lat = parseFloat(match.latitude ?? "");
  const lng = parseFloat(match.longitude ?? "");
  // 0/0 is the dataset's unparseable-coordinate sentinel — a pin there would sit in the
  // Gulf of Guinea, indistinguishable from a real bug, so treat it as a miss.
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}

async function mapboxCoordinates(place) {
  if (!MAPBOX_TOKEN) return null;
  const query = encodeURIComponent(`${place.name}, ${place.countryName}`);
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${MAPBOX_TOKEN}&limit=1`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const feature = data?.features?.[0];
    if (!feature?.center) return null;
    const [lng, lat] = feature.center;
    return { lat, lng, mapboxId: feature.id };
  } catch (error) {
    console.warn(`[backfill-places] geocoding failed for ${place.name}: ${error.message}`);
    return null;
  }
}

async function loadExistingPlaces() {
  const { data, error } = await supabase.from("places").select("id, name, country_code");
  if (error) throw new Error(`reading places: ${error.message}`);
  const byKey = new Map();
  for (const row of data ?? []) byKey.set(`${normalize(row.name)}|${row.country_code.toUpperCase()}`, row.id);
  return byKey;
}

async function insertPlace(place, coordinates) {
  const { data, error } = await supabase
    .from("places")
    .insert({
      name: place.name,
      country_code: place.countryCode,
      country_name: place.countryName,
      lat: coordinates.lat,
      lng: coordinates.lng,
      mapbox_id: coordinates.mapboxId ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`inserting place ${place.name}: ${error.message}`);
  return data.id;
}

const sqlString = (value) => `'${String(value).replace(/'/g, "''")}'`;

function writeMigration(rows) {
  const values = rows
    .map(
      ({ place, coordinates }) =>
        `  (${sqlString(place.name)}, ${sqlString(place.countryCode)}, ${sqlString(place.countryName)}, ${coordinates.lat}, ${coordinates.lng})`,
    )
    .join(",\n");

  const sql = `-- Generated by scripts/backfill-places.mjs --emit-sql — do not hand-edit.
-- Backfills \`places\` / \`post_places\` (0015_places.sql) for posts that predate them,
-- including the seed posts from 0008.
--
-- Every coordinate here came from the bundled country-state-city dataset that the
-- create-post city picker itself is built from — zero Mapbox geocoding requests were
-- made to produce this file, and none are made to apply it.
--
-- Emitted as a migration rather than run as a one-off script so the rows are
-- reproducible across environments and need no service role key to apply.

insert into places (name, country_code, country_name, lat, lng) values
${values}
on conflict (lower(btrim(name)), country_code) do nothing;

-- Links are derived by joining posts.destinations against the rows above rather than
-- being written out as id pairs, so this is environment-independent and safe to re-run:
-- it links whatever posts exist wherever it's applied.
insert into post_places (post_id, place_id)
select p.id, pl.id
from posts p
cross join lateral jsonb_array_elements(p.destinations) as d
cross join lateral jsonb_array_elements_text(coalesce(d->'cities', '[]'::jsonb)) as city
join places pl
  on pl.country_code = upper(btrim(d->>'countryCode'))
 and lower(btrim(pl.name)) = lower(btrim(city))
where d->>'mode' = 'focused'
on conflict do nothing;
`;

  fs.writeFileSync(path.join(__dirname, "..", SQL_OUTPUT_PATH), sql);
  console.log(`[backfill-places] wrote ${rows.length} places to ${SQL_OUTPUT_PATH}`);
}

async function backfill() {
  const { data: posts, error } = await supabase.from("posts").select("id, destinations");
  if (error) throw new Error(`reading posts: ${error.message}`);

  const placeIdByKey = await loadExistingPlaces();
  console.log(`[backfill-places] ${posts.length} posts, ${placeIdByKey.size} places already stored`);

  let created = 0;
  let geocoded = 0;
  let linked = 0;
  const unresolved = [];
  const emitted = [];

  for (const post of posts) {
    const places = specificPlacesOf(post.destinations);
    if (places.length === 0) continue;

    const placeIds = [];
    for (const place of places) {
      let id = placeIdByKey.get(keyOf(place));
      if (id === undefined) {
        let coordinates = bundledCoordinates(place);
        if (!coordinates) {
          coordinates = await mapboxCoordinates(place);
          if (coordinates) geocoded += 1;
        }
        if (!coordinates) {
          unresolved.push(`${place.name}, ${place.countryName}`);
          continue;
        }
        if (DRY_RUN) {
          if (EMIT_SQL) emitted.push({ place, coordinates });
          else console.log(`[backfill-places] would create place: ${place.name}, ${place.countryName}`);
          placeIdByKey.set(keyOf(place), -1);
          created += 1;
          continue;
        }
        id = await insertPlace(place, coordinates);
        placeIdByKey.set(keyOf(place), id);
        created += 1;
      }
      if (id !== undefined && id !== -1) placeIds.push(id);
    }

    if (DRY_RUN || placeIds.length === 0) continue;

    // Replace rather than append, so a re-run after a post's destinations changed
    // doesn't leave stale pins behind.
    const { error: deleteError } = await supabase.from("post_places").delete().eq("post_id", post.id);
    if (deleteError) throw new Error(`clearing links for ${post.id}: ${deleteError.message}`);
    const { error: linkError } = await supabase
      .from("post_places")
      .insert(placeIds.map((placeId) => ({ post_id: post.id, place_id: placeId })));
    if (linkError) throw new Error(`linking ${post.id}: ${linkError.message}`);
    linked += 1;
  }

  if (EMIT_SQL) writeMigration(emitted);

  console.log(
    `[backfill-places] ${DRY_RUN ? "(dry run) " : ""}created ${created} places (${geocoded} via Mapbox), linked ${linked} posts`,
  );
  if (unresolved.length > 0) {
    console.warn(`[backfill-places] unresolved: ${[...new Set(unresolved)].join("; ")}`);
  }
}

backfill().catch((error) => {
  console.error(`[backfill-places] ${error.message}`);
  process.exit(1);
});
