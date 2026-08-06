-- Profile photo (synced down from Clerk's account photo, see AuthContext.tsx), an
-- optional "about me" bio distinct from a post's own trip-specific bio, and a birth
-- date collected instead of a raw age (age is still stored/derived for existing
-- display and filter code, but birth_date is the source of truth going forward).
alter table profiles add column if not exists avatar_url text;
alter table profiles add column if not exists about text;
alter table profiles add column if not exists birth_date date;

-- Re-grant the public SELECT column list (see migration 0001) to include the new
-- public-facing columns. whatsapp stays excluded; birth_date is included here for
-- simplicity — the app already surfaces the derived age publicly, and no UI path
-- renders another user's birth_date, only the signed-in owner's own for editing.
revoke select on profiles from anon, authenticated;
grant select (id, name, age, gender, avatar_color, avatar_url, about, birth_date, created_at)
  on profiles to anon, authenticated;
