-- 0127_public_profile_member_since.sql
--
-- "Member since" on the public seller profile.
--
-- A buyer weighing a stranger asks how long they have been around, and the profile
-- had no answer: `public_profiles` carried rating, sales and the identity check but
-- nothing about tenure. This appends `member_since` — the MONTH the account was
-- created, truncated so the view publishes tenure and not a sign-up timestamp.
--
-- Every column from 0111 is preserved in order and the new one is appended, so
-- `create or replace` is enough. `discoverable_profiles` is `select *` over this
-- view, and Postgres expands `*` when a view is created, so it is replaced too to
-- pick the column up. Grants on both views survive `create or replace` (SELECT-only
-- for anon and authenticated, per 0032/0072).

create or replace view cardtrade.public_profiles as
  select
    id,
    case
      when closed_at is null then display_name
      else 'Closed account'::text
    end as display_name,
    rating,
    rating_count,
    (identity_check_status = 'VERIFIED'::cardtrade.identity_check_status) as is_verified,
    case
      when identity_check_status = 'VERIFIED'::cardtrade.identity_check_status
      then split_part(btrim(coalesce(identity_check_name, merchant_legal_entity_name)), ' '::text, 1)
      else null::text
    end as identity_first_name,
    region_code,
    case when closed_at is null then avatar_path else null::text end as avatar_path,
    case when closed_at is null then social_links else null::jsonb end as social_links,
    case when closed_at is null then bio else null::text end as bio,
    closed_at,
    date_trunc('month', created_at) as member_since
  from cardtrade.profiles;

create or replace view cardtrade.discoverable_profiles as
  select *
  from cardtrade.public_profiles
  where closed_at is null;
