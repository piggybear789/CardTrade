-- CardTrade — 0057_trade_fulfilment_parity.sql
--
-- Bring 2-way Trade fulfilment up to the standard the Cash_Sale already meets.
--
-- Trades have had a face-to-face / postage CHOICE since 0023, copied from the
-- retired private-deal column set, but none of the machinery behind it. Three
-- things were missing, and all three had consequences:
--
--   1. NO ADDRESS OF RECORD. A posted trade carried only a generated
--      `delivery_details` summary and a postage price, so traders swapped postal
--      addresses in chat — outside the contract and outside RLS. This is the only
--      postage flow in the product with no address of record.
--
--   2. NO FACE-TO-FACE PATH. An IN_PERSON trade still walked
--      COLLATERAL_LOCKED -> BOTH_SHIPPED -> IN_TRANSIT -> BOTH_RECEIVED, so two
--      people who met in a car park pressed a button labelled "Record shipment"
--      twice each. `handover_method` changed exactly two behaviours: whether
--      tracking was mandatory, and whether a dispatch deadline was set.
--
--   3. NO INSPECTION CLOCK. `IN_TRANSIT -> INSPECTION` was driven purely by both
--      traders asserting receipt, and nothing ever ended an INSPECTION. An
--      unresponsive counterpart parked both traders' collateral until the card
--      authorisation lapsed — which silently removes the guarantee both sides were
--      promised, rather than resolving anything.
--
-- The face-to-face path deliberately converges on INSPECTION rather than
-- completing on the second handover confirmation, which is where this differs from
-- the Cash_Sale. A cash sale hands the buyer their goods and their remedy is a
-- refund. A trade hands over collateral-backed goods in a physical meeting, and a
-- trader who has just been robbed or coerced must not be able to irrevocably
-- complete the trade at the meeting point. Confirming a handover says "we met and
-- swapped", not "I am satisfied".

-- ---------------------------------------------------------------------------
-- 1. Protected postal addresses — one per trader, because a swap posts both ways
-- ---------------------------------------------------------------------------

-- Mirrors cardtrade.cash_sale_delivery_details (0050). Two rows per trade rather
-- than one: in a cash sale only the Buyer receives goods, but in a trade both
-- sides do, so each trader needs to read the OTHER's address.
create table if not exists cardtrade.trade_delivery_details (
  trade_id uuid not null references cardtrade.trades(id) on delete cascade,
  trader_id uuid not null references cardtrade.profiles(id),
  address_label text not null
    check (char_length(btrim(address_label)) between 1 and 1000),
  place_id text not null check (char_length(btrim(place_id)) between 1 and 255),
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  latitude double precision,
  longitude double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (trade_id, trader_id),
  constraint trade_delivery_details_coords_check check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180)
  )
);

create index if not exists trade_delivery_details_trader_idx
  on cardtrade.trade_delivery_details (trader_id);

alter table cardtrade.trade_delivery_details enable row level security;

-- A trader may always read the address they entered.
drop policy if exists trade_delivery_details_owner_select
  on cardtrade.trade_delivery_details;
create policy trade_delivery_details_owner_select
  on cardtrade.trade_delivery_details for select to authenticated
  using ((select auth.uid()) = trader_id);

-- The other trader may read it only once collateral is locked on both sides.
-- Before that the trade is still a negotiation, and a negotiation must not
-- disclose where somebody lives. This is the trade equivalent of the Cash_Sale's
-- "seller reads the address from ESCROW_HELD onward".
drop policy if exists trade_delivery_details_counterpart_select
  on cardtrade.trade_delivery_details;
create policy trade_delivery_details_counterpart_select
  on cardtrade.trade_delivery_details for select to authenticated
  using (
    exists (
      select 1
      from cardtrade.trades t
      where t.id = trade_delivery_details.trade_id
        and t.handover_method = 'DELIVERY'
        and t.state in (
          'COLLATERAL_LOCKED', 'IN_TRANSIT', 'INSPECTION',
          'COMPLETED', 'DISPUTED', 'FRAUD_RESOLVED'
        )
        -- The reader is the OTHER participant; the owner is covered above.
        and (select auth.uid()) in (t.initiator_id, t.counterpart_id)
        and trade_delivery_details.trader_id in (t.initiator_id, t.counterpart_id)
        and trade_delivery_details.trader_id <> (select auth.uid())
    )
  );

revoke all on cardtrade.trade_delivery_details from anon, authenticated;
grant select on cardtrade.trade_delivery_details to authenticated;
grant all on cardtrade.trade_delivery_details to service_role;

comment on table cardtrade.trade_delivery_details is
  'Protected postal addresses for a posted trade, one row per trader. Not in the '
  'Realtime publication; readable by the other trader only from COLLATERAL_LOCKED.';

-- ---------------------------------------------------------------------------
-- 2. New columns on trades
-- ---------------------------------------------------------------------------

alter table cardtrade.trades
  -- Non-sensitive presence flags. The address itself must never live on this
  -- table, which IS Realtime-published to both participants.
  add column if not exists initiator_delivery_address_configured boolean not null default false,
  add column if not exists counterpart_delivery_address_configured boolean not null default false,
  -- Face-to-face: each trader confirms the meeting happened, exactly once.
  add column if not exists initiator_handover_confirmed_at timestamptz,
  add column if not exists counterpart_handover_confirmed_at timestamptz,
  -- Carrier state per outbound parcel, so a delivery is the CARRIER's word.
  add column if not exists initiator_tracking_status text,
  add column if not exists counterpart_tracking_status text,
  add column if not exists initiator_carrier_delivered_at timestamptz,
  add column if not exists counterpart_carrier_delivered_at timestamptz,
  -- The inspection clock.
  add column if not exists inspection_deadline_at timestamptz,
  add column if not exists inspection_warned_at timestamptz,
  add column if not exists auto_completed boolean not null default false;

comment on column cardtrade.trades.initiator_delivery_address_configured is
  'True when a protected postal address exists for the initiator. Contains no address data.';
comment on column cardtrade.trades.initiator_handover_confirmed_at is
  'When the initiator confirmed the face-to-face handover happened. Both confirmations move the trade to INSPECTION, NOT to COMPLETED.';
comment on column cardtrade.trades.initiator_carrier_delivered_at is
  'When the carrier confirmed the initiator''s parcel was delivered. Never the sender''s own assertion.';
comment on column cardtrade.trades.inspection_deadline_at is
  'After this instant an untouched INSPECTION trade auto-completes. 72h from the meeting instant (IN_PERSON) or from the later carrier delivery (DELIVERY).';
comment on column cardtrade.trades.auto_completed is
  'True when completion came from the inspection timeout rather than both traders accepting.';

-- ---------------------------------------------------------------------------
-- 3. The inspection window
-- ---------------------------------------------------------------------------

-- 72 hours, NOT the Cash_Sale's 7 days. A trade's collateral is an uncaptured
-- card authorisation that lapses about 7 days after it was PLACED, and a trade's
-- clock starts at collateral rather than at delivery. Postage both ways plus a
-- 7-day inspection would routinely outlive the authorisation, at which point a
-- dispute has nothing left to capture. Kept in step with TRADE_INSPECTION_HOURS in
-- domain/fulfilment/inspection.ts.
create or replace function cardtrade.trade_inspection_hours()
returns integer
language sql
immutable
set search_path to 'cardtrade', 'pg_temp'
as $function$ select 72 $function$;

-- The window nobody drops below. A face-to-face deadline is measured from the
-- AGREED meeting instant, which can already be in the past when both traders get
-- round to confirming; without a floor such a trade would auto-complete on the
-- spot and neither side would ever have had a chance to dispute.
create or replace function cardtrade.trade_inspection_floor_hours()
returns integer
language sql
immutable
set search_path to 'cardtrade', 'pg_temp'
as $function$ select 24 $function$;

/**
 * Stamp the inspection deadline when a trade enters INSPECTION.
 *
 * A trigger rather than application code because both routes into INSPECTION —
 * BOTH_RECEIVED for a posted trade and BOTH_HANDOVER_CONFIRMED for a
 * face-to-face one — commit through the orchestrator's optimistic-lock UPDATE,
 * and neither should have to remember to set a clock.
 */
create or replace function cardtrade.set_trade_inspection_deadline()
returns trigger
language plpgsql
set search_path to 'cardtrade', 'pg_temp'
as $function$
declare
  v_base timestamptz;
  v_floor timestamptz;
begin
  if new.state <> 'INSPECTION'
     or (old.state is not null and old.state = 'INSPECTION')
     or new.inspection_deadline_at is not null then
    return new;
  end if;

  if new.handover_method = 'IN_PERSON' then
    -- The meeting both traders accepted IS the exchange.
    v_base := coalesce(new.meeting_at, now());
  else
    -- Only the carrier can say a parcel landed, and the trade is exchanged only
    -- once BOTH have. A missing confirmation falls back to now(): a trader's own
    -- word must not start a clock that can pay out against them.
    if new.initiator_carrier_delivered_at is null
       or new.counterpart_carrier_delivered_at is null then
      v_base := now();
    else
      v_base := greatest(
        new.initiator_carrier_delivered_at,
        new.counterpart_carrier_delivered_at
      );
    end if;
  end if;

  v_floor := now() + make_interval(hours => cardtrade.trade_inspection_floor_hours());
  new.inspection_deadline_at := greatest(
    v_base + make_interval(hours => cardtrade.trade_inspection_hours()),
    v_floor
  );
  return new;
end;
$function$;

drop trigger if exists trades_set_inspection_deadline on cardtrade.trades;
create trigger trades_set_inspection_deadline
  before update of state on cardtrade.trades
  for each row execute function cardtrade.set_trade_inspection_deadline();

create index if not exists trades_inspection_deadline_idx
  on cardtrade.trades (inspection_deadline_at)
  where state = 'INSPECTION' and inspection_deadline_at is not null;

-- ---------------------------------------------------------------------------
-- 4. Carrier tracking per parcel
-- ---------------------------------------------------------------------------

/**
 * Record a carrier tracking update for one trader's outbound parcel.
 *
 * Unlike apply_cash_sale_tracking, a DELIVERED status does NOT advance the state
 * on its own: a trade needs BOTH parcels to land, and the second confirmation is
 * what completes the exchange. The orchestrator reads these columns back and
 * derives BOTH_RECEIVED, so the transition stays in one place.
 *
 * `p_trader_id` must be a participant. Returns no row when it is not, so a
 * mis-wired caller cannot write tracking onto a trade it does not belong to.
 */
create or replace function cardtrade.apply_trade_tracking(
  p_trade_id uuid,
  p_trader_id uuid,
  p_tracking_status text,
  p_delivered_at timestamptz default null
)
returns setof cardtrade.trades
language plpgsql
set search_path to 'cardtrade', 'pg_temp'
as $function$
declare
  v_trade cardtrade.trades%rowtype;
  v_delivered_at timestamptz;
  v_updated cardtrade.trades%rowtype;
begin
  select * into v_trade from cardtrade.trades where id = p_trade_id for update;
  if not found then
    return;
  end if;
  if p_trader_id not in (v_trade.initiator_id, v_trade.counterpart_id) then
    return;
  end if;

  v_delivered_at := case
    when p_tracking_status = 'DELIVERED' then coalesce(p_delivered_at, now())
    else null
  end;

  if p_trader_id = v_trade.initiator_id then
    update cardtrade.trades
    set initiator_tracking_status = p_tracking_status,
        -- Monotonic: a later EXCEPTION must not unsay a confirmed delivery.
        initiator_carrier_delivered_at =
          coalesce(initiator_carrier_delivered_at, v_delivered_at),
        updated_at = now()
    where id = p_trade_id
    returning * into v_updated;
  else
    update cardtrade.trades
    set counterpart_tracking_status = p_tracking_status,
        counterpart_carrier_delivered_at =
          coalesce(counterpart_carrier_delivered_at, v_delivered_at),
        updated_at = now()
    where id = p_trade_id
    returning * into v_updated;
  end if;

  return next v_updated;
end;
$function$;

revoke all on function cardtrade.apply_trade_tracking(uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function cardtrade.apply_trade_tracking(uuid, uuid, text, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. Saving a postal address
-- ---------------------------------------------------------------------------

/**
 * Upsert one trader's postal address and flag its presence on the trade.
 *
 * Atomic, and guarded in SQL as well as in the action: the service role is the
 * only caller, but an accidental call must not be able to write an address onto a
 * trade the actor is not part of, or onto one that has already shipped.
 *
 * Returns the updated trade, or no row when the guards refuse.
 */
create or replace function cardtrade.set_trade_delivery_address(
  p_trade_id uuid,
  p_trader_id uuid,
  p_address_label text,
  p_place_id text,
  p_country_code text default null,
  p_latitude double precision default null,
  p_longitude double precision default null
)
returns setof cardtrade.trades
language plpgsql
set search_path to 'cardtrade', 'pg_temp'
as $function$
declare
  v_trade cardtrade.trades%rowtype;
  v_updated cardtrade.trades%rowtype;
begin
  select * into v_trade from cardtrade.trades where id = p_trade_id for update;
  if not found then
    return;
  end if;
  if p_trader_id not in (v_trade.initiator_id, v_trade.counterpart_id) then
    return;
  end if;
  -- An address is only meaningful before the other side posts to it.
  if v_trade.state not in ('NEGOTIATING', 'COLLATERAL_PENDING', 'COLLATERAL_LOCKED') then
    return;
  end if;
  if btrim(coalesce(p_address_label, '')) = '' or btrim(coalesce(p_place_id, '')) = '' then
    return;
  end if;

  insert into cardtrade.trade_delivery_details (
    trade_id, trader_id, address_label, place_id, country_code, latitude, longitude
  ) values (
    p_trade_id, p_trader_id, btrim(p_address_label), btrim(p_place_id),
    nullif(btrim(coalesce(p_country_code, '')), ''), p_latitude, p_longitude
  )
  on conflict (trade_id, trader_id) do update
  set address_label = excluded.address_label,
      place_id = excluded.place_id,
      country_code = excluded.country_code,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      updated_at = now();

  if p_trader_id = v_trade.initiator_id then
    update cardtrade.trades
    set initiator_delivery_address_configured = true, updated_at = now()
    where id = p_trade_id returning * into v_updated;
  else
    update cardtrade.trades
    set counterpart_delivery_address_configured = true, updated_at = now()
    where id = p_trade_id returning * into v_updated;
  end if;

  return next v_updated;
end;
$function$;

revoke all on function cardtrade.set_trade_delivery_address(
  uuid, uuid, text, text, text, double precision, double precision
) from public, anon, authenticated;
grant execute on function cardtrade.set_trade_delivery_address(
  uuid, uuid, text, text, text, double precision, double precision
) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Backfill
-- ---------------------------------------------------------------------------

-- Trades already sitting in INSPECTION have no deadline and would otherwise wait
-- forever. Measure from now rather than retroactively, so nothing completes the
-- moment this migration lands.
update cardtrade.trades
set inspection_deadline_at =
  now() + make_interval(hours => cardtrade.trade_inspection_hours())
where state = 'INSPECTION'
  and inspection_deadline_at is null;

-- Presence flags for any addresses that somehow already exist (re-run safety).
update cardtrade.trades t
set initiator_delivery_address_configured = exists (
      select 1 from cardtrade.trade_delivery_details d
      where d.trade_id = t.id and d.trader_id = t.initiator_id
    ),
    counterpart_delivery_address_configured = exists (
      select 1 from cardtrade.trade_delivery_details d
      where d.trade_id = t.id and d.trader_id = t.counterpart_id
    )
where exists (
  select 1 from cardtrade.trade_delivery_details d where d.trade_id = t.id
);
