-- CardTrade — 0005_merchant_onboarding.sql
-- Managed Merchant (sub-merchant) onboarding state on Profiles.
--
-- WHY: Pinch can only settle funds into a merchant's own bank account, so a User
-- who receives money (a Cash_Sale seller, or a fraud victim being paid captured
-- collateral) must exist as a Managed Merchant under the platform's parent
-- merchant. Pinch's identity verification runs as part of that onboarding, so
-- these columns track BOTH "can this user be paid" and the compliance decision.
--
-- Distinct from `kyc_status`: that remains the payer-side identity gate for
-- listing/offering/transacting. `merchant_status` gates being PAID.
--
-- Pinch models compliance as a raw status string plus three independent
-- enable flags (`liveEnabled`, `transactionsEnabled`, `settlementsEnabled`), all
-- false on creation. We store the provider's values verbatim alongside a derived
-- enum so application code never string-matches provider text.
--
-- Depends on: 0001_schema.sql (profiles), 0002_rls.sql (profiles RLS).

-- =============================================================================
-- Enumerated Types
-- =============================================================================

-- Derived, application-facing onboarding state:
--   NONE      — no sub-merchant created yet (default for every Profile).
--   PENDING   — created and/or documents submitted, awaiting a Pinch decision.
--   APPROVED  — Pinch approved the merchant AND settlements are enabled.
--   REJECTED  — Pinch declined the submission.
create type merchant_status as enum ('NONE','PENDING','APPROVED','REJECTED');

-- =============================================================================
-- Profiles: sub-merchant columns
-- =============================================================================

alter table profiles
  add column merchant_ref                text,                                    -- Pinch `mch_...` id
  add column merchant_status             merchant_status not null default 'NONE',
  add column merchant_compliance_status  text,                                    -- provider status verbatim (e.g. 'new')
  add column merchant_live_enabled       boolean not null default false,
  add column merchant_transactions_enabled boolean not null default false,
  add column merchant_settlements_enabled  boolean not null default false,
  add column merchant_submitted_at       timestamptz,
  add column merchant_decision_at        timestamptz,
  add column merchant_notes              text;                                    -- compliance officer / provider notes

-- Reusable tokenised payment credential (Req 4.2 across sub-merchants).
--
-- The provider's multi-use token reuse (enabled per parent merchant) lets a
-- credential captured once under the platform merchant be used to create a
-- payment source on a payer record under ANY child merchant. That is what allows
-- a Buyer to pay a Seller who had not yet onboarded when the card was captured.
--
-- SENSITIVITY: this is not a card number, but it IS a reusable payment
-- credential. It is written and read only by the service-role client (column
-- UPDATE is revoked below and `profiles` RLS is owner-only for reads, so it must
-- never be included in a client-facing select).
alter table profiles
  add column payment_token      text,
  add column payment_token_type text check (payment_token_type in ('credit-card','bank-account'));

-- A provider merchant id maps to at most one Profile. The webhook handler
-- resolves the target Profile from `merchant_ref`, so this is both a uniqueness
-- guarantee and the lookup index.
create unique index profiles_merchant_ref_key
  on profiles (merchant_ref)
  where merchant_ref is not null;

-- =============================================================================
-- Payer references, per merchant
-- =============================================================================
--
-- A provider Payer belongs to the merchant it was created under, so a Buyer has
-- one payer record on the platform merchant plus one per sub-merchant they have
-- ever paid. `merchant_ref = ''` denotes the platform (parent) merchant so the
-- unique constraint covers it without a nullable key.
create table payer_refs (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references profiles(id) on delete cascade,
  merchant_ref text not null default '',
  payer_id     text not null,
  created_at   timestamptz not null default now(),
  unique (profile_id, merchant_ref)
);

create index payer_refs_profile_idx on payer_refs (profile_id);

-- Service-role only: RLS is enabled with NO policies, so the anon/authenticated
-- roles can neither read nor write. Every access goes through the orchestrators'
-- admin client.
alter table payer_refs enable row level security;

comment on table payer_refs is
  'Provider Payer id per (Profile, merchant). merchant_ref = '''' means the platform merchant.';

comment on column profiles.merchant_ref is
  'Pinch Managed Merchant id (mch_...). Null until sub-merchant onboarding starts.';
comment on column profiles.merchant_settlements_enabled is
  'Provider flag: funds may be settled to this merchant. Required before the user can be paid.';

-- =============================================================================
-- Privilege hardening
-- =============================================================================
--
-- `profiles_owner_update` (0002_rls.sql) lets a User update their own row, which
-- is correct for display_name/contact_email but must NOT extend to
-- provider-controlled state: a User could otherwise mark themselves VERIFIED or
-- settlement-enabled. RLS controls WHICH ROWS are writable; column privileges
-- control WHICH COLUMNS. All of these columns are written exclusively by the
-- service-role client (webhook handler / orchestrators), which bypasses both.
--
-- NOTE: a table-level `grant update` cannot be narrowed by a column-level
-- `revoke`. The table grant must be dropped and re-granted for exactly the
-- columns a User may edit.
--
-- This also closes the same hole on the pre-existing columns: `kyc_status`
-- (a User could mark themselves VERIFIED), `is_admin` (privilege escalation),
-- and `rating`/`rating_count` (self-inflated seller reputation).
revoke update on profiles from authenticated;
revoke update on profiles from anon;

grant update (display_name, contact_email) on profiles to authenticated;
