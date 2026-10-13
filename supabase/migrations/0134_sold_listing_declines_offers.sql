-- 0134_sold_listing_declines_offers.sql
--
-- A SOLD listing closes its open offers.
--
-- Accepting an offer already declined the other PENDING offers on that item, but a
-- plain Buy did not, so a sold card kept live offers: the seller was still asked to
-- accept one, and the buyer's offer still looked open.
--
-- SOLD, not RESERVED. Accepting an offer opens a Cash_Sale (which reserves the item)
-- BEFORE it marks that offer ACCEPTED, so declining on RESERVED would decline the very
-- offer being accepted. A reservation can also be cancelled and the card returned to
-- the catalog, where the offers are still meaningful.

create or replace function cardtrade.decline_offers_on_sold_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update cardtrade.offers
     set status = 'DECLINED', updated_at = now()
   where item_id = new.id
     and status = 'PENDING';
  return new;
end;
$$;

revoke all on function cardtrade.decline_offers_on_sold_item() from public;

drop trigger if exists items_sold_declines_offers on cardtrade.items;
create trigger items_sold_declines_offers
  after update of status on cardtrade.items
  for each row
  when (new.status = 'SOLD' and old.status is distinct from 'SOLD')
  execute function cardtrade.decline_offers_on_sold_item();

-- One-off: offers left open on listings that sold before this trigger existed.
update cardtrade.offers o
   set status = 'DECLINED', updated_at = now()
  from cardtrade.items i
 where i.id = o.item_id
   and i.status = 'SOLD'
   and o.status = 'PENDING';
