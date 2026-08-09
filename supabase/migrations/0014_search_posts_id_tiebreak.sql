-- search_posts()'s keyset pagination cursor was created_at-only. Multiple posts can
-- (and, with any bulk-created batch, reliably do — e.g. the seed data in 0008, where
-- 39 of 41 rows share the exact same microsecond-precision created_at from one bulk
-- insert) share the exact same created_at. Once a page's cursor lands on a value with
-- ties, `created_at < cursor` is a *strict* inequality that excludes every row sharing
-- that timestamp — not just the ones already returned — so pagination could silently
-- drop an unbounded number of rows and stop dead, appearing as "no more posts" when
-- there very much were more. Adds `id` (uuid, always unique) as a secondary sort/cursor
-- key so ties break deterministically instead of vanishing.
--
-- CREATE OR REPLACE can't be used to add a parameter — a changed parameter list creates
-- a new overload rather than replacing the old signature, which would leave PostgREST
-- with two ambiguous candidates for the same RPC name. Drop the old signature first.
drop function if exists search_posts(jsonb, text, text, int, int, boolean, jsonb, numeric, timestamptz, int);

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
  p_limit int default 20,
  p_cursor_id uuid default null
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
          (p_cursor_score is null and p_cursor_created_at is null and p_cursor_id is null)
          or (c.v_score, c.created_at, c.id) < (p_cursor_score, p_cursor_created_at, p_cursor_id)
        else
          (p_cursor_created_at is null and p_cursor_id is null)
          or (c.created_at, c.id) < (p_cursor_created_at, p_cursor_id)
      end
    )
  order by
    case when p_date_search is not null then c.v_score end desc nulls last,
    c.created_at desc,
    c.id desc
  limit p_limit;
end;
$$;

grant execute on function search_posts(jsonb, text, text, int, int, boolean, jsonb, numeric, timestamptz, int, uuid)
  to anon, authenticated;
