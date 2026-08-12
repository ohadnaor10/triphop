-- The feed map's own query, replacing its dependence on whatever page of the feed
-- happened to be loaded (app/page.tsx built pins from the cursor-paginated `posts`
-- array, so the map's contents depended on how far the user had scrolled *before*
-- switching views — same filters, different map).
--
-- The map paginates over space rather than time: pan/zoom is to a map what scroll depth
-- is to a feed, so this takes the viewport as its bounds and the zoom as the level of
-- detail. Aggregation happens here rather than in the browser specifically so the
-- payload stays bounded at *every* zoom — a world-view query returns ~7 rows whether
-- there are 40 posts or 400,000, which a "send all points, cluster client-side" design
-- cannot promise.
--
-- Deliberately has no p_destinations parameter: on the map, the viewport *is* the
-- destination filter. Every other filter (dates, vibe, gender, age, saved-only) is
-- shared with search_posts() and behaves identically here.

-- Stable anchor points for the continent tier's bubbles. Mirrors REGION_CENTROIDS in
-- app/lib/geo.ts — keep the two in sync by hand if the taxonomy changes. Anchoring to
-- fixed points rather than averaging the matching posts' coordinates keeps a continent's
-- bubble from wandering around the ocean as its contents change.
--
-- Hand-written here rather than emitted by scripts/build-search-geo-lookup.mjs, which
-- regenerates 0012 wholesale — that migration is already applied, and rewriting applied
-- migrations is how environments quietly diverge.
create table if not exists region_centroid (
  region text primary key,
  lat double precision not null,
  lng double precision not null
);

insert into region_centroid (region, lat, lng) values
  ('Europe', 54, 15),
  ('North America', 45, -100),
  ('South America', -15, -60),
  ('East Asia/SE Asia', 15, 105),
  ('Australia', -25, 135),
  ('Middle East', 27, 45),
  ('Africa', 2, 20)
on conflict (region) do update set lat = excluded.lat, lng = excluded.lng;

alter table region_centroid enable row level security;
create policy "region centroids are publicly readable" on region_centroid for select using (true);

-- Returns one uniform row shape for all four tiers, so the client renders "a labelled
-- point with a count" and only varies the styling. post_id is null on the aggregate
-- tiers and set only on the individual-post tier.
--
-- SECURITY INVOKER (the default), for the same reasons search_posts() is: every table
-- read here is already exactly as readable to the caller as this needs — posts/profiles
-- per 0001/0002/0004, places/post_places per 0015 — and the saved_posts EXISTS check
-- runs as the caller, so it can only ever match that caller's own rows.
create or replace function search_posts_map(
  p_vibe text default null,
  p_gender text default null,
  p_age_min int default null,
  p_age_max int default null,
  p_saved_only boolean default false,
  p_date_search jsonb default null,
  p_min_lng double precision default -180,
  p_min_lat double precision default -90,
  p_max_lng double precision default 180,
  p_max_lat double precision default 90,
  p_zoom double precision default 1,
  p_limit int default 500
)
returns table (
  tier text,
  key text,
  label text,
  lat double precision,
  lng double precision,
  post_count bigint,
  post_id uuid
)
language plpgsql
stable
as $$
declare
  v_caller text := auth.jwt() ->> 'sub';
  -- Zoom thresholds. Chosen so each tier hands over roughly when its bubbles stop being
  -- informative: continents until countries are distinguishable, countries until cities
  -- are, cities until individual pins stop overlapping.
  v_tier text := case
    when p_zoom < 3 then 'region'
    when p_zoom < 5 then 'country'
    when p_zoom < 8 then 'place'
    else 'post'
  end;
begin
  return query
  with matching_posts as (
    select p.id
    from posts p
    join profiles pr on pr.id = p.user_id
    where (p_vibe is null or p_vibe = any(p.vibes))
      and (p_gender is null or pr.gender = p_gender)
      and (p_age_min is null or coalesce(pr.age, 0) >= p_age_min)
      and (p_age_max is null or coalesce(pr.age, 0) <= p_age_max)
      and (
        not p_saved_only
        or (v_caller is not null and exists (
          select 1 from saved_posts sp where sp.user_id = v_caller and sp.post_id = p.id
        ))
      )
      -- Unlike search_posts(), where p_date_search only *ranks*, here it filters. A map
      -- has no ordering to express relevance through, so carrying the ranking-only
      -- behaviour across would make the dates filter do nothing at all on the map.
      -- compute_relevance_score returns 0 exactly when there's no date overlap, so
      -- "> 0" is precisely "the trip's dates overlap what was searched".
      and (p_date_search is null or compute_relevance_score(p_date_search, p.date) > 0)
  ),
  points as (
    select mp.id as post_id, pl.id as place_id, pl.name, pl.country_code, pl.country_name, pl.lat, pl.lng
    from matching_posts mp
    join post_places pp on pp.post_id = mp.id
    join places pl on pl.id = pp.place_id
  ),
  in_view as (
    select *
    from points pt
    where pt.lat between p_min_lat and p_max_lat
      -- A viewport that crosses the antimeridian arrives with min_lng > max_lng, which
      -- BETWEEN would read as an empty range and silently blank the map over the Pacific.
      and case
        when p_min_lng <= p_max_lng then pt.lng between p_min_lng and p_max_lng
        else pt.lng >= p_min_lng or pt.lng <= p_max_lng
      end
  )
  select * from (
    -- Continent tier ignores the viewport on purpose: at this zoom the whole world is
    -- effectively in frame, and 7 rows is already the bound.
    select
      'region'::text as tier,
      cr.region as key,
      cr.region as label,
      rc.lat,
      rc.lng,
      count(distinct pt.post_id) as post_count,
      null::uuid as post_id
    from points pt
    join country_region cr on cr.country_code = pt.country_code
    join region_centroid rc on rc.region = cr.region
    where v_tier = 'region'
    group by cr.region, rc.lat, rc.lng

    union all

    -- Country bubbles sit at the centre of the country's bounding box (0012), not at the
    -- average of its matching points, so the bubble doesn't drift as posts come and go.
    select
      'country'::text,
      pt.country_code,
      max(pt.country_name),
      (cb.min_lat + cb.max_lat) / 2,
      (cb.min_lng + cb.max_lng) / 2,
      count(distinct pt.post_id),
      null::uuid
    from in_view pt
    join country_bbox cb on cb.country_code = pt.country_code
    where v_tier = 'country'
    group by pt.country_code, cb.min_lat, cb.max_lat, cb.min_lng, cb.max_lng

    union all

    select
      'place'::text,
      pt.place_id::text,
      max(pt.name),
      pt.lat,
      pt.lng,
      count(distinct pt.post_id),
      null::uuid
    from in_view pt
    where v_tier = 'place'
    group by pt.place_id, pt.lat, pt.lng

    union all

    -- One row per (post, destination): a trip listing three cities is three pins, which
    -- is why pin density climbs faster than post counts suggest.
    select
      'post'::text,
      pt.post_id::text || ':' || pt.place_id::text,
      pt.name,
      pt.lat,
      pt.lng,
      1::bigint,
      pt.post_id
    from in_view pt
    where v_tier = 'post'
  ) tiers
  order by tiers.post_count desc, tiers.label
  limit p_limit;
end;
$$;

-- Total matches for the current filters, ignoring the viewport — lets the map say
-- "showing 500 of 1,240" instead of silently truncating when the post tier hits p_limit.
create or replace function count_posts_map(
  p_vibe text default null,
  p_gender text default null,
  p_age_min int default null,
  p_age_max int default null,
  p_saved_only boolean default false,
  p_date_search jsonb default null
)
returns bigint
language plpgsql
stable
as $$
declare
  v_caller text := auth.jwt() ->> 'sub';
  v_count bigint;
begin
  select count(distinct p.id) into v_count
  from posts p
  join profiles pr on pr.id = p.user_id
  join post_places pp on pp.post_id = p.id
  where (p_vibe is null or p_vibe = any(p.vibes))
    and (p_gender is null or pr.gender = p_gender)
    and (p_age_min is null or coalesce(pr.age, 0) >= p_age_min)
    and (p_age_max is null or coalesce(pr.age, 0) <= p_age_max)
    and (
      not p_saved_only
      or (v_caller is not null and exists (
        select 1 from saved_posts sp where sp.user_id = v_caller and sp.post_id = p.id
      ))
    )
    and (p_date_search is null or compute_relevance_score(p_date_search, p.date) > 0);
  return v_count;
end;
$$;

grant execute on function search_posts_map(
  text, text, int, int, boolean, jsonb, double precision, double precision, double precision, double precision,
  double precision, int
) to anon, authenticated;

grant execute on function count_posts_map(text, text, int, int, boolean, jsonb) to anon, authenticated;
