-- WhatsApp number becomes an explicit, user-entered contact field (asked at onboarding,
-- editable in account settings) instead of something silently mirrored from whatever's
-- on the signer's Clerk account. sync_profile ran on every sign-in/navigation, so
-- leaving p_whatsapp wired to Clerk's own phone field would keep clobbering a
-- manually-entered number back to empty. Drop it from the routine Clerk-data sync.
drop function if exists sync_profile(text, text, text, text, text);

create or replace function sync_profile(
  p_id text,
  p_name text,
  p_avatar_url text,
  p_email text
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if (auth.jwt() ->> 'sub') is distinct from p_id then
    raise exception 'sync_profile: caller does not match profile id';
  end if;

  insert into profiles (id, name, avatar_url, email)
  values (p_id, p_name, p_avatar_url, p_email)
  on conflict (id) do update
    set name = excluded.name,
        avatar_url = excluded.avatar_url,
        email = excluded.email;
end;
$$;

grant execute on function sync_profile(text, text, text, text) to authenticated;

-- Narrow RPC for a user to set their own WhatsApp number (onboarding / account
-- settings) — same SECURITY DEFINER workaround as sync_profile, needed because
-- whatsapp carries no client SELECT grant (see migration 0001) and Postgres requires
-- SELECT on any column an ON CONFLICT DO UPDATE touches.
create or replace function update_whatsapp(p_whatsapp text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update profiles
  set whatsapp = nullif(trim(p_whatsapp), '')
  where id = (auth.jwt() ->> 'sub');
end;
$$;

grant execute on function update_whatsapp(text) to authenticated;

-- The owner needs their own number back to show/edit it, but the column has no client
-- SELECT grant at all (not even row-scoped to the owner — Postgres column grants can't
-- express "except your own row"). A SECURITY DEFINER read, scoped to the caller's own
-- id, closes that gap the same way get_post_contact does for post contacts.
create or replace function get_my_whatsapp()
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  result text;
begin
  select whatsapp into result from profiles where id = (auth.jwt() ->> 'sub');
  return result;
end;
$$;

grant execute on function get_my_whatsapp() to authenticated;

-- Per-post opt-in: sharing is a choice made per trip post, not implied by having a
-- number saved to the profile. Defaults to false.
alter table posts add column if not exists share_contact boolean not null default false;

-- get_post_contact now only hands back a number when that specific post opted in.
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
  where p.id = p_post_id and p.share_contact = true;
  return contact;
end;
$$;
