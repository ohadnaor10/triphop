-- Email is available from Clerk's user object but was never persisted, which
-- made it impossible to look a user up in the Supabase dashboard by email
-- alongside their posts/profile. Sync it in (see AuthContext.tsx), but treat
-- it as PII like whatsapp: excluded from the public column-grant list, so it
-- stays visible in the dashboard (table owner bypasses grants) without being
-- readable through the anon/authenticated API.
alter table profiles add column if not exists email text;

revoke select on profiles from anon, authenticated;
grant select (id, name, age, gender, avatar_color, avatar_url, about, birth_date, created_at)
  on profiles to anon, authenticated;
