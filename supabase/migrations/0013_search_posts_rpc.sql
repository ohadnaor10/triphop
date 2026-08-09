-- Server-side port of app/lib/geo.ts's destination matching (contains/bboxOverlap/
-- entitiesRelated/isGeographicallyRelevant) and app/lib/relevance.ts's date-relevance
-- scoring, wired up as search_posts() — a single paginated RPC that replaces the
-- client-side filteredPosts computation in app/page.tsx. Moving this server-side means
-- a filter with zero visible results is always a true zero results, not "no matches in
-- what's loaded so far" (see app/lib/postsStore.ts's cursor pagination, added
-- previously, which made that distinction observable for the first time).
--
-- Helper functions below are only ever called internally by search_posts() (or by each
-- other) — none are meant to be called directly via PostgREST, so none carry an
-- explicit GRANT EXECUTE. Postgres grants EXECUTE on a newly created function to PUBLIC
-- by default, which is sufficient for search_posts() to call them; only search_posts()
-- itself is an RPC entrypoint and needs an explicit grant.

-- ---------- Name matching (mirrors geo.ts's namesMatch) ----------

create or replace function names_match(a text, b text)
returns boolean
language sql
immutable
as $$
  select
    trim(lower(a)) <> '' and trim(lower(b)) <> ''
    and (
      trim(lower(a)) = trim(lower(b))
      or position(trim(lower(b)) in trim(lower(a))) > 0
      or position(trim(lower(a)) in trim(lower(b))) > 0
    );
$$;

-- ---------- Cross-border bbox overlap (mirrors geo.ts's bboxesOverlap, bboxKey for
-- country entities, and bboxOverlap) ----------
--
-- geo.ts sources a country's bbox from a live Mapbox geocode of its display name
-- (only reliable client-side because the app happens to have already geocoded every
-- country visible in the loaded feed). Server-side, country_bbox (see
-- 0012_search_geo_lookup.sql) sources the same kind of bbox from this repo's own
-- bundled boundary polygons instead — same purpose (a rough "does this natural feature
-- roughly overlap this country" check), no live geocoding involved.

create or replace function bbox_overlaps_country(search_bbox jsonb, p_country_code text)
returns boolean
language plpgsql
immutable
as $$
declare
  b country_bbox%rowtype;
begin
  if search_bbox is null or p_country_code is null then
    return false;
  end if;
  select * into b from country_bbox where country_code = p_country_code;
  if not found then
    return false;
  end if;
  return (search_bbox->>0)::double precision <= b.max_lng
    and (search_bbox->>2)::double precision >= b.min_lng
    and (search_bbox->>1)::double precision <= b.max_lat
    and (search_bbox->>3)::double precision >= b.min_lat;
end;
$$;

-- ---------- Destination matching (mirrors geo.ts's toEntities/contains/bboxOverlap/
-- entitiesRelated/isGeographicallyRelevant) ----------
--
-- post_dest is one element of a post's `destinations` jsonb array:
--   {"mode":"focused","country":...,"countryCode":...,"cities":[...]}
--   {"mode":"broad","regions":[...]}
-- search_entity is one element of the search-bar's resolved destinations, built
-- client-side from SearchDestination — same shape geo.ts's toGeoDestination produces,
-- plus the bbox/countryCode a "place" entity's Mapbox geocoding suggestion already
-- carries at selection time:
--   {"kind":"country","code":...}
--   {"kind":"city","name":...,"countryCode":...}
--   {"kind":"region","region":...}
--   {"kind":"place","name":...,"countryCode":...,"bbox":[minLng,minLat,maxLng,maxLat]}
--
-- Every branch below was verified against geo.ts's actual matching rules (not
-- reimplemented from the general written description) — including the two narrower,
-- already-existing behaviors it deliberately preserves:
--   * a post entered as specific cities (not just a country) never matches a free-text
--     "place" search, in either direction — geo.ts's contains() has no city<->place
--     case, and bboxOverlap() only ever looks up a bbox by *country* name for a
--     country-level entity, never a city-level one;
--   * a "place" search never matches a "broad" (region-level) post — geo.ts's
--     contains() explicitly returns false for region-vs-place, and bboxOverlap()
--     explicitly excludes region-level entities altogether.
create or replace function destination_entity_matches(post_dest jsonb, search_entity jsonb)
returns boolean
language plpgsql
stable
as $$
declare
  post_mode text := post_dest->>'mode';
  search_kind text := search_entity->>'kind';
  post_country_code text;
  post_cities jsonb;
  post_region text;
  post_regions jsonb;
  search_country_region text;
begin
  if post_mode = 'focused' then
    post_country_code := post_dest->>'countryCode';
    post_cities := coalesce(post_dest->'cities', '[]'::jsonb);

    if search_kind = 'country' then
      return post_country_code = (search_entity->>'code');

    elsif search_kind = 'city' then
      return post_country_code = (search_entity->>'countryCode')
        and (
          jsonb_array_length(post_cities) = 0
          or exists (
            select 1 from jsonb_array_elements_text(post_cities) as c
            where names_match(c, search_entity->>'name')
          )
        );

    elsif search_kind = 'region' then
      select region into post_region from country_region where country_code = post_country_code;
      return post_region is not null and post_region = (search_entity->>'region');

    elsif search_kind = 'place' then
      if jsonb_array_length(post_cities) > 0 then
        return false;
      end if;
      if (search_entity->>'countryCode') is not null and (search_entity->>'countryCode') = post_country_code then
        return true;
      end if;
      return bbox_overlaps_country(search_entity->'bbox', post_country_code);
    end if;
    return false;

  elsif post_mode = 'broad' then
    post_regions := coalesce(post_dest->'regions', '[]'::jsonb);

    if search_kind = 'region' then
      return exists (select 1 from jsonb_array_elements_text(post_regions) as r where r = (search_entity->>'region'));

    elsif search_kind = 'country' then
      select region into search_country_region from country_region where country_code = (search_entity->>'code');
      return search_country_region is not null
        and exists (select 1 from jsonb_array_elements_text(post_regions) as r where r = search_country_region);

    elsif search_kind = 'city' then
      select region into search_country_region from country_region where country_code = (search_entity->>'countryCode');
      return search_country_region is not null
        and exists (select 1 from jsonb_array_elements_text(post_regions) as r where r = search_country_region);
    end if;
    return false;
  end if;

  return false;
end;
$$;

create or replace function destination_matches(post_destinations jsonb, search_entities jsonb)
returns boolean
language sql
stable
as $$
  select
    coalesce(jsonb_array_length(search_entities), 0) = 0
    or exists (
      select 1
      from jsonb_array_elements(post_destinations) as pd
      cross join jsonb_array_elements(search_entities) as se
      where destination_entity_matches(pd, se)
    );
$$;

-- ---------- Date relevance scoring (mirrors app/lib/relevance.ts exactly) ----------

create or replace function day_index(d text) returns int
language sql immutable as $$ select (d::date - date '1970-01-01'); $$;

create or replace function days_in_month(ym text) returns int
language sql immutable as $$
  select extract(day from (date_trunc('month', (ym || '-01')::date) + interval '1 month - 1 day'))::int;
$$;

create or replace function month_start_day(ym text) returns int
language sql immutable as $$ select day_index(ym || '-01'); $$;

create or replace function month_end_day(ym text) returns int
language sql immutable as $$ select month_start_day(ym) + days_in_month(ym) - 1; $$;

create or replace function overlap_days(a_start int, a_end int, b_start int, b_end int) returns int
language sql immutable as $$
  select greatest(0, least(a_end, b_end) - greatest(a_start, b_start) + 1);
$$;

create or replace function months_to_day_count(months jsonb) returns int
language sql immutable as $$
  select coalesce(sum(days_in_month(m)), 0)::int from jsonb_array_elements_text(months) as m;
$$;

create or replace function overlap_with_months(range_start int, range_end int, months jsonb) returns int
language sql immutable as $$
  select coalesce(sum(overlap_days(range_start, range_end, month_start_day(m), month_end_day(m))), 0)::int
  from jsonb_array_elements_text(months) as m;
$$;

create or replace function window_to_months(start_date text, end_date text) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(to_char(gs, 'YYYY-MM') order by gs), '[]'::jsonb)
  from generate_series(date_trunc('month', start_date::date), date_trunc('month', end_date::date), interval '1 month') as gs;
$$;

create or replace function months_shared_count(a jsonb, b jsonb) returns int
language sql immutable as $$
  select count(*)::int from jsonb_array_elements_text(a) as x where x in (select jsonb_array_elements_text(b));
$$;

create or replace function months_set_equal(a jsonb, b jsonb) returns boolean
language sql immutable as $$
  select
    (select array_agg(distinct x order by x) from jsonb_array_elements_text(a) as x)
    is not distinct from
    (select array_agg(distinct x order by x) from jsonb_array_elements_text(b) as x);
$$;

-- post is a post's `date` jsonb column:
--   {"mode":"focused","startDate":...,"endDate":...}
--   {"mode":"broad","months":[...]}
--   {"mode":"flexible","earliest":...,"latest":...}

create or replace function score_specific_vs_focused(s_start int, s_end int, d_s int, post jsonb) returns numeric
language plpgsql immutable as $$
declare
  p_start int := day_index(post->>'startDate');
  p_end int := day_index(post->>'endDate');
  d_p int := day_index(post->>'endDate') - day_index(post->>'startDate') + 1;
  v_overlap int := overlap_days(s_start, s_end, p_start, p_end);
  cov numeric;
  prec numeric;
  base numeric;
begin
  if v_overlap = 0 then return 0; end if;
  cov := v_overlap::numeric / d_s;
  prec := v_overlap::numeric / d_p;
  base := 65 * cov + 35 * prec;
  if s_start = p_start and s_end = p_end then return base + 25; end if;
  if s_start >= p_start and s_end <= p_end then return base + 15; end if;
  return base;
end;
$$;

create or replace function score_specific_vs_broad(s_start int, s_end int, d_s int, post jsonb) returns numeric
language plpgsql immutable as $$
declare
  months jsonb := coalesce(post->'months', '[]'::jsonb);
  v_overlap int := overlap_with_months(s_start, s_end, months);
  cov numeric;
  total_active_days int;
  prec numeric;
  base numeric;
begin
  if v_overlap = 0 then return 0; end if;
  cov := v_overlap::numeric / d_s;
  total_active_days := months_to_day_count(months);
  prec := v_overlap::numeric / total_active_days;
  base := 65 * cov + 35 * prec;
  return base - 10;
end;
$$;

create or replace function score_specific_vs_flexible(s_start int, s_end int, d_s int, post jsonb) returns numeric
language plpgsql immutable as $$
declare
  w_start int := day_index(post->>'earliest');
  w_end int := day_index(post->>'latest');
  window_length int := w_end - w_start + 1;
  cov numeric;
  prec numeric;
  base numeric;
  v_overlap int;
begin
  if s_start >= w_start and s_end <= w_end then
    cov := 1;
    prec := 1 - abs(d_s - window_length)::numeric / greatest(d_s, window_length);
    base := 65 * cov + 35 * prec;
    return base + 15;
  end if;
  v_overlap := overlap_days(s_start, s_end, w_start, w_end);
  if v_overlap = 0 then return 0; end if;
  cov := v_overlap::numeric / d_s;
  prec := v_overlap::numeric / window_length;
  return 65 * cov + 35 * prec;
end;
$$;

create or replace function score_specific_search(search jsonb, post jsonb) returns numeric
language plpgsql immutable as $$
declare
  s_start int := day_index(search->>'startDate');
  s_end int := day_index(search->>'endDate');
  d_s int := day_index(search->>'endDate') - day_index(search->>'startDate') + 1;
  post_mode text := post->>'mode';
begin
  if post_mode = 'focused' then return score_specific_vs_focused(s_start, s_end, d_s, post); end if;
  if post_mode = 'broad' then return score_specific_vs_broad(s_start, s_end, d_s, post); end if;
  return score_specific_vs_flexible(s_start, s_end, d_s, post);
end;
$$;

create or replace function score_flexible_vs_focused(months jsonb, post jsonb) returns numeric
language plpgsql immutable as $$
declare
  p_start int := day_index(post->>'startDate');
  p_end int := day_index(post->>'endDate');
  d_p int := day_index(post->>'endDate') - day_index(post->>'startDate') + 1;
  v_overlap int := overlap_with_months(p_start, p_end, months);
  cov numeric;
begin
  if v_overlap = 0 then return 0; end if;
  cov := v_overlap::numeric / d_p;
  return 65 * cov + 35 * 1;
end;
$$;

create or replace function score_flexible_vs_broad(months jsonb, post jsonb) returns numeric
language plpgsql immutable as $$
declare
  post_months jsonb := coalesce(post->'months', '[]'::jsonb);
  shared int := months_shared_count(months, post_months);
  cov numeric;
  prec numeric;
  base numeric;
begin
  if shared = 0 then return 0; end if;
  cov := shared::numeric / jsonb_array_length(months);
  prec := shared::numeric / jsonb_array_length(post_months);
  base := 65 * cov + 35 * prec;
  if months_set_equal(months, post_months) then return base + 20; end if;
  return base;
end;
$$;

create or replace function score_flexible_vs_flexible(months jsonb, post jsonb) returns numeric
language plpgsql immutable as $$
declare
  window_months jsonb := window_to_months(post->>'earliest', post->>'latest');
  shared int := months_shared_count(months, window_months);
  cov numeric;
begin
  if shared = 0 then return 0; end if;
  cov := shared::numeric / jsonb_array_length(months);
  return 65 * cov + 35 * 0.8;
end;
$$;

create or replace function score_flexible_search(search jsonb, post jsonb) returns numeric
language plpgsql immutable as $$
declare
  months jsonb := coalesce(search->'months', '[]'::jsonb);
  post_mode text := post->>'mode';
begin
  if post_mode = 'focused' then return score_flexible_vs_focused(months, post); end if;
  if post_mode = 'broad' then return score_flexible_vs_broad(months, post); end if;
  return score_flexible_vs_flexible(months, post);
end;
$$;

create or replace function compute_relevance_score(search jsonb, post_date jsonb) returns numeric
language plpgsql immutable as $$
declare
  search_mode text := search->>'mode';
begin
  if search is null then return 0; end if;
  if search_mode = 'specific' then
    if coalesce(search->>'startDate', '') = '' or coalesce(search->>'endDate', '') = '' then
      return 0;
    end if;
    return score_specific_search(search, post_date);
  end if;
  if jsonb_array_length(coalesce(search->'months', '[]'::jsonb)) = 0 then
    return 0;
  end if;
  return score_flexible_search(search, post_date);
end;
$$;

-- ---------- The RPC itself ----------
--
-- Replaces the client-side filteredPosts computation (app/page.tsx) for the
-- Supabase-backed store. Keyset-paginated: p_cursor_created_at (plain browsing/filtering)
-- or (p_cursor_score, p_cursor_created_at) (an active date search, ranked by relevance)
-- identify the last row of the previous page, so a new post landing at the top mid-session
-- can't shift the window and skip/duplicate rows the way offset pagination would.
--
-- SECURITY INVOKER (the default) is correct here, not SECURITY DEFINER: every table this
-- reads is already exactly as readable to the calling role as this function needs —
-- posts/profiles are publicly SELECT-able per their RLS policies and column grants
-- (migrations 0001/0002/0004), and the saved_posts EXISTS check runs as the caller, so a
-- signed-in user can only ever match their own saved_posts rows, same as if they queried
-- it directly.
create or replace function search_posts(
  p_destinations jsonb default '[]'::jsonb,
  p_vibe text default null,
  p_gender text default null,
  p_age_min int default null,
  p_age_max int default null,
  p_saved_only boolean default false,
  p_date_search jsonb default null,
  p_cursor_score numeric default null,
  p_cursor_created_at timestamptz default null,
  p_limit int default 20
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
  profile_about text,
  relevance_score numeric
)
language plpgsql
stable
as $$
declare
  v_caller text := auth.jwt() ->> 'sub';
begin
  return query
  with candidates as (
    select
      p.id, p.user_id, p.destinations, p.date, p.vibes, p.bio, p.share_contact, p.created_at,
      pr.name as profile_name, pr.age as profile_age, pr.gender as profile_gender,
      pr.avatar_color as profile_avatar_color, pr.avatar_url as profile_avatar_url, pr.about as profile_about,
      case when p_date_search is not null then compute_relevance_score(p_date_search, p.date) else null end as v_score
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
  )
  select
    c.id, c.user_id, c.destinations, c.date, c.vibes, c.bio, c.share_contact, c.created_at,
    c.profile_name, c.profile_age, c.profile_gender, c.profile_avatar_color, c.profile_avatar_url, c.profile_about,
    c.v_score
  from candidates c
  where
    (p_date_search is null or c.v_score > 0)
    and (
      case
        when p_date_search is not null then
          (p_cursor_score is null and p_cursor_created_at is null)
          or (c.v_score, c.created_at) < (p_cursor_score, p_cursor_created_at)
        else
          p_cursor_created_at is null or c.created_at < p_cursor_created_at
      end
    )
  order by
    case when p_date_search is not null then c.v_score end desc nulls last,
    c.created_at desc
  limit p_limit;
end;
$$;

grant execute on function search_posts(jsonb, text, text, int, int, boolean, jsonb, numeric, timestamptz, int)
  to anon, authenticated;
