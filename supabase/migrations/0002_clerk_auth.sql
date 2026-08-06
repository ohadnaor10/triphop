-- Swap Supabase Auth for Clerk (see Supabase's Third-Party Auth support for Clerk:
-- https://supabase.com/docs/guides/auth/third-party/clerk). Clerk users are never
-- written into this project's own auth.users table, so:
--   * profiles.id can no longer be a uuid FK into auth.users — it becomes the Clerk
--     user id (text, e.g. "user_2abc...").
--   * auth.uid() no longer resolves anything for these requests — policies must read
--     the verified Clerk JWT's `sub` claim directly via auth.jwt() ->> 'sub'.
--   * the on_auth_user_created trigger can never fire (no auth.users insert happens),
--     so profile rows are now upserted client-side on first sign-in instead — see
--     app/context/AuthContext.tsx.
--
-- Before running this migration, configure Clerk as a Supabase third-party auth
-- provider (Authentication -> Sign In / Providers -> Add provider -> Clerk) in the
-- Supabase dashboard, using your Clerk instance's domain.

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists handle_new_user();

-- Every policy touching these columns must go before the type change — Postgres
-- refuses to alter a column that a policy expression still depends on.
drop policy "users can insert their own profile" on profiles;
drop policy "users can update their own profile" on profiles;
drop policy "users can insert their own posts" on posts;
drop policy "users can update their own posts" on posts;
drop policy "users can delete their own posts" on posts;
drop policy "users can read their own saves" on saved_posts;
drop policy "users can save posts for themselves" on saved_posts;
drop policy "users can unsave their own saves" on saved_posts;

alter table saved_posts drop constraint saved_posts_user_id_fkey;
alter table posts drop constraint posts_user_id_fkey;
-- profiles.id -> auth.users(id) from migration 0001: no longer meaningful once profiles
-- are keyed by Clerk's user id instead of a Supabase auth.users row.
alter table profiles drop constraint profiles_id_fkey;

alter table profiles alter column id type text;
alter table posts alter column user_id type text;
alter table saved_posts alter column user_id type text;

alter table posts
  add constraint posts_user_id_fkey foreign key (user_id) references profiles (id) on delete cascade;
alter table saved_posts
  add constraint saved_posts_user_id_fkey foreign key (user_id) references profiles (id) on delete cascade;

create policy "users can insert their own profile"
  on profiles for insert
  with check ((auth.jwt() ->> 'sub') = id);

create policy "users can update their own profile"
  on profiles for update
  using ((auth.jwt() ->> 'sub') = id)
  with check ((auth.jwt() ->> 'sub') = id);

create policy "users can insert their own posts"
  on posts for insert
  with check ((auth.jwt() ->> 'sub') = user_id);

create policy "users can update their own posts"
  on posts for update
  using ((auth.jwt() ->> 'sub') = user_id)
  with check ((auth.jwt() ->> 'sub') = user_id);

create policy "users can delete their own posts"
  on posts for delete
  using ((auth.jwt() ->> 'sub') = user_id);

create policy "users can read their own saves"
  on saved_posts for select
  using ((auth.jwt() ->> 'sub') = user_id);

create policy "users can save posts for themselves"
  on saved_posts for insert
  with check ((auth.jwt() ->> 'sub') = user_id);

create policy "users can unsave their own saves"
  on saved_posts for delete
  using ((auth.jwt() ->> 'sub') = user_id);

create or replace function get_post_contact(p_post_id uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  contact text;
begin
  if (auth.jwt() ->> 'sub') is null then
    return null;
  end if;
  select pr.whatsapp into contact
  from posts p
  join profiles pr on pr.id = p.user_id
  where p.id = p_post_id;
  return contact;
end;
$$;
