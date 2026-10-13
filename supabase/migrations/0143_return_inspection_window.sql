-- 0143_return_inspection_window.sql
--
-- ESC-11: the seller gets a window to inspect a RETURN before the buyer is refunded.
--
-- Until now a carrier-confirmed delivery of the return queued the full refund in the
-- same transaction (0088, fixed in 0090). The seller had no chance to open the parcel.
-- An empty box, a different card, or a damaged one all refunded the buyer
-- automatically, because "the carrier delivered something" was treated as "the goods
-- came back". A return is the mirror of the outbound leg, and the outbound leg gives
-- the buyer seven days to inspect before the seller is paid.
--
-- Now delivery OPENS a window (`return_inspection_hours()`, pinned to
-- `RETURN_INSPECTION_HOURS` by tests/unit/tradeClockAgreement.test.ts). The refund is
-- released by the `:47` job (`releaseDueReturnRefunds`) once the window has passed with
-- no contest. Contesting inside the window freezes the refund and sends the case to
-- staff, exactly as before.
--
-- The refund is still AUTOMATIC. The seller cannot sit on it: doing nothing for 72
-- hours refunds the buyer.

alter table cardtrade.cash_sales
  add column if not exists return_inspection_deadline_at timestamptz,
  -- When the return leg was last read back from the carrier (ESC-30). The read-back
  -- path and the `:47` sync throttle on it so a missed webhook cannot strand a return.
  add column if not exists return_tracking_checked_at timestamptz;

comment on column cardtrade.cash_sales.return_inspection_deadline_at is
  'When the seller''s window to inspect a delivered return closes. After it, with no contest, the buyer is refunded automatically (ESC-11).';

create index if not exists cash_sales_return_inspection_due_idx
  on cardtrade.cash_sales (return_inspection_deadline_at)
  where status = 'RETURN_IN_TRANSIT' and return_disputed_at is null;

-- The seller's return inspection window, in hours (ESC-11).
create or replace function cardtrade.return_inspection_hours()
returns integer
language sql
immutable
set search_path to 'cardtrade', 'pg_temp'
as $function$ select 72 $function$;

-- Full-body replacement of 0088's function. The one behavioural change: DELIVERED
-- opens the seller's window and notifies them; it no longer queues the refund.
create or replace function cardtrade.apply_cash_sale_return_tracking(
  p_cash_sale_id uuid,
  p_tracking_status text,
  p_delivered_at timestamptz default null
)
returns setof cardtrade.cash_sales
language plpgsql
set search_path to ''
as $$
declare
  v_sale cardtrade.cash_sales%rowtype;
  v_delivered_at timestamptz;
begin
  select * into v_sale from cardtrade.cash_sales where id = p_cash_sale_id for update;
  if not found then return; end if;

  if v_sale.status not in ('RETURN_PENDING', 'RETURN_IN_TRANSIT') then
    return next v_sale; return;
  end if;

  if p_tracking_status <> 'DELIVERED' then
    update cardtrade.cash_sales
    set return_tracking_status = p_tracking_status,
        return_tracking_checked_at = now(),
        updated_at = now()
    where id = p_cash_sale_id returning * into v_sale;
    return next v_sale; return;
  end if;

  -- MONOTONIC: a second delivery event neither moves the window nor re-notifies.
  if v_sale.return_carrier_delivered_at is not null then
    return next v_sale; return;
  end if;

  v_delivered_at := coalesce(p_delivered_at, now());

  -- The window runs from NOW, not from the carrier's timestamp, for the same reason
  -- the outbound clock does since 0134: a back-dated scan must not shorten it.
  update cardtrade.cash_sales
  set return_tracking_status = 'DELIVERED',
      return_carrier_delivered_at = v_delivered_at,
      return_inspection_deadline_at =
        now() + make_interval(hours => cardtrade.return_inspection_hours()),
      return_tracking_checked_at = now(),
      updated_at = now()
  where id = p_cash_sale_id returning * into v_sale;

  insert into cardtrade.cash_sale_events
    (cash_sale_id, actor_id, event, from_status, to_status, detail)
  values
    (p_cash_sale_id, null, 'RETURN_DELIVERED', v_sale.status, v_sale.status,
     'Carrier confirmed the return reached the seller. The seller has '
       || (cardtrade.return_inspection_hours() / 24) || ' days to check it.');

  insert into cardtrade.notifications (user_id, type, title, body, link)
  values (
    v_sale.seller_id, 'SALE', 'Your return has arrived',
    'Check the return within ' || (cardtrade.return_inspection_hours() / 24)
      || ' days. After that the buyer is refunded automatically.',
    '/sales/' || p_cash_sale_id
  );

  return next v_sale;
end;
$$;

-- Grants last.
revoke all on function cardtrade.return_inspection_hours() from public, anon;
grant execute on function cardtrade.return_inspection_hours() to authenticated, service_role;
revoke all on function cardtrade.apply_cash_sale_return_tracking(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function cardtrade.apply_cash_sale_return_tracking(uuid, text, timestamptz)
  to service_role;
grant select (return_inspection_deadline_at) on cardtrade.cash_sales to authenticated;
