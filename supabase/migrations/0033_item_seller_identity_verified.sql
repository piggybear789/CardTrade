-- 0033_item_seller_identity_verified.sql
--
-- Surface IDENTITY verification on public listing surfaces (Req 2.10).
--
-- WHY A SECOND FLAG. `items.seller_verified` already exists, but it reports
-- PAYEE onboarding — `merchant_status = APPROVED and merchant_settlements_enabled`,
-- i.e. "this seller can be paid". That is a different claim from "a provider
-- checked this person's government ID and matched it to a selfie". Reusing one
-- flag for both would mean a badge that says one thing and means another, so the
-- two gates stay separate all the way to the UI.
--
-- Denormalised onto `items` rather than joined, mirroring the existing
-- `seller_verified` pattern exactly: listing queries filter and sort on it, and
-- `public_profiles` is not read by application code.

alter table cardtrade.items
  add column if not exists seller_identity_verified boolean not null default false;

comment on column cardtrade.items.seller_identity_verified is
  'Denormalised from the owner''s kyc_status = VERIFIED — the owner passed a '
  'provider identity check (government document + selfie match). DISTINCT from '
  'seller_verified, which reports payee onboarding ("can be paid"). Maintained '
  'by trigger; never written directly.';

-- Stamp on insert/owner change, mirroring set_item_seller_verified.
create or replace function cardtrade.set_item_seller_identity_verified()
returns trigger
language plpgsql
security definer
set search_path to 'cardtrade', 'pg_temp'
as $function$
begin
  select (kyc_status = 'VERIFIED')
    into new.seller_identity_verified
  from cardtrade.profiles where id = new.owner_id;
  return new;
end;
$function$;

drop trigger if exists items_set_seller_identity_verified on cardtrade.items;
create trigger items_set_seller_identity_verified
  before insert or update of owner_id on cardtrade.items
  for each row execute function cardtrade.set_item_seller_identity_verified();

-- Propagate when the owner's identity status changes, mirroring
-- sync_items_seller_verified. Guarded on an actual change so a webhook that
-- re-reports the same status does not churn every row the seller owns.
create or replace function cardtrade.sync_items_seller_identity_verified()
returns trigger
language plpgsql
security definer
set search_path to 'cardtrade', 'pg_temp'
as $function$
declare
  verified boolean;
begin
  verified := (new.kyc_status = 'VERIFIED');
  update cardtrade.items
  set seller_identity_verified = verified
  where owner_id = new.id
    and seller_identity_verified is distinct from verified;
  return null;
end;
$function$;

drop trigger if exists profiles_sync_items_seller_identity_verified on cardtrade.profiles;
create trigger profiles_sync_items_seller_identity_verified
  after update of kyc_status on cardtrade.profiles
  for each row execute function cardtrade.sync_items_seller_identity_verified();

-- Backfill so existing rows are correct rather than defaulted.
update cardtrade.items i
set seller_identity_verified = (p.kyc_status = 'VERIFIED')
from cardtrade.profiles p
where p.id = i.owner_id
  and i.seller_identity_verified is distinct from (p.kyc_status = 'VERIFIED');

-- Listing surfaces filter on this the same way they filter seller_verified.
create index if not exists items_seller_identity_verified_idx
  on cardtrade.items (seller_identity_verified)
  where seller_identity_verified;
