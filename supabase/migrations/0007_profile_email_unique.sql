-- Clerk already enforces unique emails at sign-up, but enforce it at the DB level
-- too so profiles.email can never end up duplicated regardless of how a row gets
-- written (e.g. a future admin/import path that bypasses Clerk). Partial index
-- (email is nullable, and multiple NULLs are always allowed under a unique index).
create unique index if not exists profiles_email_key on profiles (email) where email is not null;
