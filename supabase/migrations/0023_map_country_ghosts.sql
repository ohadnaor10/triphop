-- Posts whose destination is a country with no city picked ("Japan, haven't decided
-- where") had no representation on the map at all: post_places only holds city-level
-- rows, so 59 of 441 posts — 13% of supply — were silently invisible. The poster got no
-- reach, and someone browsing Japan saw fewer travellers than actually exist.
--
-- These get one marker per country rather than one per post, drawn in a deliberately
-- vague style (dashed ring) so it never reads as a precise location. Continent-only
-- posts ("Europe", with no country at all) stay off the map entirely — a marker at a
-- continent centroid is too vague to mean anything at city zoom.
--
-- No coordinates are returned: the client places these at each country's label point,
-- from the same bundled dataset its city picker uses. A bounding-box centre — the only
-- thing the database has — puts Thailand's marker out in the Gulf, which is exactly the
-- artefact this feature exists to avoid.

-- One row per country that has cityless posts matching the filters. Bounded by the number
-- of countries (~250), so the whole set is returned and the client filters by viewport
-- against its own coordinates.
create or replace function search_posts_map_country_ghosts(
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
  -- Populated only when the country has exactly one such post, so the marker can show
  -- that person's avatar and tapping it can go straight to their preview card.
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
      and (p_date_search is null or compute_relevance_score(p_date_search, p.date) > 0)
  ),
  -- A post can be vague about one country and precise about another ("Bangkok, then
  -- somewhere in Laos"), so this is per destination entry, not per post: such a post
  -- gets a real pin in Thailand *and* a ghost in Laos.
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
  )
  select
    c.country_code,
    max(c.country_name),
    count(distinct c.id),
    case when count(distinct c.id) = 1 then min(c.id) end,
    case when count(distinct c.id) = 1 then min(c.author_name) end,
    case when count(distinct c.id) = 1 then min(c.avatar_url) end,
    case when count(distinct c.id) = 1 then min(c.avatar_color) end
  from cityless c
  group by c.country_code;
end;
$$;

-- The posts behind one country's ghost marker, newest first, paged like the feed.
create or replace function list_country_ghost_posts(
  p_country_code text,
  p_vibe text default null,
  p_gender text default null,
  p_age_min int default null,
  p_age_max int default null,
  p_saved_only boolean default false,
  p_date_search jsonb default null,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  user_id text,
  destinations jsonb,
  date jsonb,
  vibes text[],
  bio text,
  share_contact boolean,
  created_at timestamptz,
  profile_name text,
  profile_age int,
  profile_gender text,
  profile_avatar_color text,
  profile_avatar_url text,
  profile_about text
)
language plpgsql
stable
as $$
declare
  v_caller text := auth.jwt() ->> 'sub';
begin
  return query
  select
    p.id, p.user_id, p.destinations, p.date, p.vibes, p.bio, p.share_contact, p.created_at,
    pr.name, pr.age, pr.gender, pr.avatar_color, pr.avatar_url, pr.about
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
    and (p_date_search is null or compute_relevance_score(p_date_search, p.date) > 0)
    and exists (
      select 1
      from jsonb_array_elements(p.destinations) as d
      where d->>'mode' = 'focused'
        and upper(btrim(d->>'countryCode')) = upper(btrim(p_country_code))
        and jsonb_array_length(coalesce(d->'cities', '[]'::jsonb)) = 0
    )
  -- Offset rather than keyset paging: a cluster's list is a bounded, short-lived snapshot
  -- opened on a tap, not an endless feed, so the drift keyset pagination protects against
  -- can't realistically happen while it's open.
  order by p.created_at desc, p.id desc
  limit p_limit offset p_offset;
end;
$$;

-- The map's headline count previously required a post_places row, so it counted only
-- precisely-placed posts (375 of 441) — a number that now contradicts what the map draws.
-- Counts everything the map can represent: any post with at least one country-level
-- destination, whether or not a city was picked. Continent-only posts stay excluded,
-- because nothing is drawn for them.
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
  select count(*) into v_count
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
    and (p_date_search is null or compute_relevance_score(p_date_search, p.date) > 0)
    and exists (
      select 1
      from jsonb_array_elements(p.destinations) as d
      where d->>'mode' = 'focused' and coalesce(btrim(d->>'countryCode'), '') <> ''
    );
  return v_count;
end;
$$;

grant execute on function search_posts_map_country_ghosts(text, text, int, int, boolean, jsonb)
  to anon, authenticated;
grant execute on function list_country_ghost_posts(text, text, text, int, int, boolean, jsonb, int, int)
  to anon, authenticated;
