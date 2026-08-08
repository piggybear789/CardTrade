-- 0074_trade_items_must_be_owned.sql
--
-- A trader may only put up goods they own.
--
-- THE GAP. `open_trade_negotiation` (0053) validates the two PRIMARY items — the
-- counterpart's is checked for owner and availability, the initiator's for owner —
-- and then loops over `p_initiator_extra_item_ids` and
-- `p_counterpart_extra_item_ids` inserting whatever it was handed, with no check at
-- all. Both arrays arrive from client input via `openTradeNegotiation`, which calls
-- the RPC on the service-role client, so nothing else stood in the way.
--
-- Two consequences, and the second is the expensive one:
--
--   1. READ ESCALATION. `items_trade_participant_select` (0071) grants a trade
--      participant SELECT on every item in that trade's `trade_items`. Padding
--      either array with arbitrary ids therefore granted read access to any row in
--      `items`, including other members' hidden private-trade items and the
--      RESERVED or SOLD rows the catalog policy withholds.
--
--   2. COLLATERAL INFLATION. Bonds are sized from what each trader RECEIVES, read
--      out of `trade_items` by `placeBondsForAgreedTrade`. Stuffing your own side
--      with strangers' expensive listings inflates the counterparty's REAL card
--      authorisation, for goods you were never able to deliver, while the exchange
--      panel displays them as genuinely on offer.
--
-- WHY A TRIGGER RATHER THAN A FIX INSIDE THE RPC. Ownership is an invariant of the
-- table, not of one caller: four migrations (0017, 0021, 0023, 0053) have written
-- these rows, each superseding the last, and a per-caller check has to be restated
-- in every future one. Enforcing it here covers all of them and any path added
-- later. It also avoids recreating a 300-line function to add two lines, which is
-- its own source of error.
--
-- WHAT IS DELIBERATELY *NOT* CHECKED HERE: availability. Terms renegotiation
-- rewrites a bundle while the primary items are already RESERVED by this very
-- trade, so refusing a non-AVAILABLE item would reject the legitimate case. The
-- RPCs keep their own availability guard on the primaries, where the double-sale
-- question actually arises.
--
-- Only INSERT is triggered. Existing rows are untouched: if ownership transfers on
-- completion, historical rows must stay as they were recorded.
--
-- Requirements: 5.1, 5.3, 5.4.

create or replace function cardtrade.enforce_trade_item_ownership()
returns trigger
language plpgsql
security definer
set search_path to 'cardtrade', 'pg_temp'
as $function$
declare
  v_owner_id uuid;
  v_listing_kind cardtrade.listing_kind;
  v_closed_at timestamptz;
begin
  select owner_id, listing_kind, closed_at
    into v_owner_id, v_listing_kind, v_closed_at
  from cardtrade.items
  where id = new.item_id;

  if v_owner_id is null then
    raise exception 'trade-item-not-found: %', new.item_id
      using errcode = 'foreign_key_violation';
  end if;

  -- The invariant. `trader_id` is the side of the swap the row belongs to, so the
  -- item has to belong to that trader.
  if v_owner_id <> new.trader_id then
    raise exception 'trade-item-not-owned: item % is not owned by trader %',
      new.item_id, new.trader_id
      using errcode = 'check_violation';
  end if;

  -- Shopfronts are refused from trade escrow (0064): collateral is 100% of FMV and
  -- a binder's FMV is the whole inventory, so bonding one authorises against stock
  -- rather than against the cards being swapped. `openTradeNegotiation` refuses
  -- them for the primaries; a bundle id was another way in.
  if v_listing_kind = 'SHOPFRONT' then
    raise exception 'trade-item-is-shopfront: item % is a shopfront listing', new.item_id
      using errcode = 'check_violation';
  end if;

  if v_closed_at is not null then
    raise exception 'trade-item-closed: item % is closed', new.item_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

comment on function cardtrade.enforce_trade_item_ownership is
  'Refuses a trade_items row whose item is not owned by the named trader, is a '
  'shopfront listing, or is closed. Covers every RPC that writes the table, '
  'including the unvalidated bundle loops in open_trade_negotiation.';

drop trigger if exists trade_items_must_be_owned on cardtrade.trade_items;

create trigger trade_items_must_be_owned
  before insert on cardtrade.trade_items
  for each row
  execute function cardtrade.enforce_trade_item_ownership();
