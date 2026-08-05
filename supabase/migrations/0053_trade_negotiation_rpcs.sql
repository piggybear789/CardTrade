-- 0053_trade_negotiation_rpcs.sql
--
-- Step 3: the negotiation itself. A Trade is opened at NEGOTIATING by the first
-- offer, countered by revising its terms, and enters escrow only once both sides
-- have accepted the SAME terms version.
--
-- Money stays out of SQL. `begin_trade_collateral` moves the row to
-- COLLATERAL_PENDING and reserves the items; the orchestrator then places the
-- holds and dispatches HOLDS_CONFIRMED / HOLDS_FAILED exactly as before. That
-- boundary is why these are RPCs and not one big function.
--
-- Requires 0051 (enum labels) and 0052 (terms columns + reset trigger).

-- Req 5.13 carried over from trade_proposals: at most one live offer per
-- proposing Trader per targeted Item. Enforced by the database rather than a
-- read-then-write in the action, so two concurrent submissions cannot both pass.
create unique index if not exists trades_one_live_negotiation_idx
  on cardtrade.trades (initiator_id, counterpart_item_id)
  where state = 'NEGOTIATING';

/**
 * Open a negotiation: create the Trade, its item rows and its conversation.
 *
 * The proposer implicitly accepts their own opening terms, so only the
 * counterpart's tick is outstanding. Without that the opening offer would sit
 * unaccepted by the person who made it.
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
  p_offer_message text default null
)
returns cardtrade.trades
language plpgsql
set search_path = ''
as $$
declare
  v_trade cardtrade.trades%rowtype;
  v_item_id uuid;
begin
  if p_initiator_id = p_counterpart_id then
    raise exception 'self-trade';
  end if;

  -- The targeted Item must belong to the counterpart and be available. Checked
  -- here as well as in the action because this runs as the service role.
  if not exists (
    select 1 from cardtrade.items
    where id = p_counterpart_item_id
      and owner_id = p_counterpart_id
      and status = 'AVAILABLE'
  ) then
    raise exception 'counterpart-item-unavailable';
  end if;

  if not exists (
    select 1 from cardtrade.items
    where id = p_initiator_item_id and owner_id = p_initiator_id
  ) then
    raise exception 'initiator-item-not-owned';
  end if;

  insert into cardtrade.trades (
    initiator_id, counterpart_id, initiator_item_id, counterpart_item_id,
    state, cash_amount_cents, cash_direction, declared_value_cents,
    handover_method, meeting_location, meeting_lat, meeting_lng,
    meeting_place_id, meeting_at, delivery_details, delivery_cost_cents,
    offer_message, terms_updated_at,
    initiator_terms_accepted_version, initiator_terms_accepted_at
  ) values (
    p_initiator_id, p_counterpart_id, p_initiator_item_id, p_counterpart_item_id,
    'NEGOTIATING', coalesce(p_cash_amount_cents, 0),
    coalesce(p_cash_direction, 'PROPOSER_PAYS'), p_declared_value_cents,
    p_handover_method, p_meeting_location, p_meeting_lat, p_meeting_lng,
    p_meeting_place_id, p_meeting_at, p_delivery_details, p_delivery_cost_cents,
    nullif(btrim(p_offer_message), ''), now(),
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

  -- The room exists from the first offer. This is the whole point of the change:
  -- the thread now spans negotiation, escrow and fulfilment without a seam.
  perform cardtrade.ensure_trade_conversation(v_trade.id, p_initiator_id);

  select * into v_trade from cardtrade.trades where id = v_trade.id;
  return v_trade;
end;
$$;

/**
 * Counter: revise the terms of a live negotiation.
 *
 * The `trades_reset_terms_acceptances` trigger bumps `terms_version` and clears
 * both ticks, then the actor's own tick is re-applied — proposing terms means
 * accepting them. Returns no row when the guards refuse, so the caller can tell
 * a stale version from a successful revision.
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
  p_offer_message text default null
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
    or v_trade.terms_version <> p_expected_terms_version
    or p_actor_id not in (v_trade.initiator_id, v_trade.counterpart_id) then
    return;
  end if;

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
      updated_at = now()
  where id = p_trade_id
  returning * into v_updated;

  -- Re-apply the proposer's own acceptance at the NEW version the trigger minted.
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

/** Tick the actor's acceptance of an exact terms version. */
create or replace function cardtrade.accept_trade_terms(
  p_trade_id uuid,
  p_actor_id uuid,
  p_terms_version integer
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
    or v_trade.terms_version <> p_terms_version
    or p_actor_id not in (v_trade.initiator_id, v_trade.counterpart_id) then
    return;
  end if;

  if p_actor_id = v_trade.initiator_id then
    update cardtrade.trades
    set initiator_terms_accepted_version = p_terms_version,
        initiator_terms_accepted_at = now(), updated_at = now()
    where id = p_trade_id returning * into v_updated;
  else
    update cardtrade.trades
    set counterpart_terms_accepted_version = p_terms_version,
        counterpart_terms_accepted_at = now(), updated_at = now()
    where id = p_trade_id returning * into v_updated;
  end if;

  return next v_updated;
end;
$$;

/**
 * Move an agreed negotiation into escrow and reserve both sides' Items.
 *
 * Guarded on BOTH ticks matching the current version, so this cannot be reached
 * by a caller that skipped the acceptance step. The holds themselves are the
 * orchestrator's job.
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

  -- Reserve every Item on the trade so neither side can sell it out from under
  -- the exchange while collateral is being sought.
  update cardtrade.items
  set status = 'RESERVED'
  where id in (select item_id from cardtrade.trade_items where trade_id = p_trade_id)
    and status = 'AVAILABLE';

  insert into cardtrade.trade_state_transitions
    (trade_id, from_state, to_state, requested_by, event)
  values (p_trade_id, 'NEGOTIATING', 'COLLATERAL_PENDING', p_actor_id, 'TERMS_AGREED');

  return next v_updated;
end;
$$;

/** End a negotiation before terms were agreed. Either party, one outcome. */
create or replace function cardtrade.decline_trade_negotiation(
  p_trade_id uuid,
  p_actor_id uuid,
  p_reason text default null
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
    or p_actor_id not in (v_trade.initiator_id, v_trade.counterpart_id) then
    return;
  end if;

  update cardtrade.trades
  set state = 'CANCELLED', version = v_trade.version + 1,
      cancelled_by = p_actor_id,
      cancel_reason = nullif(btrim(p_reason), ''),
      cancelled_at = now(), updated_at = now()
  where id = p_trade_id
  returning * into v_updated;

  insert into cardtrade.trade_state_transitions
    (trade_id, from_state, to_state, requested_by, event)
  values (p_trade_id, 'NEGOTIATING', 'CANCELLED', p_actor_id, 'OFFER_DECLINED');

  return next v_updated;
end;
$$;

revoke all on function cardtrade.open_trade_negotiation(
  uuid, uuid, uuid, uuid, uuid[], uuid[], bigint, cardtrade.trade_cash_direction,
  bigint, cardtrade.handover_method, text, double precision, double precision,
  text, timestamptz, text, bigint, text
) from public, anon, authenticated;
grant execute on function cardtrade.open_trade_negotiation(
  uuid, uuid, uuid, uuid, uuid[], uuid[], bigint, cardtrade.trade_cash_direction,
  bigint, cardtrade.handover_method, text, double precision, double precision,
  text, timestamptz, text, bigint, text
) to service_role;

revoke all on function cardtrade.update_trade_terms(
  uuid, uuid, integer, bigint, cardtrade.trade_cash_direction, bigint,
  cardtrade.handover_method, text, double precision, double precision, text,
  timestamptz, text, bigint, text
) from public, anon, authenticated;
grant execute on function cardtrade.update_trade_terms(
  uuid, uuid, integer, bigint, cardtrade.trade_cash_direction, bigint,
  cardtrade.handover_method, text, double precision, double precision, text,
  timestamptz, text, bigint, text
) to service_role;

revoke all on function cardtrade.accept_trade_terms(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function cardtrade.accept_trade_terms(uuid, uuid, integer) to service_role;

revoke all on function cardtrade.begin_trade_collateral(uuid, uuid)
  from public, anon, authenticated;
grant execute on function cardtrade.begin_trade_collateral(uuid, uuid) to service_role;

revoke all on function cardtrade.decline_trade_negotiation(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function cardtrade.decline_trade_negotiation(uuid, uuid, text) to service_role;
