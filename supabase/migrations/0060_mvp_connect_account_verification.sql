--
-- MVP verification policy: a successful Stripe Connect recipient-account creation
-- marks a seller/trader verified for platform access. Actual payout readiness remains
-- merchant_settlements_enabled and is intentionally not inferred here.
--
-- The application persists merchant_status = APPROVED once account creation succeeds.
-- Existing recipient account shells are backfilled into the same MVP state. These
-- SQL denormalisations must use the same status signal.

update cardtrade.profiles
set
  merchant_status = 'APPROVED'::cardtrade.merchant_status,
  merchant_identity_verified_at = coalesce(
    merchant_identity_verified_at,
    merchant_submitted_at,
    now()
  )
where merchant_ref is not null
  and merchant_status is distinct from 'APPROVED'::cardtrade.merchant_status;

create or replace function cardtrade.set_item_seller_identity_verified()
returns trigger
language plpgsql
security definer
set search_path to 'cardtrade', 'pg_temp'
as $function$
begin
  select (merchant_status = 'APPROVED'::cardtrade.merchant_status)
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
  verified := (new.merchant_status = 'APPROVED'::cardtrade.merchant_status);
  update cardtrade.items
  set seller_identity_verified = verified
  where owner_id = new.id
    and seller_identity_verified is distinct from verified;
  return null;
end;
$function$;

drop trigger if exists profiles_sync_items_seller_identity_verified on cardtrade.profiles;
create trigger profiles_sync_items_seller_identity_verified
  after update of merchant_status
  on cardtrade.profiles
  for each row execute function cardtrade.sync_items_seller_identity_verified();

update cardtrade.items i
set seller_identity_verified = (p.merchant_status = 'APPROVED'::cardtrade.merchant_status)
from cardtrade.profiles p
where p.id = i.owner_id
  and i.seller_identity_verified is distinct from (p.merchant_status = 'APPROVED'::cardtrade.merchant_status);

drop view if exists cardtrade.public_profiles;

create view cardtrade.public_profiles as
select
  id,
  display_name,
  rating,
  rating_count,
  (merchant_status = 'APPROVED'::cardtrade.merchant_status) as is_verified,
  case
    when merchant_status = 'APPROVED'::cardtrade.merchant_status
         and merchant_legal_entity_name is not null
      then split_part(btrim(merchant_legal_entity_name), ' ', 1)
    else null
  end as identity_first_name
from cardtrade.profiles;

grant select on cardtrade.public_profiles to anon, authenticated;

comment on column cardtrade.items.seller_identity_verified is
  'MVP denormalisation of the owner''s Identity_Gate: successful Stripe Connect recipient-account creation (merchant_status = APPROVED). Actual transfer readiness remains merchant_settlements_enabled.';

comment on view cardtrade.public_profiles is
  'Catalog-safe public Profile projection. MVP is_verified means successful Stripe Connect recipient-account creation (merchant_status = APPROVED). It does not assert payout readiness or government-document verification.';
