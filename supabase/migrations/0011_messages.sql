-- Private messaging between users. Row-level security alone is enough to keep
-- conversations private (unlike profiles/posts, nothing here needs to be publicly
-- readable), so this mirrors the saved_posts pattern from migration 0001 rather than
-- the profiles-style column-grant + SECURITY DEFINER dance.
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  sender_id text not null references profiles (id) on delete cascade,
  recipient_id text not null references profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint messages_body_length check (char_length(btrim(body)) > 0 and char_length(body) <= 2000),
  constraint messages_no_self_send check (sender_id <> recipient_id)
);

-- Every conversation-list query looks up "the other participant of each thread I'm in,
-- newest first" — least/greatest gives a canonical per-pair key so both directions of a
-- conversation share one index entry.
create index if not exists messages_pair_idx on messages (least(sender_id, recipient_id), greatest(sender_id, recipient_id), created_at desc);
create index if not exists messages_unread_idx on messages (recipient_id, read_at) where read_at is null;

alter table messages enable row level security;

create policy "participants can read their messages"
  on messages for select
  using ((auth.jwt() ->> 'sub') in (sender_id, recipient_id));

create policy "users can send messages as themselves"
  on messages for insert
  with check ((auth.jwt() ->> 'sub') = sender_id);

create policy "recipients can mark messages read"
  on messages for update
  using ((auth.jwt() ->> 'sub') = recipient_id)
  with check ((auth.jwt() ->> 'sub') = recipient_id);

-- One row per conversation the caller is in, with the latest message — security_invoker
-- makes the view enforce RLS as the querying role rather than the (more privileged)
-- view owner, so it can't be used to see other people's threads.
create or replace view my_conversations
with (security_invoker = true) as
select distinct on (counterpart_id)
  counterpart_id,
  id as last_message_id,
  body as last_message_body,
  sender_id as last_message_sender_id,
  created_at as last_message_at
from (
  select
    m.*,
    case when m.sender_id = (auth.jwt() ->> 'sub') then m.recipient_id else m.sender_id end as counterpart_id
  from messages m
  where (auth.jwt() ->> 'sub') in (m.sender_id, m.recipient_id)
) per_message
order by counterpart_id, created_at desc;

grant select on my_conversations to authenticated;

-- Unread count per counterpart, kept separate from my_conversations since DISTINCT ON
-- and a GROUP BY aggregate don't compose in one query.
create or replace view my_unread_counts
with (security_invoker = true) as
select sender_id as counterpart_id, count(*) as unread_count
from messages
where recipient_id = (auth.jwt() ->> 'sub') and read_at is null
group by sender_id;

grant select on my_unread_counts to authenticated;

-- Total unread badge for the nav — a plain (non-SECURITY DEFINER) function still runs
-- with the caller's own row visibility, so this is naturally scoped by the same RLS
-- policy above.
create or replace function get_unread_message_count()
returns bigint
language sql
stable
as $$
  select count(*) from messages where recipient_id = (auth.jwt() ->> 'sub') and read_at is null;
$$;

grant execute on function get_unread_message_count() to authenticated;

alter publication supabase_realtime add table messages;
