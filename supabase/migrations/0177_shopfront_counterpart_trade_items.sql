-- =============================================================================
-- 0177_shopfront_counterpart_trade_items.sql
--
-- A SHOPFRONT listing may be the COUNTERPART side of a 2-Way Trade (0081: a binder
-- can be traded for, never offered). 0074's trade_items trigger still refused every
-- shopfront row, including the counterpart's, so open_trade_negotiation failed on
-- every trade for a Multiple items listing and the member saw the generic "The offer
-- could not be opened" copy.
--
-- The rule that stays: a shopfront is never the OFFERING side. open_trade_negotiation
-- refuses that before it writes (shopfront-cannot-be-offered), and this trigger is the
-- backstop for any other writer of trade_items, so it refuses a shopfront row only
-- when the row belongs to the trade's initiator. Ownership and closed-item checks
-- apply to both sides, as before.
-- =============================================================================

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
  v_initiator_id uuid;
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

  -- 0081: a shopfront may be the counterpart's side (the goods come out of it), never
  -- the initiator's (the offering side is what the value is derived from).
  if v_listing_kind = 'SHOPFRONT' then
    select initiator_id
      into v_initiator_id
    from cardtrade.trades
    where id = new.trade_id;

    if v_initiator_id = new.trader_id then
      raise exception 'trade-item-is-shopfront: item % is a shopfront offered by its initiator', new.item_id
        using errcode = 'check_violation';
    end if;
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
  'shopfront offered by the initiator, or is closed. A shopfront is allowed as the '
  'counterpart side (0081). Covers every RPC that writes the table.';
