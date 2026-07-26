-- CardTrade — 0011_cash_sale_auto_settle.sql
-- Auto-settlement after carrier-confirmed delivery (Req 4.14a).
--
-- A buyer who never presses "I received the item" must not strand the seller.
-- The clock is started by the CARRIER confirming delivery, never by the seller's
-- word: once delivery is confirmed the buyer gets a fixed inspection window to
-- accept or dispute, and the contract completes on its own when it expires.
-- A DISPUTED contract is excluded, so raising a dispute always stops the clock.

alter table cardtrade.cash_sales
  add column carrier_delivered_at timestamptz,
  add column inspection_deadline_at timestamptz,
  add column auto_completed boolean not null default false;

comment on column cardtrade.cash_sales.carrier_delivered_at is
  'When the shipping provider confirmed delivery. Starts the inspection window.';
comment on column cardtrade.cash_sales.inspection_deadline_at is
  'After this instant an untouched INSPECTION contract auto-completes.';
comment on column cardtrade.cash_sales.auto_completed is
  'True when completion came from the inspection timeout rather than buyer acceptance.';

create index cash_sales_inspection_deadline_idx
  on cardtrade.cash_sales (inspection_deadline_at)
  where status = 'INSPECTION' and inspection_deadline_at is not null;

-- The inspection window, in days. Single source of truth for the deadline.
create or replace function cardtrade.cash_sale_inspection_days()
returns integer
language sql
immutable
set search_path = ''
as $$ select 7; $$;

/**
 * Record a carrier tracking update. A DELIVERED status advances IN_TRANSIT to
 * INSPECTION and starts the inspection window; any other status only updates the
 * displayed tracking state.
 */
create or replace function cardtrade.apply_cash_sale_tracking(
  p_cash_sale_id uuid,
  p_tracking_status text,
  p_delivered_at timestamptz default null
)
returns setof cardtrade.cash_sales
language plpgsql
set search_path = ''
as $$
declare
  v_sale cardtrade.cash_sales%rowtype;
  v_delivered_at timestamptz;
  v_deadline timestamptz;
begin
  select * into v_sale
  from cardtrade.cash_sales
  where id = p_cash_sale_id
  for update;

  if not found then
    return;
  end if;

  if p_tracking_status <> 'DELIVERED' then
    update cardtrade.cash_sales
    set tracking_status = p_tracking_status, updated_at = now()
    where id = p_cash_sale_id
    returning * into v_sale;
    return next v_sale;
    return;
  end if;

  v_delivered_at := coalesce(p_delivered_at, now());
  v_deadline := v_delivered_at
    + (cardtrade.cash_sale_inspection_days() || ' days')::interval;

  if v_sale.status = 'IN_TRANSIT' then
    update cardtrade.cash_sales
    set status = 'INSPECTION',
        tracking_status = 'DELIVERED',
        carrier_delivered_at = v_delivered_at,
        received_at = coalesce(received_at, v_delivered_at),
        inspection_deadline_at = v_deadline,
        updated_at = now()
    where id = p_cash_sale_id
    returning * into v_sale;

    insert into cardtrade.cash_sale_events (
      cash_sale_id, actor_id, event, from_status, to_status, detail
    ) values (
      p_cash_sale_id, null, 'CARRIER_DELIVERED', 'IN_TRANSIT', 'INSPECTION',
      'Carrier confirmed delivery. Auto-completes after '
        || cardtrade.cash_sale_inspection_days() || ' days unless the buyer acts.'
    );
  elsif v_sale.status = 'INSPECTION' and v_sale.carrier_delivered_at is null then
    -- Buyer already recorded receipt; the carrier confirmation still sets the clock.
    update cardtrade.cash_sales
    set tracking_status = 'DELIVERED',
        carrier_delivered_at = v_delivered_at,
        inspection_deadline_at = v_deadline,
        updated_at = now()
    where id = p_cash_sale_id
    returning * into v_sale;
  else
    update cardtrade.cash_sales
    set tracking_status = 'DELIVERED', updated_at = now()
    where id = p_cash_sale_id
    returning * into v_sale;
  end if;

  return next v_sale;
end;
$$;

revoke all on function cardtrade.apply_cash_sale_tracking(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function cardtrade.apply_cash_sale_tracking(uuid, text, timestamptz)
  to service_role;

/**
 * Complete every INSPECTION contract whose window has expired. Idempotent and
 * safe to run on a schedule: DISPUTED contracts are already excluded by the
 * status filter, and each row is only touched once because it leaves INSPECTION.
 */
create or replace function cardtrade.auto_complete_due_cash_sales()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_completed integer := 0;
  r record;
begin
  for r in
    select id, item_id
    from cardtrade.cash_sales
    where status = 'INSPECTION'
      and inspection_deadline_at is not null
      and inspection_deadline_at <= now()
    for update skip locked
  loop
    update cardtrade.cash_sales
    set status = 'COMPLETED',
        completed_at = now(),
        auto_completed = true,
        updated_at = now()
    where id = r.id and status = 'INSPECTION';

    update cardtrade.items
    set status = 'SOLD', updated_at = now()
    where id = r.item_id and status = 'RESERVED';

    insert into cardtrade.cash_sale_events (
      cash_sale_id, actor_id, event, from_status, to_status, detail
    ) values (
      r.id, null, 'AUTO_COMPLETED', 'INSPECTION', 'COMPLETED',
      'Inspection window of ' || cardtrade.cash_sale_inspection_days()
        || ' days expired after carrier-confirmed delivery.'
    );

    v_completed := v_completed + 1;
  end loop;

  return v_completed;
end;
$$;

revoke all on function cardtrade.auto_complete_due_cash_sales() from public, anon, authenticated;
grant execute on function cardtrade.auto_complete_due_cash_sales() to service_role;

comment on function cardtrade.auto_complete_due_cash_sales() is
  'Scheduled sweeper: completes contracts whose post-delivery inspection window lapsed.';

-- Run the sweeper hourly. Hourly is fine for a 7-day window and keeps the job
-- cheap; the deadline itself is exact, so nothing completes early.
create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'cardtrade_auto_complete_cash_sales') then
    perform cron.unschedule('cardtrade_auto_complete_cash_sales');
  end if;
  perform cron.schedule(
    'cardtrade_auto_complete_cash_sales',
    '7 * * * *',
    $job$ select cardtrade.auto_complete_due_cash_sales(); $job$
  );
end
$$;
