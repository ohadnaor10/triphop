-- App now offers only Male/Female for gender (see app/page.tsx Gender type). Existing
-- values from the old Woman/Man/Non-binary/Prefer-not-to-say set won't satisfy the new
-- check constraint, so they're remapped first: Woman -> Female, Man -> Male, anything
-- else (Non-binary, Prefer not to say, null) -> null, pending the user filling it in
-- via onboarding (see app/onboarding/page.tsx).
update profiles set gender = 'Female' where gender = 'Woman';
update profiles set gender = 'Male' where gender = 'Man';
update profiles set gender = null where gender not in ('Male', 'Female');

alter table profiles drop constraint if exists profiles_gender_check;
alter table profiles add constraint profiles_gender_check check (gender in ('Male', 'Female'));
