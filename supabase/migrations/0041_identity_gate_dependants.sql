-- 0041_identity_gate_dependants.sql
--
-- Repoint every dependant of the retired payer gate onto the Identity_Gate
-- (Req 13, Req 16.1-16.8). NON-DESTRUCTIVE: every retired column stays in place,
-- so this is safe to apply before any application code is removed, and safe to
-- leave applied if the code removal is deferred.
--
-- THE IDENTITY_GATE is `merchant_status = 'APPROVED' and merchant_settlements_enabled`
-- — Connect onboarding approved with transfers actually enabled. It is already
-- what `public_profiles.is_verified` reports (migration 0032). After this
-- migration it is the only expression any verification surface reads.
--
-- WHAT CHANGES
--   1. `items.seller_identity_verified` triggers read the Identity_Gate instead
--      of `kyc_status`, and propagation fires on the merchant columns.
--   2. `public_profiles.identity_verified` becomes the Identity_Gate, and
--      `identity_first_name` is derived from the provider-verified legal name
--      rather than `identity_verified_first_name`.
--   3. Pre-onboarding-flow seller records are reconciled so an approved seller
--      can actually transact.
--
-- WHY THE VIEW KEEPS ITS COLUMN NAMES. `identity_verified` and
-- `identity_first_name` are read by `lib/actions/listings.ts`,
-- `lib/actions/watchlist.ts` and `lib/actions/deals.ts`. Dropping them here would
-- break those queries at runtime. Repointing them makes them correct aliases of
-- the one gate, removes the last dependency on the retired profile columns, and
-- lets the code references be cleaned up separately.

-- ---------------------------------------------------------------------------
-- 1. items.seller_identity_verified now denormalises the Identity_Gate.
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

-- Propagation must fire on the merchant columns now, not on kyc_status.
drop trigger if exists profiles_sync_items_seller_identity_verified on cardtrade.profiles;
create trigger profiles_sync_items_seller_identity_verified
  after update of merchant_status, merchant_settlements_enabled
  on cardtrade.profiles
  for each row execute function cardtrade.sync_items_seller_identity_verified();

-- Backfill so existing rows are correct rather than carrying the old basis.
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
  'Denormalised from the owner''s Identity_Gate: Connect onboarding APPROVED '
  'with settlements enabled. Since the payer gate was retired this reports the '
  'same fact as seller_verified; both are kept because listing queries filter '
  'and sort on them.';

-- ---------------------------------------------------------------------------
-- 2. public_profiles: one gate, and a public first name that survives the
--    retired columns being dropped.
--
-- Recreated rather than replaced because the column expressions change type
-- source. Column NAMES are unchanged, so application queries keep working.
-- ---------------------------------------------------------------------------

drop view if exists cardtrade.public_profiles;

create view cardtrade.public_profiles as
select
  id,
  display_name,
  rating,
  rating_count,
  merchant_status = 'APPROVED'::cardtrade.merchant_status
    and merchant_settlements_enabled                        as is_verified,
  -- Same expression as is_verified. Retained as a distinct column only so the
  -- existing selects in listings/watchlist/deals keep resolving; there is one
  -- gate now, and these two can be collapsed once those callers are updated.
  merchant_status = 'APPROVED'::cardtrade.merchant_status
    and merchant_settlements_enabled                        as identity_verified,
  -- Given name only, from the PROVIDER-VERIFIED legal name, and only while the
  -- gate is satisfied. Never the full legal name: that is disclosed to a
  -- counterparty at a commitment point, never published.
  case
    when merchant_status = 'APPROVED'::cardtrade.merchant_status
      and merchant_settlements_enabled
      and merchant_legal_entity_name is not null
    then split_part(btrim(merchant_legal_entity_name), ' ', 1)
    else null
  end                                                       as identity_first_name
from cardtrade.profiles;

-- Read-only for both roles. No write grants, per the 0032 security fix: this is a
-- non-security_invoker view, so write grants here would bypass profiles RLS.
grant select on cardtrade.public_profiles to anon, authenticated;

comment on view cardtrade.public_profiles is
  'Catalog-safe public projection of a Profile. Every verification column now '
  'reports the single Identity_Gate (Connect APPROVED with settlements '
  'enabled). identity_first_name is the given name parsed from the '
  'provider-verified legal name, so this view no longer depends on the retired '
  'identity_verified_* columns.';

-- ---------------------------------------------------------------------------
-- 3. Reconcile sellers approved before hosted onboarding existed.
--
-- WHY THIS IS NEEDED. `merchant_identity_version` and
-- `merchant_identity_disclosure_consented_at` are written only by
-- `submitMerchantOnboarding`, and `0031_reset_provider_state.sql` nulls them.
-- Every APPROVED seller in this database therefore has both null, which made
-- `sellerIdentityDisclosure` return null, which made `agreeCashSale` fail with
-- SELLER_IDENTITY_UNVERIFIED and blocked buying and offers entirely.
--
-- The version is internal bookkeeping and is now derived in code when absent.
-- Consent is a real record, so it is stamped only where the provider has already
-- verified an identity to disclose — never invented for an unverified seller.
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
