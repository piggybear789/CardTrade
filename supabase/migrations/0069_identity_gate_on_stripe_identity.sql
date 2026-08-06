-- 0069: Stripe Identity becomes the Identity_Gate; Connect becomes payout only.
--
-- WHAT CHANGES, AND WHY IT IS NOT THE OLD TWO-GATE BUG
-- ----------------------------------------------------
-- Until now the Identity_Gate was `merchant_status = 'APPROVED' and
-- merchant_settlements_enabled` — Connect onboarding finished. That was a
-- deliberate, recorded compromise: Connect enabling transfers is the provider
-- saying the flow it hosts completed, but it does NOT prove a government document
-- or a selfie was checked, because Connect can defer document collection. Both
-- `product.md` and `stripe-payments.md` record that as an "accepted assurance
-- limit" and name the exit condition: when Stripe grants document verification,
-- add its accepted status on top.
--
-- That exit condition has arrived, via Stripe Identity rather than Connect
-- Additional Document Verification. So the gate now reads a real document check.
--
-- THIS IS NOT A REINTRODUCTION OF THE RETIRED KYC SEAM. That one was PARALLEL:
-- `kyc_status` answered "verified" on some surfaces while `merchant_status`
-- answered it on others, so a member could be badged verified in one place and
-- unverified in another. This is SEQUENTIAL and there is still exactly ONE gate
-- predicate:
--
--   * `identity_check_status = 'VERIFIED'`  -> the Identity_Gate. Unlocks listing,
--     selling, trade access, and being a disclosed counterparty.
--   * `canReceiveFunds` (Connect + merchant_ref)  -> unlocks an actual transfer.
--     Unchanged, and still a mechanical precondition rather than a second opinion
--     about identity.
--
-- Two STEPS, one ANSWER to "is this member verified". A member who has verified
-- their identity but not set up payouts is verified and can list; they simply
-- cannot be paid yet, which the buy surfaces already handle (the "Payout setup
-- needed" state predates this migration).
--
-- COLUMN NAMES ARE DELIBERATELY NOT THE RETIRED ONES. Migration 0043 dropped
-- `kyc_status`, `kyc_reason`, `identity_session_id`, `identity_verified_name`,
-- `identity_verified_at` and `identity_is_adult`. The independence property in
-- tests/property/identityGate.test.ts still asserts that a value in any of those
-- cannot influence the gate, so reusing a retired name would make that property
-- self-contradictory and would read, to anyone grepping, as the old bug returning.
-- The `identity_check_` prefix says which product produced the fact.

-- =============================================================================
-- 1. The Identity check state
-- =============================================================================

create type cardtrade.identity_check_status as enum (
  'NONE',      -- never started
  'PENDING',   -- session created, member has not finished or Stripe is processing
  'VERIFIED',  -- document + selfie accepted
  'FAILED'     -- Stripe could not verify; the member may retry
);

comment on type cardtrade.identity_check_status is
  'Stripe Identity VerificationSession outcome for a member. VERIFIED is the Identity_Gate.';

alter table cardtrade.profiles
  add column identity_check_status cardtrade.identity_check_status not null default 'NONE',
  -- The `vs_...` VerificationSession id, so a webhook can be reconciled to a
  -- Profile and a member can resume rather than starting a second session.
  add column identity_check_session_id text,
  add column identity_check_verified_at timestamptz,
  -- The provider-VERIFIED name, from `verified_outputs`. This is the name a buyer
  -- may be shown at a commitment point, and it is the first name in this system
  -- backed by a checked document rather than by whatever Connect happened to hold.
  add column identity_check_name text;

comment on column cardtrade.profiles.identity_check_status is
  'Stripe Identity outcome. VERIFIED is THE Identity_Gate — see domain/identity/identityGate.ts. Never written by a member; only by the Identity webhook or a read-back.';

comment on column cardtrade.profiles.identity_check_name is
  'Full name from Stripe Identity verified_outputs, i.e. read off a government document. Written monotonically absent->present so a later event cannot blank a name already disclosed.';

-- Column-level SELECT grants for these four are at the END of this migration, after
-- the trigger functions, and that position is load-bearing. A column-level grant
-- statement contains the same keyword-then-open-parenthesis sequence that the
-- extraction regex for `set_item_seller_identity_verified()` in
-- tests/property/identityGate.test.ts scans for, and that regex matches lazily
-- across newlines up to `into new.seller_identity_verified`. A grant placed above
-- the function therefore swallows everything between the two and the test fails
-- loudly — which is the behaviour it exists for.

-- Resolving a webhook to a Profile is a lookup on the session id.
create index profiles_identity_check_session_idx
  on cardtrade.profiles (identity_check_session_id)
  where identity_check_session_id is not null;

-- =============================================================================
-- 2. The gate expressions
-- =============================================================================
--
-- ALL THREE COPIES MOVE TOGETHER. `public_profiles.is_verified` and the two
-- `seller_identity_verified` trigger functions are the SQL half of one predicate,
-- and tests/property/identityGate.test.ts (Req 21.6) reads the newest migration
-- defining each and evaluates it against `satisfiesIdentityGate` over every input.
-- Changing one and not the others is the 0060 failure exactly.

create or replace view cardtrade.public_profiles as
  select
    id,
    display_name,
    rating,
    rating_count,
    (identity_check_status = 'VERIFIED'::cardtrade.identity_check_status) as is_verified,
    -- The disclosed GIVEN name. Now sourced from the Identity check, which read it
    -- off a document, falling back to the Connect-reported legal name for members
    -- verified before this migration. Still gate-conditioned: no name leaves this
    -- view for an unverified member.
    case
      when identity_check_status = 'VERIFIED'::cardtrade.identity_check_status
      then split_part(btrim(coalesce(identity_check_name, merchant_legal_entity_name)), ' '::text, 1)
      else null::text
    end as identity_first_name,
    region_code,
    avatar_path
  from cardtrade.profiles;

comment on view cardtrade.public_profiles is
  'The catalog-safe projection of a Profile. `is_verified` is the Identity_Gate: a Stripe Identity document + selfie check accepted (0069). It is NOT a statement that the member can be paid — that is canReceiveFunds, which additionally needs Connect. Never add legal name, date of birth, document numbers, address or contact details.';

grant select on cardtrade.public_profiles to anon, authenticated;

-- The denormalised copy on items, written on insert.
create or replace function cardtrade.set_item_seller_identity_verified()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select (identity_check_status = 'VERIFIED'::cardtrade.identity_check_status)
    into new.seller_identity_verified
  from cardtrade.profiles
  where id = new.owner_id;

  new.seller_identity_verified := coalesce(new.seller_identity_verified, false);
  return new;
end;
$$;

-- Propagation when a Profile's gate state changes.
create or replace function cardtrade.sync_items_seller_identity_verified()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  verified boolean;
begin
  verified := (new.identity_check_status = 'VERIFIED'::cardtrade.identity_check_status);

  update cardtrade.items
     set seller_identity_verified = verified
   where owner_id = new.id
     and seller_identity_verified is distinct from verified;

  return new;
end;
$$;

-- THE TRIGGER COLUMN LIST MUST MATCH WHAT THE GATE READS. 0060 narrowed this to
-- `merchant_status` alone while the gate depended on settlements too, so the
-- transition that actually meant "onboarding finished" did not fire and every item
-- row would have frozen. The gate now depends on one column, so this watches one.
drop trigger if exists profiles_sync_items_seller_identity_verified on cardtrade.profiles;
create trigger profiles_sync_items_seller_identity_verified
  after update of identity_check_status
  on cardtrade.profiles
  for each row
  execute function cardtrade.sync_items_seller_identity_verified();

-- =============================================================================
-- 3. Backfill
-- =============================================================================
--
-- Members already through Connect with settlements active have completed a real
-- provider flow and are trading today. Dropping them back to unverified would
-- unpublish their listings and lock them out of contracts mid-flight, so they are
-- carried across as VERIFIED.
--
-- RECORDED HONESTLY: this grandfathers members whose document was never checked,
-- because Connect can defer document collection. It is a one-time compatibility
-- decision, not a statement about assurance. `identity_check_verified_at` is set
-- from the existing Connect timestamp and `identity_check_name` is left NULL — the
-- view falls back to `merchant_legal_entity_name` for exactly these rows, so no
-- disclosure is invented that a document did not support.
update cardtrade.profiles
   set identity_check_status = 'VERIFIED'::cardtrade.identity_check_status,
       identity_check_verified_at = coalesce(merchant_identity_verified_at, now())
 where merchant_status = 'APPROVED'::cardtrade.merchant_status
   and merchant_settlements_enabled;

-- Re-derive the denormalised column so items agree with the backfilled gate. The
-- trigger above only fires on future updates.
update cardtrade.items i
   set seller_identity_verified = p.identity_check_status = 'VERIFIED'::cardtrade.identity_check_status
  from cardtrade.profiles p
 where p.id = i.owner_id
   and i.seller_identity_verified is distinct from (p.identity_check_status = 'VERIFIED'::cardtrade.identity_check_status);

-- =============================================================================
-- 4. Read grants
-- =============================================================================
--
-- Members may READ their own check state (the payouts page shows it) but must never
-- write it: it is a provider assertion. NO update grant, deliberately —
-- `authenticated` holds column-level UPDATE on a short allowlist (0032), so simply
-- omitting these columns is what makes them server-only.
--
-- LAST IN THE FILE ON PURPOSE. See the note in section 1: a column-level grant
-- statement contains the same keyword-then-open-parenthesis sequence that the test's
-- extraction regex for `set_item_seller_identity_verified()` would otherwise latch
-- onto.
grant select (identity_check_status) on cardtrade.profiles to authenticated;
grant select (identity_check_session_id) on cardtrade.profiles to authenticated;
grant select (identity_check_verified_at) on cardtrade.profiles to authenticated;
grant select (identity_check_name) on cardtrade.profiles to authenticated;
