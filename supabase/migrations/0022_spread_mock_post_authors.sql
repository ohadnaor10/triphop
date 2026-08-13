-- The mock load-test posts from 0019 all belonged to one synthetic profile. Now that map
-- markers draw the poster's avatar (0021), that meant every marker on the map rendered
-- the same circle — which hides the one thing the avatars exist to show, and reads as a
-- bug rather than as test data.
--
-- Spreads them over 20 profiles with distinct names and the same gradient palette real
-- profiles use (AVATAR_COLORS in app/lib/postsStore.ts). Names were chosen for distinct
-- initials, since none of these has a photo and the avatar falls back to initials.
--
-- Only touches rows owned by the mock user, so real posts are untouched. Cleanup is still
-- one statement (posts and post_places both cascade from profiles):
--   delete from profiles where id like 'mock-load-user-%';

insert into profiles (id, name, age, gender, avatar_color, whatsapp, birth_date) values
  ('mock-load-user-01', 'Alma Reyes', 22, 'Female', 'bg-gradient-to-br from-orange-400 to-pink-500', '1000000900', '2004-06-15'),
  ('mock-load-user-02', 'Boris Novak', 25, 'Male', 'bg-gradient-to-br from-sky-400 to-indigo-500', '1000000901', '2001-06-15'),
  ('mock-load-user-03', 'Carla Dominguez', 28, 'Female', 'bg-gradient-to-br from-emerald-400 to-teal-500', '1000000902', '1998-06-15'),
  ('mock-load-user-04', 'Dane Okafor', 31, 'Male', 'bg-gradient-to-br from-fuchsia-400 to-purple-500', '1000000903', '1995-06-15'),
  ('mock-load-user-05', 'Elif Yilmaz', 34, 'Female', 'bg-gradient-to-br from-orange-400 to-pink-500', '1000000904', '1992-06-15'),
  ('mock-load-user-06', 'Felix Brandt', 37, 'Male', 'bg-gradient-to-br from-sky-400 to-indigo-500', '1000000905', '1989-06-15'),
  ('mock-load-user-07', 'Gaia Marino', 40, 'Female', 'bg-gradient-to-br from-emerald-400 to-teal-500', '1000000906', '1986-06-15'),
  ('mock-load-user-08', 'Hugo Lindqvist', 43, 'Male', 'bg-gradient-to-br from-fuchsia-400 to-purple-500', '1000000907', '1983-06-15'),
  ('mock-load-user-09', 'Iris Delacroix', 24, 'Female', 'bg-gradient-to-br from-orange-400 to-pink-500', '1000000908', '2002-06-15'),
  ('mock-load-user-10', 'Jonah Weiss', 27, 'Male', 'bg-gradient-to-br from-sky-400 to-indigo-500', '1000000909', '1999-06-15'),
  ('mock-load-user-11', 'Kira Petrova', 30, 'Female', 'bg-gradient-to-br from-emerald-400 to-teal-500', '1000000910', '1996-06-15'),
  ('mock-load-user-12', 'Liam O''Donnell', 33, 'Male', 'bg-gradient-to-br from-fuchsia-400 to-purple-500', '1000000911', '1993-06-15'),
  ('mock-load-user-13', 'Maya Sharma', 36, 'Female', 'bg-gradient-to-br from-orange-400 to-pink-500', '1000000912', '1990-06-15'),
  ('mock-load-user-14', 'Nils Andersen', 39, 'Male', 'bg-gradient-to-br from-sky-400 to-indigo-500', '1000000913', '1987-06-15'),
  ('mock-load-user-15', 'Olive Barnes', 42, 'Female', 'bg-gradient-to-br from-emerald-400 to-teal-500', '1000000914', '1984-06-15'),
  ('mock-load-user-16', 'Pablo Herrera', 23, 'Male', 'bg-gradient-to-br from-fuchsia-400 to-purple-500', '1000000915', '2003-06-15'),
  ('mock-load-user-17', 'Quinn Fraser', 26, 'Female', 'bg-gradient-to-br from-orange-400 to-pink-500', '1000000916', '2000-06-15'),
  ('mock-load-user-18', 'Rania Haddad', 29, 'Male', 'bg-gradient-to-br from-sky-400 to-indigo-500', '1000000917', '1997-06-15'),
  ('mock-load-user-19', 'Sofia Duarte', 32, 'Female', 'bg-gradient-to-br from-emerald-400 to-teal-500', '1000000918', '1994-06-15'),
  ('mock-load-user-20', 'Tobias Meyer', 35, 'Male', 'bg-gradient-to-br from-fuchsia-400 to-purple-500', '1000000919', '1991-06-15')
on conflict (id) do nothing;

-- Round-robin by a stable ordering, so the spread is deterministic and every profile
-- carries a similar share rather than one avatar dominating by chance.
with numbered as (
  select id, (row_number() over (order by id) - 1) % 20 as slot
  from posts
  where user_id = 'mock-load-user'
)
update posts p
set user_id = 'mock-load-user-' || lpad((numbered.slot + 1)::text, 2, '0')
from numbered
where p.id = numbered.id;

-- Safe only because the reassignment above already moved every post off it: deleting a
-- profile cascades to its posts, so the order of these two statements is load-bearing.
delete from profiles where id = 'mock-load-user';
