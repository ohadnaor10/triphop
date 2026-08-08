-- The mock posts seeded in 0008 predate posts.share_contact (added in 0009, defaults to
-- false). They were written with fake WhatsApp numbers specifically to demonstrate the
-- contact-reveal flow, so opt them in rather than have that demo silently go dark.
update posts
set share_contact = true
where user_id = 'dev-user-1' or user_id like 'seed-user-%';
