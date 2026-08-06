-- Core schema for triphop: user profiles + trip posts, backed by Supabase Auth.
-- Run against a Supabase project's SQL editor, or via `supabase db push`.

create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  age int,
  gender text check (gender in ('Woman', 'Man', 'Non-binary', 'Prefer not to say')),
  avatar_color text not null default 'bg-gradient-to-br from-orange-400 to-pink-500',
  whatsapp text,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "profiles are publicly readable"
  on profiles for select
  using (true);

create policy "users can insert their own profile"
  on profiles for insert
  with check (auth.uid() = id);

create policy "users can update their own profile"
  on profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  destinations jsonb not null,
  date jsonb not null,
  vibes text[] not null default '{}',
  bio text not null default '',
  created_at timestamptz not null default now()
);

alter table posts enable row level security;

create index if not exists posts_user_id_idx on posts (user_id);
create index if not exists posts_created_at_idx on posts (created_at desc);

create policy "posts are publicly readable"
  on posts for select
  using (true);

create policy "users can insert their own posts"
  on posts for insert
  with check (auth.uid() = user_id);

create policy "users can update their own posts"
  on posts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users can delete their own posts"
  on posts for delete
  using (auth.uid() = user_id);

create table if not exists saved_posts (
  user_id uuid not null references profiles (id) on delete cascade,
  post_id uuid not null references posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

alter table saved_posts enable row level security;

create policy "users can read their own saves"
  on saved_posts for select
  using (auth.uid() = user_id);

create policy "users can save posts for themselves"
  on saved_posts for insert
  with check (auth.uid() = user_id);

create policy "users can unsave their own saves"
  on saved_posts for delete
  using (auth.uid() = user_id);

-- Phone numbers must never ride along with the public posts/profiles feed — RLS is
-- row-level only, so column-level protection needs an explicit grant swap: strip
-- SELECT on whatsapp from the public roles, then hand it out only through
-- get_post_contact(), which refuses anonymous callers.
revoke select on profiles from anon, authenticated;
grant select (id, name, age, gender, avatar_color, created_at) on profiles to anon, authenticated;

create or replace function get_post_contact(p_post_id uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  contact text;
begin
  if auth.uid() is null then
    return null;
  end if;
  select pr.whatsapp into contact
  from posts p
  join profiles pr on pr.id = p.user_id
  where p.id = p_post_id;
  return contact;
end;
$$;

grant execute on function get_post_contact(uuid) to authenticated;

-- Auto-create a profile row when someone signs up (name comes from auth signup metadata).
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, whatsapp)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'whatsapp'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();
