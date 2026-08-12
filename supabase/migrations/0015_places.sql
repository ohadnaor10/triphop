-- Permanent store of geocoded coordinates, so the feed map stops geocoding in the
-- browser. Today every visitor resolves every visible city through Mapbox at render
-- time (app/page.tsx's resolveFeedMapPoint -> app/lib/geo.ts's geocodePlace), cached
-- only in an in-memory Map for that one session — so the geocoding bill and the map's
-- first-paint latency both scale with *traffic* rather than with content. Geocoding a
-- place once, here, makes both scale with content instead, and is the precondition for
-- the map querying by viewport (see 0016_search_posts_map.sql) rather than piggybacking
-- on whatever page of the feed happens to be loaded.
--
-- Deliberately additive: posts.destinations stays exactly as it is. All destination
-- *matching* (0013_search_posts_rpc.sql: names_match / destination_matches / region
-- containment / bbox overlap) reads that free-text jsonb, and re-pointing it at place
-- ids would mean rewriting that entire layer for no gain. post_places carries
-- coordinates and nothing else; search keeps using the text.

create table if not exists places (
  id bigserial primary key,
  name text not null,
  country_code text not null,
  country_name text not null,
  lat double precision not null,
  lng double precision not null,
  -- Reference only, never the identity: Mapbox feature ids aren't guaranteed stable
  -- across geocoder versions (app/lib/geo.ts still calls the deprecated v5 endpoint),
  -- and a place can legitimately enter the table from a typed city name with no Mapbox
  -- feature behind it at all.
  mapbox_id text,
  created_at timestamptz not null default now()
);

-- The identity of a place, and the guard against the "two users post about Bangkok at
-- the same moment" race — a unique index means the second insert conflicts instead of
-- creating a duplicate, rather than relying on application-level check-then-insert.
create unique index if not exists places_identity_idx on places (lower(btrim(name)), country_code);
-- Bounding-box range scans for the map RPC. Plain btree is enough at this scale; PostGIS
-- would buy nothing here beyond an extension to maintain.
create index if not exists places_lat_lng_idx on places (lat, lng);

create table if not exists post_places (
  post_id uuid not null references posts (id) on delete cascade,
  place_id bigint not null references places (id) on delete cascade,
  primary key (post_id, place_id)
);

create index if not exists post_places_place_idx on post_places (place_id);

alter table places enable row level security;
alter table post_places enable row level security;

-- Publicly readable, like posts/profiles (migration 0001): the map has to render for
-- signed-out visitors too. Writes deliberately have no policy — they go exclusively
-- through the two SECURITY DEFINER functions below, so a client can never insert an
-- arbitrary coordinate for a place or link a post it doesn't own.
create policy "places are publicly readable" on places for select using (true);
create policy "post places are publicly readable" on post_places for select using (true);

-- Upsert-and-return for a geocoded place. SECURITY DEFINER because places has no insert
-- policy (see above). ON CONFLICT ... DO NOTHING plus the follow-up select resolves the
-- concurrent-insert race in the database rather than in the client: whichever caller
-- loses the race still gets the winner's row back.
--
-- Existing rows are never overwritten. A place's coordinates are a fact about the world,
-- not about the post being created, so the first successful geocode wins and later posts
-- reuse it — that reuse is the entire point of this table.
create or replace function resolve_place(
  p_name text,
  p_country_code text,
  p_country_name text,
  p_lat double precision,
  p_lng double precision,
  p_mapbox_id text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  if p_name is null or btrim(p_name) = '' or p_country_code is null or btrim(p_country_code) = '' then
    return null;
  end if;

  insert into places (name, country_code, country_name, lat, lng, mapbox_id)
  values (btrim(p_name), upper(btrim(p_country_code)), p_country_name, p_lat, p_lng, p_mapbox_id)
  on conflict (lower(btrim(name)), country_code) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
    from places
    where lower(btrim(name)) = lower(btrim(p_name))
      and country_code = upper(btrim(p_country_code));
  end if;

  return v_id;
end;
$$;

-- Replaces a post's whole set of place links in one call, so create and edit share the
-- same path (an edit that drops a city must drop its pin, which a pure insert can't do).
-- SECURITY DEFINER, so the ownership check has to be explicit — without it this would be
-- a way to re-pin anyone's post.
create or replace function set_post_places(p_post_id uuid, p_place_ids bigint[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller text := auth.jwt() ->> 'sub';
  v_owner text;
begin
  select user_id into v_owner from posts where id = p_post_id;
  if v_owner is null then
    raise exception 'post % not found', p_post_id;
  end if;
  if v_caller is null or v_caller <> v_owner then
    raise exception 'not allowed to set places for post %', p_post_id;
  end if;

  delete from post_places where post_id = p_post_id;

  if p_place_ids is not null and array_length(p_place_ids, 1) > 0 then
    insert into post_places (post_id, place_id)
    select p_post_id, unnest(p_place_ids)
    on conflict do nothing;
  end if;
end;
$$;

grant execute on function resolve_place(text, text, text, double precision, double precision, text)
  to authenticated;
grant execute on function set_post_places(uuid, bigint[]) to authenticated;
