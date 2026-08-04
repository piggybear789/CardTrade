-- 0029_stripe_identity.sql
--
-- Real provider-hosted identity verification (Req 2.2, 2.3, 2.5, 8.4).
--
-- The former provider had no public KYC API, so verification was simulated and
-- the Police_Evidence_Pack was built from fabricated identity data. Stripe
-- Identity performs a genuine document + selfie check and returns extracted,
-- verified fields, so the evidence pack becomes real.
--
-- To read those fields back we need the provider session id: the
-- `identity.verification_session.*` webhook carries no other link to a Profile,
-- and the verified outputs live on the session, not on the Profile.

alter table cardtrade.profiles
  add column if not exists identity_session_id text;

comment on column cardtrade.profiles.identity_session_id is
  'Provider identity verification session (Stripe: vs_...). Used to read back '
  'verified_outputs for the Police_Evidence_Pack (Req 2.5, 8.4). Not a '
  'credential, but the data it points at is sensitive: server-only, never '
  'returned to a client component.';

-- NO grant is needed, and none is given on purpose.
--
-- `authenticated` holds column-level UPDATE on `display_name` and
-- `contact_email` ONLY, rather than table-level UPDATE, so a column added here
-- is not writable by a signed-in User by default. That is the desired outcome: a
-- User must never be able to point their Profile at someone else's verification
-- session. Only the service-role webhook path writes this column.
--
-- Verified with:
--   select grantee, privilege_type, column_name
--     from information_schema.column_privileges
--    where table_schema='cardtrade' and table_name='profiles'
--      and grantee='authenticated' and privilege_type='UPDATE';
