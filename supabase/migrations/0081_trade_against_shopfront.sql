-- 0081_trade_against_shopfront.sql
--
-- Let a Trade be opened against a SHOPFRONT listing.
--
-- 0064 refused this outright, and named the two reasons: a binder's `fmv_cents`
-- is the whole inventory so bonding it is wrong, and a binder is permanently
-- AVAILABLE so the availability guards never fire. Both are addressed rather than
-- waved away.
--
--   1. VALUE. `domain/trade/tradeSideValues.ts` values a binder side at whatever
--      is offered against it, and both the collateral sizing and the Trade_Fee now
--      read that one rule. Nothing in SQL sizes a bond, so nothing here changes for
--      it — recorded so the next reader does not go looking.
--
--   2. WHAT IS ACTUALLY BEING SWAPPED. The listing cannot say, so the TRADE says,
--      in `counterpart_goods_description`. This is the trade-side equivalent of
--      `cash_sale_items` and exists for the same reason: arbitration reads the
--      contract and never the listing, so without it a disputed binder trade gives
--      staff a binder title and no way to adjudicate "she sent the wrong card". It
--      is part of the TERMS, so changing it voids both acceptances.
--
--   3. RESERVATION. `begin_trade_collateral` no longer reserves a SHOPFRONT. A
--      binder is never reserved and never sold; flipping it to RESERVED would pull
--      it out of the catalog for every other member, which is the exact bug 0064
--      exists to remove.
--
-- ACCEPTED RISK, RECORDED DELIBERATELY. This inherits 0064's accepted risk: with
-- no per-card reservation, a binder's owner can promise the same card to a cash
-- Buyer and a Trader at once. The containment is the same and is unchanged — the
-- goods are described on each contract as rows rather than chat, so the overlap is
-- queryable and admissible, and collateral means the wronged party has a remedy.
-- Do not "fix" it by reserving the binder.

-- =============================================================================
-- 1. What the binder's owner is actually handing over
-- =============================================================================

alter table cardtrade.trades
  add column if not exists counterpart_goods_description text;

alter table cardtrade.trades
  drop constraint if exists trades_counterpart_goods_description_length;
alter table cardtrade.trades
  add constraint trades_counterpart_goods_description_length
    check (
      counterpart_goods_description is null
      or char_length(counterpart_goods_description) between 1 and 1000
    );

comment on column cardtrade.trades.counterpart_goods_description is
  'What the counterpart is handing over, written in prose, when their listing is a SHOPFRONT and therefore cannot say. Null on a SINGLE listing, whose goods are the item itself. Part of the terms: revising it voids both acceptances. Read verbatim by arbitration.';

-- Part of the TERMS, so it joins the reset trigger's column list. Swapping which
-- cards come out of the binder changes what is being swapped just as surely as
-- changing the cash does, and nobody should stay bound to goods they did not agree
-- to. Same principle as `cash_sales_reset_acceptances` re-pricing a shopfront
-- contract from its lines.
drop trigger if exists trades_reset_terms_acceptances on cardtrade.trades;
create trigger trades_reset_terms_acceptances
before update of cash_amount_cents, cash_direction, declared_value_cents,
  handover_method, meeting_location, meeting_lat, meeting_lng, meeting_place_id,
  meeting_at, delivery_details, delivery_cost_cents, counterpart_goods_description
on cardtrade.trades
for each row execute function cardtrade.reset_trade_terms_acceptances();

-- =============================================================================
-- 2. Opening a negotiation against a binder
-- =============================================================================

-- Dropped rather than `create or replace`d: the new parameter would otherwise mint
-- a second overload, and supabase-js resolves an RPC by name.
drop function if exists cardtrade.open_trade_negotiation(
  uuid, uuid, uuid, uuid, uuid[], uuid[], bigint, cardtrade.trade_cash_direction,
  bigint, cardtrade.handover_method, text, double precision, double precision,
  text, timestamptz, text, bigint, text
);

/**
 * Open a negotiation: create the Trade, its item rows and its conversation.
 *
 * The proposer implicitly accepts their own opening terms, so only the
 * counterpart's tick is outstanding.
 */
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

  -- Availability means two different things by listing kind. A SINGLE listing is
  -- open for business while its status is AVAILABLE; a SHOPFRONT is permanently
  -- AVAILABLE by design and is open for business until it is CLOSED. Testing
  -- status alone is why a binder could never be traded for.
  if v_target.listing_kind = 'SHOPFRONT' then
    if v_target.closed_at is not null then
      raise exception 'counterpart-item-unavailable';
    end if;
    -- The trade has to state what is coming out of the binder, because the listing
    -- cannot. Refused here as well as in the action: this runs as the service role.
    if v_goods is null then
      raise exception 'counterpart-goods-required';
    end if;
  else
    if v_target.status <> 'AVAILABLE' then
      raise exception 'counterpart-item-unavailable';
    end if;
    -- A single listing IS the statement of its goods. A second, free-text one would
    -- be a second answer to "what is being swapped".
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

  -- A binder cannot be OFFERED into a trade, only traded FOR. Bonding one would
  -- authorise against an inventory, and the offering side is where that number
  -- comes from (`resolveTradeSideValues`), so it has to be a real figure.
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

-- =============================================================================
-- 3. Countering: the binder's contents are renegotiable like any other term
-- =============================================================================

drop function if exists cardtrade.update_trade_terms(
  uuid, uuid, integer, bigint, cardtrade.trade_cash_direction, bigint,
  cardtrade.handover_method, text, double precision, double precision, text,
  timestamptz, text, bigint, text
);

/**
 * Counter: revise the terms of a live negotiation.
 *
 * `counterpart_goods_description` is passed through unchanged when null on a trade
 * that has one, so a counter about postage cannot silently erase the statement of
 * what is being swapped. Clearing it is not a thing a counter can do; only a
 * different description replaces it.
 */
create or replace function cardtrade.update_trade_terms(
  p_trade_id uuid,
  p_actor_id uuid,
  p_expected_terms_version integer,
  p_cash_amount_cents bigint,
  p_cash_direction cardtrade.trade_cash_direction,
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
returns setof cardtrade.trades
language plpgsql
set search_path = ''
as $$
declare
  v_trade cardtrade.trades%rowtype;
  v_updated cardtrade.trades%rowtype;
  v_goods text;
begin
  select * into v_trade from cardtrade.trades where id = p_trade_id for update;

  if not found
    or v_trade.state <> 'NEGOTIATING'
    or v_trade.terms_version <> p_expected_terms_version
    or p_actor_id not in (v_trade.initiator_id, v_trade.counterpart_id) then
    return;
  end if;

  v_goods := coalesce(
    nullif(btrim(p_counterpart_goods_description), ''),
    v_trade.counterpart_goods_description
  );

  update cardtrade.trades
  set cash_amount_cents = coalesce(p_cash_amount_cents, 0),
      cash_direction = coalesce(p_cash_direction, v_trade.cash_direction),
      declared_value_cents = p_declared_value_cents,
      handover_method = p_handover_method,
      meeting_location = p_meeting_location,
      meeting_lat = p_meeting_lat,
      meeting_lng = p_meeting_lng,
      meeting_place_id = p_meeting_place_id,
      meeting_at = p_meeting_at,
      delivery_details = p_delivery_details,
      delivery_cost_cents = p_delivery_cost_cents,
      offer_message = nullif(btrim(p_offer_message), ''),
      counterpart_goods_description = v_goods,
      updated_at = now()
  where id = p_trade_id
  returning * into v_updated;

  if p_actor_id = v_updated.initiator_id then
    update cardtrade.trades
    set initiator_terms_accepted_version = v_updated.terms_version,
        initiator_terms_accepted_at = now()
    where id = p_trade_id returning * into v_updated;
  else
    update cardtrade.trades
    set counterpart_terms_accepted_version = v_updated.terms_version,
        counterpart_terms_accepted_at = now()
    where id = p_trade_id returning * into v_updated;
  end if;

  return next v_updated;
end;
$$;

-- =============================================================================
-- 4. Never reserve a binder
-- =============================================================================

/**
 * Both sides accepted: move to COLLATERAL_PENDING and reserve the goods.
 *
 * A SHOPFRONT is excluded from the reservation. It is never reserved and never
 * sold (0064) — several members hold their own contracts against it at once, and
 * `items_catalog_select` treats availability as VISIBILITY, so reserving one would
 * delete the binder from the catalog for everybody else.
 */
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
begin
  select * into v_trade from cardtrade.trades where id = p_trade_id for update;

  if not found
    or v_trade.state <> 'NEGOTIATING'
    or v_trade.initiator_terms_accepted_version is distinct from v_trade.terms_version
    or v_trade.counterpart_terms_accepted_version is distinct from v_trade.terms_version then
    return;
  end if;

  update cardtrade.trades
  set state = 'COLLATERAL_PENDING', version = v_trade.version + 1, updated_at = now()
  where id = p_trade_id
  returning * into v_updated;

  -- Reserve every Item on the trade so neither side can sell it out from under the
  -- exchange while collateral is being sought — EXCEPT a binder, which is never
  -- reserved and never sold.
  update cardtrade.items
  set status = 'RESERVED'
  where id in (select item_id from cardtrade.trade_items where trade_id = p_trade_id)
    and status = 'AVAILABLE'
    and listing_kind <> 'SHOPFRONT';

  insert into cardtrade.trade_state_transitions
    (trade_id, from_state, to_state, requested_by, event)
  values (p_trade_id, 'NEGOTIATING', 'COLLATERAL_PENDING', p_actor_id, 'TERMS_AGREED');

  return next v_updated;
end;
$$;

-- =============================================================================
-- 5. Grants. Unchanged policy: service_role only, called from server code.
-- =============================================================================

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

revoke all on function cardtrade.update_trade_terms(
  uuid, uuid, integer, bigint, cardtrade.trade_cash_direction, bigint,
  cardtrade.handover_method, text, double precision, double precision, text,
  timestamptz, text, bigint, text, text
) from public, anon, authenticated;
grant execute on function cardtrade.update_trade_terms(
  uuid, uuid, integer, bigint, cardtrade.trade_cash_direction, bigint,
  cardtrade.handover_method, text, double precision, double precision, text,
  timestamptz, text, bigint, text, text
) to service_role;

revoke all on function cardtrade.begin_trade_collateral(uuid, uuid)
  from public, anon, authenticated;
grant execute on function cardtrade.begin_trade_collateral(uuid, uuid) to service_role;
