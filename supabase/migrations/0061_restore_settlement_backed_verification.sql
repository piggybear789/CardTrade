--
-- Restore the Identity_Gate to Connect onboarding ACTUALLY FINISHED:
--   merchant_status = 'APPROVED' AND merchant_settlements_enabled
--
-- WHY 0060 IS BEING REVERSED, AND WHY EARLIER THAN ITS OWN STATED EXIT CONDITION.
-- 0060 made the mere CREATION of a Stripe Connect recipient account the verification
-- milestone. Creating that account is one server call that happens before the member
-- has typed a single field into Stripe's hosted pages, so under 0060 a member was
-- badged verified, allowed to publish listings, allowed into trade escrow, and
-- allowed to front a cash sale as a disclosed payee, having completed no onboarding
-- whatsoever. The payouts card stated both halves of the contradiction at once —
-- "Verified Account" beside "Payouts incomplete" — because both were true of the same
-- row. 0060 named its exit condition as Stripe granting Connect Additional Document
-- Verification; it is being withdrawn ahead of that because the policy was wrong on
-- its own terms, not because the exit condition arrived. Verification that an empty
-- shell satisfies is not verification.
--
-- `merchant_settlements_enabled` is written only from
-- `configuration.recipient.capabilities.stripe_balance.stripe_transfers.status = 'active'`
-- (see `fromV2Account` in domain/services/stripe/StripeService.ts). That is the
-- provider's own statement that the flow it hosts completed, which is why it is the
-- gate rather than a separate "payout readiness" footnote.
--
-- The TypeScript predicate is `satisfiesIdentityGate` in domain/identity/identityGate.ts
-- and is changed in the same commit. The expressions below are duplicated in SQL only
-- because a view and two triggers cannot call it; the denormalisation-agreement
-- property test (Req 21.6) now pins this file's text against that function so the two
-- cannot drift again. That property was referenced by a comment but never written,
-- which is precisely how 0060 changed the SQL and left the TypeScript header
-- describing an expression the code no longer implemented.
--
-- DATA LOSS ALREADY INCURRED, RECORDED HERE. 0060 overwrote `merchant_status` for
-- every row with a non-null `merchant_ref`, so the pre-0060 PENDING/APPROVED
-- distinction is not recoverable from this table. Section 1 re-derives it from
-- `merchant_settlements_enabled`, which is the provider-owned flag 0060 did not
-- touch, so the result is correct even though it is not a literal undo.

-- ---------------------------------------------------------------------------
-- 1. profiles: re-derive the status 0060 promoted.
--
-- Mirrors `deriveMerchantStatus`: settlements enabled -> APPROVED, otherwise the
-- account exists but is unfinished -> PENDING. Rows that never had a merchant_ref
-- are untouched (they are NONE or REJECTED and 0060 did not promote them).
--
-- `merchant_identity_verified_at` is deliberately NOT cleared. It is stale on rows
-- 0060 stamped, but blanking a disclosure timestamp is destructive and the value is
-- inert while the gate is unsatisfied: `sellerIdentityDisclosure` now requires the
-- gate as well as the timestamp, so a stale timestamp cannot produce a disclosure on
-- its own. It is corrected in place by `applyComplianceUpdate` when the provider
-- reports the account active.
-- ---------------------------------------------------------------------------

update cardtrade.profiles
set merchant_status = 'PENDING'::cardtrade.merchant_status
where merchant_ref is not null
  and not merchant_settlements_enabled
  and merchant_status = 'APPROVED'::cardtrade.merchant_status;

-- ---------------------------------------------------------------------------
-- 2. items.seller_identity_verified: both conjuncts, and fire on both columns.
--
-- THE TRIGGER COLUMN LIST IS THE IMPORTANT PART. 0060 narrowed the propagation
-- trigger to `after update of merchant_status`. With the gate depending on
-- `merchant_settlements_enabled`, a Stripe report that flips ONLY settlements — the
-- single most common transition there is, and the one that means "onboarding
-- finished" — would not fire the trigger, and every item row for that seller would
-- be permanently stale. Nothing in the application reads this column yet, so that
-- would have failed silently and indefinitely. 0041 had the correct form; it is
-- restored here.
-- ---------------------------------------------------------------------------

create or replace function cardtrade.set_item_seller_identity_verified()
returns trigger
language plpgsql
security definer
set search_path to 'cardtrade', 'pg_temp'
as $function$
begin
  select (merchant_status = 'APPROVED'::cardtrade.merchant_status
          and merchant_settlements_enabled)
    into new.seller_identity_verified
  from cardtrade.profiles where id = new.owner_id;
  return new;
end;
$function$;

create or replace function cardtrade.sync_items_seller_identity_verified()
returns trigger
language plpgsql
security definer
set search_path to 'cardtrade', 'pg_temp'
as $function$
declare
  verified boolean;
begin
  verified := (new.merchant_status = 'APPROVED'::cardtrade.merchant_status
               and new.merchant_settlements_enabled);
  -- Guarded on an actual change so a provider report repeating the current state
  -- does not rewrite every row the seller owns.
  update cardtrade.items
  set seller_identity_verified = verified
  where owner_id = new.id
    and seller_identity_verified is distinct from verified;
  return null;
end;
$function$;

drop trigger if exists profiles_sync_items_seller_identity_verified on cardtrade.profiles;
create trigger profiles_sync_items_seller_identity_verified
  after update of merchant_status, merchant_settlements_enabled
  on cardtrade.profiles
  for each row execute function cardtrade.sync_items_seller_identity_verified();

update cardtrade.items i
set seller_identity_verified = (
  p.merchant_status = 'APPROVED'::cardtrade.merchant_status
  and p.merchant_settlements_enabled
)
from cardtrade.profiles p
where p.id = i.owner_id
  and i.seller_identity_verified is distinct from (
    p.merchant_status = 'APPROVED'::cardtrade.merchant_status
    and p.merchant_settlements_enabled
  );

comment on column cardtrade.items.seller_identity_verified is
  'Denormalised Identity_Gate for the item owner: merchant_status = APPROVED and '
  'merchant_settlements_enabled — Connect onboarding actually finished. Maintained by '
  'triggers that fire on BOTH columns; narrowing that trigger list silently freezes '
  'this column (see 0060).';

-- ---------------------------------------------------------------------------
-- 3. public_profiles: one gate, both conjuncts.
--
-- Dropped and recreated rather than replaced: CREATE OR REPLACE VIEW cannot change a
-- column expression's source in place safely here. Column NAMES are unchanged, so
-- every existing select keeps resolving. Grants are re-issued below, and the 0032
-- security fix still applies — this is NOT a security_invoker view, so it must stay
-- SELECT-only or writes through it would bypass the owner-only RLS on `profiles`.
-- ---------------------------------------------------------------------------

drop view if exists cardtrade.public_profiles;

create view cardtrade.public_profiles as
select
  id,
  display_name,
  rating,
  rating_count,
  -- The Identity_Gate. Approval alone is not enough: transfers must actually be
  -- enabled, because that is the only signal that Stripe finished with this member.
  (merchant_status = 'APPROVED'::cardtrade.merchant_status
   and merchant_settlements_enabled) as is_verified,
  -- Provider-reported GIVEN name only, and only once the gate is satisfied. The full
  -- legal name is a commitment-point disclosure and never belongs in a public view.
  case
    when merchant_status = 'APPROVED'::cardtrade.merchant_status
         and merchant_settlements_enabled
         and merchant_legal_entity_name is not null
      then split_part(btrim(merchant_legal_entity_name), ' ', 1)
    else null
  end as identity_first_name
from cardtrade.profiles;

-- Read-only for both roles. No write grants, per the 0032 security fix.
grant select on cardtrade.public_profiles to anon, authenticated;

comment on view cardtrade.public_profiles is
  'Catalog-safe public projection of a Profile. `is_verified` is the single '
  'Identity_Gate: Connect onboarding APPROVED with settlements enabled, i.e. the '
  'provider-hosted flow actually completed. 0060 briefly reduced this to APPROVED '
  'alone, which made a freshly created empty account shell read as verified; 0061 '
  'restored the second conjunct. It still does not assert a government-document or '
  'selfie check, which Connect can defer. Never add legal name, date of birth, '
  'document numbers, address or contact details.';

-- ---------------------------------------------------------------------------
-- 4. Reconcile the disclosure prerequisites for rows 0060 promoted.
--
-- Same reasoning as 0041 §3, and the same guarded WHERE. `merchant_identity_version`
-- and `merchant_identity_disclosure_consented_at` are written only by
-- `submitMerchantOnboarding`. A seller who acquired a merchant_ref outside that path,
-- or whose row predates it, has both null — which makes `sellerIdentityDisclosure`
-- return null, which makes `initiateCashSale` fail with SELLER_IDENTITY_UNVERIFIED,
-- which takes the buy path dark. That has shipped once already.
--
-- Consent is a real record, so it is stamped only where the provider has already
-- verified an identity to disclose. It is never invented for an unverified seller:
-- the WHERE requires the full gate.
-- ---------------------------------------------------------------------------

update cardtrade.profiles
set merchant_identity_disclosure_consented_at = coalesce(
      merchant_identity_disclosure_consented_at,
      merchant_identity_verified_at
    ),
    merchant_identity_version = coalesce(
      merchant_identity_version,
      merchant_ref || ':' || to_char(merchant_identity_verified_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSZ')
    )
where merchant_status = 'APPROVED'::cardtrade.merchant_status
  and merchant_settlements_enabled
  and merchant_legal_entity_name is not null
  and merchant_identity_verified_at is not null
  and merchant_ref is not null
  and (
    merchant_identity_disclosure_consented_at is null
    or merchant_identity_version is null
  );

comment on column cardtrade.profiles.merchant_status is
  'Stripe Connect onboarding state, derived only from what the provider reports '
  '(deriveMerchantStatus). APPROVED requires stripe_transfers active. It is not a '
  'latch: 0060 pinned it to APPROVED for any row with a merchant_ref, so an account '
  'the provider later restricted went on reading as verified. Never write it directly '
  'from application code.';
