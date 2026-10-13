-- 0141_trade_side_value_freeze.sql
--
-- ESC-18 (Medium): collateral and the Trade_Fee were sized from LIVE `fmv_cents` at
-- placement, which can be days after the terms were agreed. The owner of a card could
-- drop its price after agreement and both the bond backing the swap and the fee
-- shrank with it.
--
-- ESC-19 (Medium): availability holes. A trade could be opened offering an item that
-- was already reserved or sold, and `begin_trade_collateral` silently reserved only
-- the items that happened to be AVAILABLE, so a trade could lock with goods another
-- contract already held. A restore had no record of WHICH reservation was this
-- trade's own.
--
-- Now:
--   * `trades.initiator_side_minor` / `counterpart_side_minor` freeze each side's
--     value at TERMS_AGREED (written by the server, from `resolveTradeSideValues`).
--     Bond and fee sizing read these and never live `fmv_cents`.
--   * An FMV edit on an item in a live trade (COLLATERAL_PENDING onwards) is refused
--     ('item-in-live-trade'); in NEGOTIATING it voids both acceptances, exactly as a
--     cash change does, so a stale acceptance cannot carry the old price.
--   * `items.reserved_by_trade_id` records the reservation's owner. The restore puts
--     back only this trade's own reservations (or, for reservations made before this
--     migration, the WP1 unclaimed rule), never anyone else's.
--   * Opening a negotiation requires the offered SINGLE items to be AVAILABLE, and a
--     shopfront target to be open. Beginning collateral raises 'short-reservation'
--     when it could not reserve every SINGLE item, and 'terms-incomplete' without a
--     face-to-face meeting place and time (the SQL half of ESC-04).

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table cardtrade.trades
  add column if not exists initiator_side_minor bigint,
  add column if not exists counterpart_side_minor bigint;

alter table cardtrade.items
  add column if not exists reserved_by_trade_id uuid references cardtrade.trades(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 2. Opening a negotiation: the 0081 body, plus initiator availability
-- ---------------------------------------------------------------------------
create or replace function cardtrade.open_trade_negotiation(
  p_initiator_id uuid,
  p_counterpart_id uuid,
  p_initiator_item_id uuid,
  p_counterpart_item_id uuid,
  p_initiator_extra_item_ids uuid[] default null,
  p_counterpart_extra_item_ids uuid[] default null,
  p_cash_amount_cents bigint default 0,
  p_cash_direction cardtrade.trade_cash_direction default 'PROPOSER_PAYS',
  p_declared_value_cents bigint default null,
  p_handover_method cardtrade.handover_method default null,
  p_meeting_location text default null,
  p_meeting_lat double precision default null,
  p_meeting_lng double precision default null,
  p_meeting_place_id text default null,
  p_meeting_at timestamptz default null,
  p_delivery_details text default null,
  p_delivery_cost_cents bigint default null,
  p_offer_message text default null,
  p_counterpart_goods_description text default null
)
returns cardtrade.trades
language plpgsql
set search_path = ''
as $$
declare
  v_trade cardtrade.trades%rowtype;
  v_item_id uuid;
  v_target cardtrade.items%rowtype;
  v_goods text := nullif(btrim(p_counterpart_goods_description), '');
begin
  if p_initiator_id = p_counterpart_id then
    raise exception 'self-trade';
  end if;

  select * into v_target from cardtrade.items
  where id = p_counterpart_item_id and owner_id = p_counterpart_id;

  if not found then
    raise exception 'counterpart-item-unavailable';
  end if;

  if v_target.listing_kind = 'SHOPFRONT' then
    if v_target.closed_at is not null then
      raise exception 'counterpart-item-unavailable';
    end if;
    if v_goods is null then
      raise exception 'counterpart-goods-required';
    end if;
  else
    if v_target.status <> 'AVAILABLE' then
      raise exception 'counterpart-item-unavailable';
    end if;
    if v_goods is not null then
      raise exception 'counterpart-goods-not-applicable';
    end if;
  end if;

  if not exists (
    select 1 from cardtrade.items
    where id = p_initiator_item_id and owner_id = p_initiator_id
  ) then
    raise exception 'initiator-item-not-owned';
  end if;

  if exists (
    select 1 from cardtrade.items
    where listing_kind = 'SHOPFRONT'
      and (
        id = p_initiator_item_id
        or id = any(coalesce(p_initiator_extra_item_ids, array[]::uuid[]))
      )
  ) then
    raise exception 'shopfront-cannot-be-offered';
  end if;

  -- ESC-19: everything OFFERED must be on offer. A reserved or sold card cannot be
  -- put up for a swap, and every extra item must belong to the initiator.
  if exists (
    select 1 from cardtrade.items
    where (
        id = p_initiator_item_id
        or id = any(coalesce(p_initiator_extra_item_ids, array[]::uuid[]))
      )
      and (status <> 'AVAILABLE' or owner_id <> p_initiator_id)
  ) then
    raise exception 'initiator-item-unavailable';
  end if;

  insert into cardtrade.trades (
    initiator_id, counterpart_id, initiator_item_id, counterpart_item_id,
    state, cash_amount_cents, cash_direction, declared_value_cents,
    handover_method, meeting_location, meeting_lat, meeting_lng,
    meeting_place_id, meeting_at, delivery_details, delivery_cost_cents,
    offer_message, counterpart_goods_description, terms_updated_at,
    initiator_terms_accepted_version, initiator_terms_accepted_at
  ) values (
    p_initiator_id, p_counterpart_id, p_initiator_item_id, p_counterpart_item_id,
    'NEGOTIATING', coalesce(p_cash_amount_cents, 0),
    coalesce(p_cash_direction, 'PROPOSER_PAYS'), p_declared_value_cents,
    p_handover_method, p_meeting_location, p_meeting_lat, p_meeting_lng,
    p_meeting_place_id, p_meeting_at, p_delivery_details, p_delivery_cost_cents,
    nullif(btrim(p_offer_message), ''), v_goods, now(),
    1, now()
  )
  returning * into v_trade;

  insert into cardtrade.trade_items (trade_id, trader_id, item_id)
  values (v_trade.id, p_initiator_id, p_initiator_item_id);
  if p_initiator_extra_item_ids is not null then
    foreach v_item_id in array p_initiator_extra_item_ids loop
      insert into cardtrade.trade_items (trade_id, trader_id, item_id)
      values (v_trade.id, p_initiator_id, v_item_id)
      on conflict do nothing;
    end loop;
  end if;

  insert into cardtrade.trade_items (trade_id, trader_id, item_id)
  values (v_trade.id, p_counterpart_id, p_counterpart_item_id);
  if p_counterpart_extra_item_ids is not null then
    foreach v_item_id in array p_counterpart_extra_item_ids loop
      insert into cardtrade.trade_items (trade_id, trader_id, item_id)
      values (v_trade.id, p_counterpart_id, v_item_id)
      on conflict do nothing;
    end loop;
  end if;

  perform cardtrade.ensure_trade_conversation(v_trade.id, p_initiator_id);

  select * into v_trade from cardtrade.trades where id = v_trade.id;
  return v_trade;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Beginning collateral: the 0081 body, plus scoped and complete reservation
-- ---------------------------------------------------------------------------
create or replace function cardtrade.begin_trade_collateral(
  p_trade_id uuid,
  p_actor_id uuid
)
returns setof cardtrade.trades
language plpgsql
set search_path = ''
as $$
declare
  v_trade cardtrade.trades%rowtype;
  v_updated cardtrade.trades%rowtype;
  v_wanted integer;
  v_reserved integer;
begin
  select * into v_trade from cardtrade.trades where id = p_trade_id for update;

  if not found
    or v_trade.state <> 'NEGOTIATING'
    or v_trade.initiator_terms_accepted_version is distinct from v_trade.terms_version
    or v_trade.counterpart_terms_accepted_version is distinct from v_trade.terms_version then
    return;
  end if;

  -- ESC-04: collateral is placed a day before the MEETING, so terms with no
  -- face-to-face meeting instant have no placement time and no inspection clock.
  if v_trade.handover_method is distinct from 'IN_PERSON' or v_trade.meeting_at is null then
    raise exception 'terms-incomplete';
  end if;

  update cardtrade.trades
  set state = 'COLLATERAL_PENDING', version = v_trade.version + 1, updated_at = now()
  where id = p_trade_id
  returning * into v_updated;

  -- Reserve every SINGLE item, recording this trade as the owner of the reservation.
  -- A binder is never reserved (0064).
  select count(*) into v_wanted
  from cardtrade.items
  where id in (select item_id from cardtrade.trade_items where trade_id = p_trade_id)
    and listing_kind <> 'SHOPFRONT';

  update cardtrade.items
  set status = 'RESERVED', reserved_by_trade_id = p_trade_id
  where id in (select item_id from cardtrade.trade_items where trade_id = p_trade_id)
    and status = 'AVAILABLE'
    and listing_kind <> 'SHOPFRONT';
  get diagnostics v_reserved = row_count;

  -- ESC-19: a card that another contract already holds cannot go into this one.
  -- Raised, so the whole transition rolls back and the trade stays NEGOTIATING.
  if v_reserved < v_wanted then
    raise exception 'short-reservation';
  end if;

  insert into cardtrade.trade_state_transitions
    (trade_id, from_state, to_state, requested_by, event)
  values (p_trade_id, 'NEGOTIATING', 'COLLATERAL_PENDING', p_actor_id, 'TERMS_AGREED');

  return next v_updated;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. restore_trade_items_if_unclaimed: same name, scoped to this trade's own
-- ---------------------------------------------------------------------------
create or replace function cardtrade.restore_trade_items_if_unclaimed(p_trade_id uuid)
returns setof uuid
language sql
security definer
set search_path = ''
as $function$
  update cardtrade.items i
     set status = 'AVAILABLE',
         reserved_by_trade_id = null
   where i.id in (
           select ti.item_id
             from cardtrade.trade_items ti
            where ti.trade_id = p_trade_id
         )
     and i.status = 'RESERVED'
     and i.listing_kind = 'SINGLE'
     and (i.reserved_by_trade_id = p_trade_id or i.reserved_by_trade_id is null)
     and not exists (
           select 1
             from cardtrade.cash_sales cs
            where cs.item_id = i.id
              and cs.status not in ('CANCELLED', 'FAILED', 'REFUNDED', 'COMPLETED')
         )
     and not exists (
           select 1
             from cardtrade.trade_items ti2
             join cardtrade.trades t2 on t2.id = ti2.trade_id
            where ti2.item_id = i.id
              and t2.id <> p_trade_id
              and t2.state in (
                'COLLATERAL_PENDING', 'COLLATERAL_LOCKED', 'IN_TRANSIT',
                'INSPECTION', 'DISPUTED'
              )
         )
  returning i.id;
$function$;

-- ---------------------------------------------------------------------------
-- 5. FMV edits on an item in a trade
-- ---------------------------------------------------------------------------
create or replace function cardtrade.items_fmv_trade_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.fmv_cents is not distinct from old.fmv_cents then
    return new;
  end if;
  if new.listing_kind = 'SHOPFRONT' then
    -- A binder's price is an indicative "from" figure and never sizes anything.
    return new;
  end if;
  if exists (
    select 1
      from cardtrade.trade_items ti
      join cardtrade.trades t on t.id = ti.trade_id
     where ti.item_id = new.id
       and t.state in ('COLLATERAL_PENDING', 'COLLATERAL_LOCKED', 'IN_TRANSIT', 'INSPECTION', 'DISPUTED')
  ) then
    raise exception 'item-in-live-trade';
  end if;
  -- A negotiation priced on the old figure: void both acceptances, as a cash change does.
  update cardtrade.trades t
     set terms_version = t.terms_version + 1,
         version = t.version + 1,
         initiator_terms_accepted_version = null,
         initiator_terms_accepted_at = null,
         counterpart_terms_accepted_version = null,
         counterpart_terms_accepted_at = null,
         updated_at = now()
   where t.state = 'NEGOTIATING'
     and t.id in (select ti.trade_id from cardtrade.trade_items ti where ti.item_id = new.id);
  return new;
end;
$function$;

drop trigger if exists items_fmv_trade_guard on cardtrade.items;
create trigger items_fmv_trade_guard
  before update of fmv_cents on cardtrade.items
  for each row execute function cardtrade.items_fmv_trade_guard();

-- ---------------------------------------------------------------------------
-- 6. Grants (last). Service role only, as before.
-- ---------------------------------------------------------------------------
revoke all on function cardtrade.open_trade_negotiation(
  uuid, uuid, uuid, uuid, uuid[], uuid[], bigint, cardtrade.trade_cash_direction,
  bigint, cardtrade.handover_method, text, double precision, double precision,
  text, timestamptz, text, bigint, text, text
) from public, anon, authenticated;
grant execute on function cardtrade.open_trade_negotiation(
  uuid, uuid, uuid, uuid, uuid[], uuid[], bigint, cardtrade.trade_cash_direction,
  bigint, cardtrade.handover_method, text, double precision, double precision,
  text, timestamptz, text, bigint, text, text
) to service_role;
revoke all on function cardtrade.begin_trade_collateral(uuid, uuid) from public, anon, authenticated;
grant execute on function cardtrade.begin_trade_collateral(uuid, uuid) to service_role;
revoke all on function cardtrade.restore_trade_items_if_unclaimed(uuid) from public, anon, authenticated;
grant execute on function cardtrade.restore_trade_items_if_unclaimed(uuid) to service_role;
revoke all on function cardtrade.items_fmv_trade_guard() from public, anon, authenticated;
