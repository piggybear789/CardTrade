-- 0018_items_seller_verified.sql
--
-- Denormalized seller-verified flag on cardtrade.items, mirroring the existing
-- seller_rating pattern (set_item_seller_rating / sync_items_seller_rating), so
-- the "Verified sellers only" catalog filter (Req 3.8 UX) can be pushed into
-- the paginated items query instead of filtering after the fact — filtering
-- after the fact would break the exact `count`/pagination that
-- `searchCatalog` relies on. Kept in sync with `profiles.kyc_status` by trigger.

alter table cardtrade.items
  add column if not exists seller_verified boolean not null default false;

-- Backfill from the current owner KYC status.
update cardtrade.items i
set seller_verified = (p.kyc_status = 'VERIFIED')
from cardtrade.profiles p
where p.id = i.owner_id
  and i.seller_verified is distinct from (p.kyc_status = 'VERIFIED');

-- Set on insert, mirroring set_item_seller_rating.
create or replace function cardtrade.set_item_seller_verified()
returns trigger
language plpgsql
security definer
set search_path to 'cardtrade', 'pg_temp'
as $$
begin
  select (kyc_status = 'VERIFIED') into new.seller_verified
  from cardtrade.profiles where id = new.owner_id;
  return new;
end;
$$;

drop trigger if exists items_set_seller_verified on cardtrade.items;
create trigger items_set_seller_verified
  before insert on cardtrade.items
  for each row execute function cardtrade.set_item_seller_verified();

-- Keep in sync when a seller's KYC status changes, mirroring
-- sync_items_seller_rating.
create or replace function cardtrade.sync_items_seller_verified()
returns trigger
language plpgsql
security definer
set search_path to 'cardtrade', 'pg_temp'
as $$
begin
  update cardtrade.items
  set seller_verified = (new.kyc_status = 'VERIFIED')
  where owner_id = new.id
    and seller_verified is distinct from (new.kyc_status = 'VERIFIED');
  return null;
end;
$$;

drop trigger if exists profiles_sync_item_verified on cardtrade.profiles;
create trigger profiles_sync_item_verified
  after update of kyc_status on cardtrade.profiles
  for each row execute function cardtrade.sync_items_seller_verified();

-- Supports the catalog filter query (status = AVAILABLE, hidden = false,
-- seller_verified = true).
create index if not exists items_catalog_seller_verified_idx
  on cardtrade.items (seller_verified)
  where hidden = false;
