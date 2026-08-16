-- Splits the "East Asia/SE Asia" travel-taxonomy region in two, mirroring the same
-- split just made to REGIONS/SUBREGION_TO_REGION in app/lib/geo.ts: "Asia" (Eastern,
-- Southern and Central Asia) and "Southeast Asia" (South-Eastern Asia). There was
-- previously no way to search either name directly — "East Asia/SE Asia" doesn't start
-- with "asia" or "southeast", which is exactly what the region picker matches against.
--
-- Hand-written rather than regenerated from scripts/build-search-geo-lookup.mjs: 0012 is
-- already applied, and rewriting an applied migration is how environments quietly
-- diverge (see 0016's region_centroid table for the same reasoning). The generator
-- script's own SUBREGION_TO_REGION/REGION_FALLBACK mirror was updated alongside geo.ts
-- so it stays correct for the *next* wholesale regen, even though this migration doesn't
-- use it.
--
-- Russia is deliberately untouched here: geo.ts now splits its real boundary polygon at
-- the Ural Mountains so the shaded map region only covers the appropriate half, but that
-- is a client-side rendering detail with no per-country granularity to mirror — this
-- lookup table still classifies the whole country as one region, unchanged.

update country_region set region = 'Asia'
where country_code in ('AF','BD','BT','CN','HK','IN','IR','JP','KG','KP','KR','KZ','LK','MN','MO','MV','NP','PK','TJ','TM','TW','UZ');

update country_region set region = 'Southeast Asia'
where country_code in ('BN','ID','KH','LA','MM','MY','PH','SG','TH','TL','VN');

delete from region_centroid where region = 'East Asia/SE Asia';

insert into region_centroid (region, lat, lng) values
  ('Asia', 35, 95),
  ('Southeast Asia', 8, 110)
on conflict (region) do update set lat = excluded.lat, lng = excluded.lng;

-- The one seed post tagged with the old combined region — its bio ("First big SE Asia
-- loop... Vietnam, Laos, Cambodia") is unambiguously the Southeast Asia half.
update posts set destinations = '[{"mode": "broad", "regions": ["Southeast Asia"]}]'::jsonb
where user_id = 'seed-user-36';
