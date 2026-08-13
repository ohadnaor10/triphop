-- Raw post locations for the viewport, for client-side clustering.
--
-- search_posts_map()'s fixed zoom tiers (0016) decide *what* to group by before looking
-- at how the data is actually distributed, which produces two bad outcomes at once: at
-- zoom 5 every Thai post collapses into one bubble pinned to the centre of Thailand's
-- bounding box — out in the Gulf, nowhere near anything — while two cities 20km apart
-- render as separate overlapping bubbles the moment the zoom crosses 5. Grouping needs
-- to be driven by how far apart things are *on screen*, which only the client knows.
--
-- So this returns one row per (post, place) with no grouping at all. The rows are tiny —
-- two floats, two ids and a label — so a few thousand of them cost far less to ship than
-- a single page of the feed. search_posts_map() stays as the over-cap fallback for when
-- a viewport holds more locations than are sensible to send.
--
-- Filters and their semantics are identical to search_posts_map(), deliberately: the two
-- must agree on what "matching" means or the map contradicts itself at the cap boundary.
create or replace function search_posts_map_points(
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
  lng double precision
)
language plpgsql
stable
as $$
declare
  v_caller text := auth.jwt() ->> 'sub';
begin
  return query
  select p.id, pl.id, pl.name, pl.lat, pl.lng
  from posts p
  join profiles pr on pr.id = p.user_id
  join post_places pp on pp.post_id = p.id
  join places pl on pl.id = pp.place_id
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
    and pl.lat between p_min_lat and p_max_lat
    -- A viewport crossing the antimeridian arrives with min_lng > max_lng, which BETWEEN
    -- would read as an empty range and silently blank the map over the Pacific.
    and case
      when p_min_lng <= p_max_lng then pl.lng between p_min_lng and p_max_lng
      else pl.lng >= p_min_lng or pl.lng <= p_max_lng
    end
  -- Ordered so that hitting the cap keeps a geographically coherent set rather than an
  -- arbitrary one; the client detects the cap and switches to the aggregate fallback.
  order by pl.lat, pl.lng, p.id
  limit p_limit;
end;
$$;

grant execute on function search_posts_map_points(
  text, text, int, int, boolean, jsonb, double precision, double precision, double precision, double precision, int
) to anon, authenticated;
