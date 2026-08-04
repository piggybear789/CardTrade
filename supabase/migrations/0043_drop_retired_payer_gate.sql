-- 0043_drop_retired_payer_gate.sql
--
-- DESTRUCTIVE. Drops the retired payer-gate columns (Req 16.9, 16.10).
--
-- Applied only after every dependant was repointed by 0041 and every code path
-- that read these columns was removed. Verified before running:
--
--   * no view depends on them (checked via pg_depend/pg_rewrite)
--   * no function or trigger body references them
--   * no application code reads them (`public_profiles.identity_verified` and
--     `identity_first_name` were repointed at the Identity_Gate and the
--     provider-verified legal name in 0041, so the view no longer needs them)
--   * `would_downgrade` was 0: no Member's presented verification state changes,
--     because every profile marked verified by the old gate also satisfies the
--     Identity_Gate
--
-- WHAT IS BEING GIVEN UP. These columns held real Stripe Identity results — with
-- `STRIPE_KYC_MODE=identity` the `/kyc` flow ran genuine document checks. This is
-- a deliberate decision to stop maintaining a second verification signal, not a
-- cleanup of dead simulation data. The accepted assurance change is recorded in
-- `.kiro/steering/stripe-payments.md` and in the spec's Requirement 20.
--
-- WHAT IS DELIBERATELY KEPT:
--   * `merchant_*` — the Identity_Gate itself and the provider-verified legal name
--   * `cash_sales.seller_*` identity snapshot — a completed contract must keep
--     showing the identity disclosed when it was agreed (Req 16.11)
--   * `items.seller_identity_verified` — repointed at the gate in 0041
--
-- Column privileges are NOT widened. `0005_merchant_onboarding.sql` revoked
-- UPDATE on `profiles` from `authenticated` and re-granted only
-- `display_name`/`contact_email`; dropping columns does not alter that, and no
-- grant is added here.

alter table cardtrade.profiles
  drop column if exists kyc_status,
  drop column if exists kyc_reason,
  drop column if exists identity_verified_name,
  drop column if exists identity_verified_first_name,
  drop column if exists identity_verified_at,
  drop column if exists identity_is_adult,
  drop column if exists identity_session_id;

-- The enum has no remaining referents once the column is gone.
drop type if exists cardtrade.kyc_status;

comment on table cardtrade.profiles is
  'A Member account. Verification is the Identity_Gate — merchant_status APPROVED '
  'with merchant_settlements_enabled — and there is no separate payer gate: the '
  'kyc_status and identity_verified_* columns were dropped in 0043. The only '
  'identity held is merchant_legal_entity_name, as reported by the provider for '
  'the connected account.';
