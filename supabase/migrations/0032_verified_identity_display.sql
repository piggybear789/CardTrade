-- 0032_verified_identity_display.sql
--
-- Progressive disclosure of provider-verified identity, plus a security fix on
-- the `public_profiles` view.
--
-- =============================================================================
-- 1. SECURITY FIX: public_profiles was writable by any signed-in user
-- =============================================================================
--
-- `public_profiles` is a plain (non-`security_invoker`) view over `profiles`, so
-- it executes with the VIEW OWNER's privileges and bypasses the owner-only RLS
-- policy on the base table. That is intentional for SELECT — it is the public
-- projection — but `authenticated` had also been granted INSERT/UPDATE/DELETE.
--
-- Because the view is simple enough to be auto-updatable, that let ANY signed-in
-- user write ANY other user's row:
--
--   set role authenticated;
--   update cardtrade.public_profiles set rating = 5.0 where id = <any user>;
--   -- succeeded, bypassing profiles_owner_update
--
-- i.e. a user could forge their own reputation or destroy a competitor's.
-- Reproduced against this database before writing this migration.
--
-- Ratings are derived data maintained by the service role; nothing should write
-- them through the public view.

revoke insert, update, delete on cardtrade.public_profiles from authenticated;
revoke insert, update, delete on cardtrade.public_profiles from anon;

-- =============================================================================
-- 2. Verified identity fields
-- =============================================================================
--
-- The platform DOES need to show verified identity — it is the trust primitive
-- for a peer-to-peer marketplace — but the exposure is staged:
--
--   public          -> first name + a verified badge  ("Verified · Daniel O.")
--   at commitment   -> full verified legal name        (about to pay / lock
--                      collateral / accept a trade)
--   never           -> date of birth, document type, document number
--
-- What is published is not really a name, it is a LINK between a pseudonymous
-- handle and a government-verified legal identity. Combined with public listing
-- values and the meetup locations this app stores, a globally readable verified
-- name would let a scraper assemble "real person, this area, this much
-- inventory". Hence first name only in the public projection.
--
-- Document numbers are deliberately NOT mirrored here. If a lawful request
-- arrives, the full record lives in the provider's dashboard, where it is their
-- compliance surface rather than ours.

alter table cardtrade.profiles
  add column if not exists identity_verified_name       text,
  add column if not exists identity_verified_first_name text,
  add column if not exists identity_verified_at         timestamptz,
  add column if not exists identity_is_adult            boolean;

comment on column cardtrade.profiles.identity_verified_name is
  'Full legal name as verified by the identity provider against a government '
  'document. GATED: readable only by the owner (profiles RLS is owner-only) or '
  'by the service role, and disclosed to a counterparty only at a commitment '
  'point. Never add this to public_profiles.';

comment on column cardtrade.profiles.identity_verified_first_name is
  'Given name only, safe for public display alongside the verified badge. '
  'Exposed through the public_profiles view.';

comment on column cardtrade.profiles.identity_is_adult is
  'Derived at verification time from the provider''s verified date of birth. '
  'The date itself is deliberately NEVER stored: a boolean answers the only '
  'question the platform needs to ask and is far less sensitive.';

-- =============================================================================
-- 3. Public projection
-- =============================================================================
--
-- `identity_verified` reports IDENTITY verification (kyc_status), which is the
-- honest basis for a trust badge. It is kept separate from the existing
-- `is_verified`, which reports PAYEE onboarding ("can be paid") — two different
-- gates that must not be conflated.

create or replace view cardtrade.public_profiles as
select
  id,
  display_name,
  rating,
  rating_count,
  merchant_status = 'APPROVED'::cardtrade.merchant_status
    and merchant_settlements_enabled                      as is_verified,
  kyc_status = 'VERIFIED'::cardtrade.kyc_status           as identity_verified,
  identity_verified_first_name                            as identity_first_name
from cardtrade.profiles;

-- Read-only, for both roles. Deliberately no write grants: see section 1.
grant select on cardtrade.public_profiles to anon, authenticated;
