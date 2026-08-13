-- 0086_profile_bio.sql
--
-- Adds an optional short bio/description to member profiles.
-- Displayed on seller profiles and in the profile settings page.

alter table cardtrade.profiles
  add column if not exists bio text default null;

comment on column cardtrade.profiles.bio is
  'Optional short bio/description (~280 chars). Displayed on public seller profile.';
