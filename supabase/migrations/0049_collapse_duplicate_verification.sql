-- 0049_collapse_duplicate_verification.sql
--
-- One question, one answer. Delete the second copy of the verification signal.
--
-- WHAT WAS WRONG. After 0041 repointed everything at the Identity_Gate, the database
-- reported that gate through two byte-identical expressions in two places each:
--
--   public_profiles.is_verified          = merchant_status='APPROVED' and settlements
--   public_profiles.identity_verified    = merchant_status='APPROVED' and settlements
--   items.seller_verified                = the same, via 2 functions + 2 triggers
--   items.seller_identity_verified       = the same, via 2 MORE functions + 2 triggers
--
-- That is 2 view columns, 2 table columns, 4 trigger functions, 4 triggers and 2
-- indexes answering "is this member verified?". They agree today by coincidence of
-- having been written from the same expression, not by construction — and this is
-- EXACTLY the shape of the kyc_status/merchant_status bug that broke buying: two
-- columns for one question, where the stale one is the one something eventually reads.
--
-- The two names also carried different claims. `identity_verified` invited copy about
-- a document-and-selfie check, which Connect does NOT prove: it verifies a payout
-- recipient and may defer document collection. So the surviving name is the one that
-- does not overstate what the platform knows.
--
-- WHICH COPY SURVIVES, and why it is not the same choice in both places:
--
--   * The VIEW keeps `is_verified`. It has more callers, and `product.md` already
--     names it as the SQL equivalent of the gate.
--   * `items` keeps `seller_identity_verified`, because its trigger pair is the
--     correct one. `items_set_seller_verified` fired only BEFORE INSERT, so an item
--     whose `owner_id` changed kept the previous owner's verification state; the
--     surviving trigger fires on INSERT OR UPDATE OF owner_id. Its index is also
--     partial on the true value, which is what a "verified sellers" query needs.
--
-- Nothing in application code reads either `items` column — they are pure
-- denormalisation for future catalog queries — so dropping one breaks no reader.
-- `public_profiles.identity_verified` HAS readers, and they move to `is_verified` in
-- the same change.

-- ---------------------------------------------------------------------------
-- 1. items: drop the duplicate column, its triggers and its functions
-- ---------------------------------------------------------------------------

drop trigger if exists items_set_seller_verified on cardtrade.items;
drop trigger if exists profiles_sync_item_verified on cardtrade.profiles;
drop function if exists cardtrade.set_item_seller_verified();
drop function if exists cardtrade.sync_items_seller_verified();

-- The partial index on this column goes with it.
alter table cardtrade.items drop column if exists seller_verified;

comment on column cardtrade.items.seller_identity_verified is
  'Denormalised Identity_Gate for the item owner: merchant_status = APPROVED and '
  'merchant_settlements_enabled. The ONLY verification flag on items as of 0049 — '
  'the former seller_verified column reported the same fact through a second set of '
  'triggers that fired on fewer events.';

-- ---------------------------------------------------------------------------
-- 2. public_profiles: one verification column
-- ---------------------------------------------------------------------------
--
-- Dropped and recreated rather than replaced: CREATE OR REPLACE VIEW cannot remove a
-- column. Grants are re-issued below, and the 0032 security fix still applies — this
-- is not a security_invoker view, so it must stay SELECT-only or writes through it
-- would bypass the owner-only RLS on `profiles`.

drop view if exists cardtrade.public_profiles;

create view cardtrade.public_profiles as
select
  id,
  display_name,
  rating,
  rating_count,
  -- The Identity_Gate. Approval alone is not enough: transfers must actually be
  -- enabled, because that is the only signal that money can reach this member.
  (merchant_status = 'APPROVED'::cardtrade.merchant_status
   and merchant_settlements_enabled) as is_verified,
  -- Provider-verified GIVEN name only, and only once the gate is satisfied. The full
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
  'Identity_Gate: Connect onboarding APPROVED with settlements enabled. The former '
  '`identity_verified` column was the same expression under a name that implied a '
  'document-and-selfie check Connect does not prove, and was removed in 0049. '
  'Never add legal name, date of birth, document numbers, address or contact details.';
