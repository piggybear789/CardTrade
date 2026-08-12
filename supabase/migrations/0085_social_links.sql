-- 0085_social_links.sql
--
-- Adds optional social media links to member profiles. Stored as a JSONB object
-- keyed by platform slug. Each value is the member's handle/username on that
-- platform (not a full URL — the app builds URLs from known patterns).
--
-- Example: {"instagram": "phil_cards", "youtube": "PhilCollects"}

alter table cardtrade.profiles
  add column if not exists social_links jsonb default '{}'::jsonb;

comment on column cardtrade.profiles.social_links is
  'Optional social media handles keyed by platform slug (e.g. instagram, youtube). URLs are built from handles.';

-- The view uses an explicit column list (0069), so we must recreate it.
create or replace view cardtrade.public_profiles as
  select
    id,
    display_name,
    rating,
    rating_count,
    (identity_check_status = 'VERIFIED'::cardtrade.identity_check_status) as is_verified,
    case
      when identity_check_status = 'VERIFIED'::cardtrade.identity_check_status
      then split_part(btrim(coalesce(identity_check_name, merchant_legal_entity_name)), ' '::text, 1)
      else null::text
    end as identity_first_name,
    region_code,
    avatar_path,
    social_links
  from cardtrade.profiles;

grant select on cardtrade.public_profiles to anon, authenticated;
