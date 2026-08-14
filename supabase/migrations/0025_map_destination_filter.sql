-- The map deliberately ignored the destination filter: pan and zoom were meant to be the
-- destination filter, so search_posts_map_points had no p_destinations at all.
--
-- That reasoning holds for *finding* an area and stops holding for *narrowing* one. A user
-- interested only in Thailand still has to look at every marker inside the viewport, and a
-- viewport that frames Thailand frames half of Southeast Asia with it. Panning cannot
-- express "only these trips", which is precisely what the filter is for — so the map takes
-- the destination filter again, and it composes with the viewport instead of replacing it.
--
-- Uses destination_matches() from 0013 verbatim, so a destination means exactly the same
-- thing on the map as it does in the feed. Divergence there would be far worse than the
-- omission being fixed.
--
-- Adding a parameter changes each signature, and CREATE OR REPLACE cannot do that — a new
-- parameter list creates an overload instead, leaving PostgREST with two ambiguous
-- candidates per RPC name (same reasoning as 0014).

drop function if exists search_posts_map_points(
  text, text, int, int, boolean, jsonb, double precision, double precision, double precision, double precision, int
);

create or replace function search_posts_map_points(
  p_destinations jsonb default '[]'::jsonb,
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
  p_limit int default 3000
)
returns table (
  post_id uuid,
  place_id bigint,
  label text,
  lat double precision,
  lng double precision,
  author_name text,
  author_avatar_url text,
  author_avatar_color text
)
language plpgsql
stable
as $$
declare
  v_caller text := auth.jwt() ->> 'sub';
begin
  return query
  select p.id, pl.id, pl.name, pl.lat, pl.lng, pr.name, pr.avatar_url, pr.avatar_color
  from posts p
  join profiles pr on pr.id = p.user_id
  join post_places pp on pp.post_id = p.id
  join places pl on pl.id = pp.place_id
  where destination_matches(p.destinations, p_destinations)
    and (p_vibe is null or p_vibe = any(p.vibes))
    and (p_gender is null or pr.gender = p_gender)
    and (p_age_min is null or coalesce(pr.age, 0) >= p_age_min)
    and (p_age_max is null or coalesce(pr.age, 0) <= p_age_max)
    and (
      not p_saved_only
      or (v_caller is not null and exists (
        select 1 from saved_posts sp where sp.user_id = v_caller and sp.post_id = p.id
      ))
    )
    and (p_date_search is null or compute_relevance_score(p_date_search, p.date) > 0)
    and pl.lat between p_min_lat and p_max_lat
    -- A viewport crossing the antimeridian arrives with min_lng > max_lng, which BETWEEN
    -- would read as an empty range and silently blank the map over the Pacific.
    and case
      when p_min_lng <= p_max_lng then pl.lng between p_min_lng and p_max_lng
      else pl.lng >= p_min_lng or pl.lng <= p_max_lng
    end
  order by pl.lat, pl.lng, p.id
  limit p_limit;
end;
$$;

drop function if exists search_posts_map_country_ghosts(text, text, int, int, boolean, jsonb);

create or replace function search_posts_map_country_ghosts(
  p_destinations jsonb default '[]'::jsonb,
  p_vibe text default null,
  p_gender text default null,
  p_age_min int default null,
  p_age_max int default null,
  p_saved_only boolean default false,
  p_date_search jsonb default null
)
returns table (
  country_code text,
  country_name text,
  post_count bigint,
  single_post_id uuid,
  single_author_name text,
  single_author_avatar_url text,
  single_author_avatar_color text
)
language plpgsql
stable
as $$
declare
  v_caller text := auth.jwt() ->> 'sub';
begin
  return query
  with matching_posts as (
    select p.id, p.destinations, pr.name as author_name, pr.avatar_url, pr.avatar_color
    from posts p
    join profiles pr on pr.id = p.user_id
    where destination_matches(p.destinations, p_destinations)
      and (p_vibe is null or p_vibe = any(p.vibes))
      and (p_gender is null or pr.gender = p_gender)
      and (p_age_min is null or coalesce(pr.age, 0) >= p_age_min)
      and (p_age_max is null or coalesce(pr.age, 0) <= p_age_max)
      and (
        not p_saved_only
        or (v_caller is not null and exists (
          select 1 from saved_posts sp where sp.user_id = v_caller and sp.post_id = p.id
        ))
      )
      and (p_date_search is null or compute_relevance_score(p_date_search, p.date) > 0)
  ),
  cityless as (
    select
      mp.id,
      upper(btrim(d->>'countryCode')) as country_code,
      d->>'country' as country_name,
      mp.author_name,
      mp.avatar_url,
      mp.avatar_color
    from matching_posts mp
    cross join lateral jsonb_array_elements(mp.destinations) as d
    where d->>'mode' = 'focused'
      and jsonb_array_length(coalesce(d->'cities', '[]'::jsonb)) = 0
      and coalesce(btrim(d->>'countryCode'), '') <> ''
  ),
  grouped as (
    select
      c.country_code,
      max(c.country_name) as country_name,
      count(distinct c.id) as post_count,
      (array_agg(c.id order by c.id))[1] as first_post_id,
      (array_agg(c.author_name order by c.id))[1] as first_author_name,
      (array_agg(c.avatar_url order by c.id))[1] as first_avatar_url,
      (array_agg(c.avatar_color order by c.id))[1] as first_avatar_color
    from cityless c
    group by c.country_code
  )
  select
    g.country_code,
    g.country_name,
    g.post_count,
    case when g.post_count = 1 then g.first_post_id end,
    case when g.post_count = 1 then g.first_author_name end,
    case when g.post_count = 1 then g.first_avatar_url end,
    case when g.post_count = 1 then g.first_avatar_color end
  from grouped g;
end;
$$;

drop function if exists count_posts_map(text, text, int, int, boolean, jsonb);

create or replace function count_posts_map(
  p_destinations jsonb default '[]'::jsonb,
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
  select count(*) into v_count
  from posts p
  join profiles pr on pr.id = p.user_id
  where destination_matches(p.destinations, p_destinations)
    and (p_vibe is null or p_vibe = any(p.vibes))
    and (p_gender is null or pr.gender = p_gender)
    and (p_age_min is null or coalesce(pr.age, 0) >= p_age_min)
    and (p_age_max is null or coalesce(pr.age, 0) <= p_age_max)
    and (
      not p_saved_only
      or (v_caller is not null and exists (
        select 1 from saved_posts sp where sp.user_id = v_caller and sp.post_id = p.id
      ))
    )
    and (p_date_search is null or compute_relevance_score(p_date_search, p.date) > 0)
    -- Everything the map can draw: a country-level destination, city or not. Posts naming
    -- only a continent are excluded because nothing is drawn for them.
    and exists (
      select 1
      from jsonb_array_elements(p.destinations) as d
      where d->>'mode' = 'focused' and coalesce(btrim(d->>'countryCode'), '') <> ''
    );
  return v_count;
end;
$$;

grant execute on function search_posts_map_points(
  jsonb, text, text, int, int, boolean, jsonb, double precision, double precision, double precision, double precision, int
) to anon, authenticated;
grant execute on function search_posts_map_country_ghosts(jsonb, text, text, int, int, boolean, jsonb)
  to anon, authenticated;
grant execute on function count_posts_map(jsonb, text, text, int, int, boolean, jsonb) to anon, authenticated;
