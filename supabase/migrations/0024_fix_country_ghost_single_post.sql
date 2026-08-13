-- 0023's search_posts_map_country_ghosts used min()/max() to pull the single post's
-- details out of a one-row group, but Postgres has no min(uuid) aggregate, so every call
-- failed outright. array_agg picks the same row without needing an ordering operator on
-- the column type.
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
  -- Per destination entry, not per post: a trip can be precise about one country and
  -- vague about another ("Bangkok, then somewhere in Laos"), and deserves a real pin in
  -- Thailand alongside a ghost in Laos.
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
      -- Ordered so the pick is deterministic rather than dependent on scan order.
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
    -- Author details are only meaningful when the marker stands for exactly one post;
    -- above that the marker shows a count instead of a face.
    case when g.post_count = 1 then g.first_post_id end,
    case when g.post_count = 1 then g.first_author_name end,
    case when g.post_count = 1 then g.first_avatar_url end,
    case when g.post_count = 1 then g.first_avatar_color end
  from grouped g;
end;
$$;

grant execute on function search_posts_map_country_ghosts(text, text, int, int, boolean, jsonb)
  to anon, authenticated;
