-- profiles.whatsapp/email are intentionally excluded from the client SELECT grant
-- (see migrations 0001/0005), but Postgres requires SELECT on any column referenced
-- in an `ON CONFLICT DO UPDATE SET ...` clause to evaluate it against the existing
-- row — so the client-side upsert() in AuthContext.tsx has been silently failing
-- with "permission denied for table profiles" for any signed-in user, and whatsapp/
-- email were never actually being written. Route the write through a SECURITY
-- DEFINER function instead: it runs with the owning role's privileges (bypassing the
-- column-grant restriction) while still checking the caller's own Clerk identity, so
-- the columns stay unreadable through the REST API but are writable via this one
-- narrow path.
create or replace function sync_profile(
  p_id text,
  p_name text,
  p_whatsapp text,
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

  insert into profiles (id, name, whatsapp, avatar_url, email)
  values (p_id, p_name, p_whatsapp, p_avatar_url, p_email)
  on conflict (id) do update
    set name = excluded.name,
        whatsapp = excluded.whatsapp,
        avatar_url = excluded.avatar_url,
        email = excluded.email;
end;
$$;

grant execute on function sync_profile(text, text, text, text, text) to authenticated;
