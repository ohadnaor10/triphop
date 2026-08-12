#!/usr/bin/env node
// Generates bulk mock posts for inspecting how the feed and — mainly — the map behave
// with real volume: how pins cluster, where they pile up, what a dense city looks like
// next to a sparse continent.
//
// Two batches, by design:
//   * 300 posts spread over uniformly-random countries — the sparse, long-tail case
//   * 100 posts in Thailand, deliberately *not* uniform — Bangkok in most of them, the
//     well-known spots weighted above the long tail. Real destination data is heavily
//     concentrated, and a map that looks fine under uniform noise can still fall apart
//     on the pile-up that concentration produces.
//
// Every post belongs to one synthetic profile (MOCK_USER_ID), which makes cleanup a
// single delete: posts and post_places both cascade from profiles.
//
// Deterministic: a fixed PRNG seed means re-running produces byte-identical output, so
// the emitted SQL is reviewable and reproducible rather than a fresh random blob each time.
//
// Usage:
//   node scripts/generate-mock-posts.mjs --emit-sql   # writes a migration (no DB access)
//   node scripts/generate-mock-posts.mjs --stats      # prints the distribution only
// Cleanup once you're done inspecting:
//   delete from profiles where id = 'mock-load-user';

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { City, Country } from "country-state-city";
import worldCountries from "world-countries";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "..", "supabase", "migrations", "0019_mock_load_posts.sql");

const MOCK_USER_ID = "mock-load-user";
const RANDOM_POST_COUNT = 300;
const THAILAND_POST_COUNT = 100;
// Enforced as a count rather than a per-post probability: "at least 70%" should be a
// guarantee, not something that holds on average.
const BANGKOK_POST_COUNT = 78;
const NEIGHBOUR_CHANCE = 0.1;
const SEED = 20260812;

// ---------- Deterministic PRNG (mulberry32) ----------

function makeRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = makeRandom(SEED);
const randomInt = (maxExclusive) => Math.floor(random() * maxExclusive);
const pick = (items) => items[randomInt(items.length)];

// Draws from a [item, weight] list. Used for Thai cities so the famous places dominate
// and the long tail still shows up occasionally — the shape real data has.
function pickWeighted(entries) {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [item, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return item;
  }
  return entries[entries.length - 1][0];
}

function pickDistinct(items, count) {
  const pool = [...items];
  const out = [];
  while (out.length < count && pool.length > 0) out.push(...pool.splice(randomInt(pool.length), 1));
  return out;
}

// ---------- Reference data ----------

// Only countries the bundled dataset has cities for — a country with no cities can still
// be posted about, but it would never produce a map pin, and 300 unpinnable posts would
// make for a useless map test.
const cityCache = new Map();
function citiesOf(isoCode) {
  if (!cityCache.has(isoCode)) cityCache.set(isoCode, City.getCitiesOfCountry(isoCode) ?? []);
  return cityCache.get(isoCode);
}

const COUNTRIES = Country.getAllCountries()
  .map((c) => ({ code: c.isoCode, name: c.name }))
  .filter((c) => citiesOf(c.code).length > 0);

// world-countries lists land borders as ISO3 codes; everything else here speaks ISO2.
const ISO3_TO_ISO2 = Object.fromEntries(worldCountries.map((c) => [c.cca3, c.cca2]));
const NEIGHBOURS = Object.fromEntries(
  worldCountries.map((c) => [c.cca2, (c.borders ?? []).map((b) => ISO3_TO_ISO2[b]).filter(Boolean)]),
);

// Thailand's headline destinations, weighted. Everything outside this list is reachable
// through the long-tail draw below, just rarely — same as reality.
const THAI_CITIES = [
  ["Chiang Mai", 30],
  ["Phuket", 26],
  ["Krabi", 18],
  ["Pattaya", 14],
  ["Ko Samui", 12],
  ["Chiang Rai", 8],
  ["Ayutthaya", 7],
  ["Hua Hin", 6],
  ["Ko Tao", 6],
  ["Ko Lanta", 5],
  ["Kanchanaburi", 4],
  ["Pai", 4],
  ["Sukhothai", 3],
];
const THAI_LONG_TAIL_CHANCE = 0.12;

const VIBES = ["Backpacking", "Road Trip", "Luxury", "Chill", "Adventure", "Culture"];

// One bio carries the overwhelming majority of these posts on purpose: they exist to be
// looked at on a map, not read, and identical text makes a mock post obvious at a glance
// in the feed. The two variants below just break up the wall slightly.
const PRIMARY_BIO =
  "Mock post for map testing — planning a loose route, flexible on the details, happy to team up with someone heading the same way.";
const ALT_BIOS = [
  "Mock post for map testing — rough plan only, open to changing dates and stops for the right travel partner.",
  "Mock post for map testing — first time in this part of the world, looking for company for at least part of the trip.",
];
const ALT_BIO_CHANCE = 0.08;

// ---------- Post construction ----------

function isoDate(daysFromNow) {
  const d = new Date(Date.UTC(2026, 7, 12) + daysFromNow * 86_400_000);
  return d.toISOString().slice(0, 10);
}

// Mixed date modes so the map's date filter has all three shapes to chew on.
function randomDate() {
  const roll = random();
  const start = 7 + randomInt(330);
  if (roll < 0.6) {
    return { mode: "focused", startDate: isoDate(start), endDate: isoDate(start + 4 + randomInt(17)) };
  }
  if (roll < 0.85) {
    const first = new Date(Date.UTC(2026, 7 + randomInt(14), 1));
    const months = [];
    for (let i = 0; i < 1 + randomInt(3); i++) {
      const m = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + i, 1));
      months.push(`${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, "0")}`);
    }
    return { mode: "broad", months };
  }
  return { mode: "flexible", earliest: isoDate(start), latest: isoDate(start + 30 + randomInt(60)) };
}

function focusedDestination(countryCode, countryName, cities) {
  return { mode: "focused", country: countryName, countryCode, cities };
}

// A country contributes 0-4 cities. Zero is kept deliberately: a country-only post has no
// pinnable location, and that path (feed-visible, map-invisible) needs to be represented.
function randomCitiesFor(isoCode) {
  const cities = citiesOf(isoCode);
  const wanted = randomInt(5);
  if (wanted === 0 || cities.length === 0) return [];
  return pickDistinct(cities, Math.min(wanted, cities.length)).map((c) => c.name);
}

function buildRandomPost() {
  const country = pick(COUNTRIES);
  const destinations = [focusedDestination(country.code, country.name, randomCitiesFor(country.code))];

  // 10% of trips continue into a bordering country — the case that puts one post's pins
  // in two places, which is exactly what makes "count distinct posts, not locations"
  // matter when those pins land in the same cluster.
  if (random() < NEIGHBOUR_CHANCE) {
    const candidates = (NEIGHBOURS[country.code] ?? []).filter((code) => citiesOf(code).length > 0);
    if (candidates.length > 0) {
      const neighbourCode = pick(candidates);
      const neighbour = COUNTRIES.find((c) => c.code === neighbourCode);
      if (neighbour) {
        destinations.push(focusedDestination(neighbour.code, neighbour.name, randomCitiesFor(neighbour.code)));
      }
    }
  }

  return { destinations, date: randomDate(), vibes: pickDistinct(VIBES, 1 + randomInt(2)), bio: randomBio() };
}

function randomBio() {
  return random() < ALT_BIO_CHANCE ? pick(ALT_BIOS) : PRIMARY_BIO;
}

function buildThailandPosts() {
  const thaiCityNames = new Set(citiesOf("TH").map((c) => c.name));
  const known = THAI_CITIES.filter(([name]) => thaiCityNames.has(name));
  const longTail = citiesOf("TH").map((c) => c.name);

  // Bangkok's share is assigned to fixed slots, then the batch is shuffled, so the
  // guarantee holds exactly rather than approximately.
  const posts = [];
  for (let i = 0; i < THAILAND_POST_COUNT; i++) {
    const cities = [];
    if (i < BANGKOK_POST_COUNT) cities.push("Bangkok");

    // 0-3 more stops on top of Bangkok. Weighted, so Chiang Mai and Phuket dominate and
    // the map gets genuinely dense hotspots instead of an even smear.
    const extra = randomInt(4);
    for (let j = 0; j < extra; j++) {
      const name = random() < THAI_LONG_TAIL_CHANCE ? pick(longTail) : pickWeighted(known);
      if (!cities.includes(name)) cities.push(name);
    }
    // A post with no Bangkok and no extras would be country-only; give it at least one
    // real stop so the Thailand batch stays a map test.
    if (cities.length === 0) cities.push(pickWeighted(known));

    posts.push({
      destinations: [focusedDestination("TH", "Thailand", cities)],
      date: randomDate(),
      vibes: pickDistinct(VIBES, 1 + randomInt(2)),
      bio: randomBio(),
    });
  }

  for (let i = posts.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [posts[i], posts[j]] = [posts[j], posts[i]];
  }
  return posts;
}

function buildAll() {
  const posts = [];
  for (let i = 0; i < RANDOM_POST_COUNT; i++) posts.push(buildRandomPost());
  posts.push(...buildThailandPosts());
  return posts;
}

// ---------- Output ----------

const sqlString = (value) => `'${String(value).replace(/'/g, "''")}'`;
const sqlJson = (value) => `${sqlString(JSON.stringify(value))}::jsonb`;
const sqlTextArray = (values) => `ARRAY[${values.map(sqlString).join(", ")}]::text[]`;

function writeMigration(posts) {
  const rows = posts
    .map(
      (p) =>
        `  (${sqlString(MOCK_USER_ID)}, ${sqlJson(p.destinations)}, ${sqlJson(p.date)}, ${sqlTextArray(p.vibes)}, ${sqlString(p.bio)})`,
    )
    .join(",\n");

  const sql = `-- Generated by scripts/generate-mock-posts.mjs — do not hand-edit.
-- ${posts.length} mock posts (${RANDOM_POST_COUNT} spread across random countries, ${THAILAND_POST_COUNT} concentrated in
-- Thailand with Bangkok in ${BANGKOK_POST_COUNT} of them) for inspecting map density and clustering at
-- realistic volume. All owned by one synthetic profile, so cleanup is a single delete.
--
-- Not real content: every one of these carries a "Mock post for map testing" bio.
-- To remove them all, including their places links (both cascade from profiles):
--   delete from profiles where id = '${MOCK_USER_ID}';

insert into profiles (id, name, age, gender, avatar_color, whatsapp, birth_date)
values (${sqlString(MOCK_USER_ID)}, 'Map Load Test', 30, 'Male',
        'bg-gradient-to-br from-slate-400 to-slate-600', '10000000999', '1996-06-15')
on conflict (id) do nothing;

insert into posts (user_id, destinations, date, vibes, bio) values
${rows};

-- Same environment-independent join used by 0017: link every focused city in these posts
-- to its \`places\` row. Cities not yet in \`places\` are inserted first, straight from the
-- bundled country-state-city coordinates the generator drew them from.
${placesInsertFor(posts)}

insert into post_places (post_id, place_id)
select p.id, pl.id
from posts p
cross join lateral jsonb_array_elements(p.destinations) as d
cross join lateral jsonb_array_elements_text(coalesce(d->'cities', '[]'::jsonb)) as city
join places pl
  on pl.country_code = upper(btrim(d->>'countryCode'))
 and lower(btrim(pl.name)) = lower(btrim(city))
where d->>'mode' = 'focused'
  and p.user_id = ${sqlString(MOCK_USER_ID)}
on conflict do nothing;
`;

  fs.writeFileSync(OUTPUT_PATH, sql);
  console.log(`[generate-mock-posts] wrote ${posts.length} posts to ${path.relative(process.cwd(), OUTPUT_PATH)}`);
}

// Every distinct (city, country) used by the batch, with coordinates from the same
// bundled dataset the cities were chosen from — so this costs no geocoding either.
function placesInsertFor(posts) {
  const byKey = new Map();
  for (const post of posts) {
    for (const destination of post.destinations) {
      for (const cityName of destination.cities) {
        const key = `${cityName.toLowerCase()}|${destination.countryCode}`;
        if (byKey.has(key)) continue;
        const city = citiesOf(destination.countryCode).find((c) => c.name === cityName);
        if (!city) continue;
        const lat = parseFloat(city.latitude ?? "");
        const lng = parseFloat(city.longitude ?? "");
        // 0/0 is the dataset's unparseable-coordinate sentinel; a pin there would sit in
        // the Gulf of Guinea looking like a bug.
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
        byKey.set(key, { name: cityName, code: destination.countryCode, country: destination.country, lat, lng });
      }
    }
  }
  const values = [...byKey.values()]
    .map((p) => `  (${sqlString(p.name)}, ${sqlString(p.code)}, ${sqlString(p.country)}, ${p.lat}, ${p.lng})`)
    .join(",\n");
  return `insert into places (name, country_code, country_name, lat, lng) values\n${values}\non conflict (lower(btrim(name)), country_code) do nothing;`;
}

function printStats(posts) {
  const countries = new Map();
  const cities = new Map();
  let multiCountry = 0;
  let cityless = 0;
  let bangkok = 0;

  for (const post of posts) {
    if (post.destinations.length > 1) multiCountry += 1;
    const cityCount = post.destinations.reduce((n, d) => n + d.cities.length, 0);
    if (cityCount === 0) cityless += 1;
    if (post.destinations.some((d) => d.cities.includes("Bangkok"))) bangkok += 1;
    for (const d of post.destinations) {
      countries.set(d.country, (countries.get(d.country) ?? 0) + 1);
      for (const c of d.cities) cities.set(`${c}, ${d.country}`, (cities.get(`${c}, ${d.country}`) ?? 0) + 1);
    }
  }

  const thai = posts.filter((p) => p.destinations.some((d) => d.countryCode === "TH")).length;
  console.log(`posts: ${posts.length} | distinct countries: ${countries.size} | distinct cities: ${cities.size}`);
  console.log(`thailand posts: ${thai} | with Bangkok: ${bangkok} (${Math.round((bangkok / thai) * 100)}% of TH)`);
  console.log(`multi-country posts: ${multiCountry} | posts with no city (map-invisible): ${cityless}`);
  console.log(
    "top cities:",
    [...cities.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, n]) => `${name} (${n})`)
      .join(", "),
  );
}

const posts = buildAll();
printStats(posts);
if (process.argv.includes("--emit-sql")) writeMigration(posts);
