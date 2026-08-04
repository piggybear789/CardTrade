-- 0039_trade_shipping_deadline.sql
--
-- A dispatch deadline for DELIVERY trades, so collateral does not quietly outlive
-- its authorisation.
--
-- WHY ONLY DELIVERY. An IN_PERSON trade is inspected on the spot, so it resolves
-- in days and the ~7-day card authorisation window is never the binding
-- constraint. A posted trade ships in BOTH directions, and transit plus inspection
-- can plausibly exceed 7 days — at which point the provider releases the
-- collateral mid-trade and the escrow guarantee is gone (see 0035).
--
-- WHY NOT EXTEND THE AUTHORISATION INSTEAD. Stripe's extended authorisations
-- would raise the ceiling to 30 days, but they require IC+ pricing and, on Visa,
-- customer-initiated transactions — our holds are off_session, hence
-- merchant-initiated. Requesting the feature on an ineligible account fails the
-- whole PaymentIntent rather than degrading, which was verified against the test
-- API. Constraining the timeline is the fix that needs nobody's permission.
--
-- DELIBERATELY NON-DESTRUCTIVE. Nothing here cancels a trade or touches money. A
-- late dispatch is usually someone being slow, or having posted without marking
-- it — auto-cancelling on a timer would destroy legitimate trades. The job warns,
-- then records and escalates, and the hold-expiry reconciler from 0035 remains
-- the backstop.

-- Hours a Trader gets to dispatch after collateral locks. A function so the
-- policy lives in one place, matching cash_sale_inspection_days().
create or replace function cardtrade.trade_shipping_deadline_hours()
returns integer
language sql
immutable
set search_path to 'cardtrade', 'pg_temp'
as $function$ select 48 $function$;

-- How long before the deadline the nudge goes out.
create or replace function cardtrade.trade_shipping_warning_hours()
returns integer
language sql
immutable
set search_path to 'cardtrade', 'pg_temp'
as $function$ select 12 $function$;

alter table cardtrade.trades
  add column if not exists shipping_deadline_at timestamptz,
  add column if not exists shipping_warned_at timestamptz,
  add column if not exists shipping_overdue_at timestamptz;

comment on column cardtrade.trades.shipping_deadline_at is
  'When both sides must have dispatched, for DELIVERY trades only. Set when '
  'collateral locks. Null for IN_PERSON, which is inspected on the spot and never '
  'races the authorisation window.';

comment on column cardtrade.trades.shipping_overdue_at is
  'When the dispatch deadline was breached. Advisory: the trade is NOT cancelled, '
  'but the collateral is now at risk of lapsing before the trade resolves.';

create index if not exists trades_shipping_deadline_idx
  on cardtrade.trades (shipping_deadline_at)
  where state = 'COLLATERAL_LOCKED' and shipping_deadline_at is not null;

-- ---------------------------------------------------------------------------
-- Stamp the deadline when collateral locks
-- ---------------------------------------------------------------------------

create or replace function cardtrade.set_trade_shipping_deadline()
returns trigger
language plpgsql
set search_path to 'cardtrade', 'pg_temp'
as $function$
begin
  -- Only DELIVERY, only on entry to COLLATERAL_LOCKED, and only once: a trade
  -- that re-enters the state must not have its clock reset.
  if new.state = 'COLLATERAL_LOCKED'
     and new.handover_method = 'DELIVERY'
     and new.shipping_deadline_at is null
  then
    new.shipping_deadline_at :=
      now() + make_interval(hours => cardtrade.trade_shipping_deadline_hours());
  end if;
  return new;
end;
$function$;

drop trigger if exists trades_set_shipping_deadline on cardtrade.trades;
create trigger trades_set_shipping_deadline
  before insert or update of state, handover_method on cardtrade.trades
  for each row execute function cardtrade.set_trade_shipping_deadline();

-- ---------------------------------------------------------------------------
-- Warn, then escalate
-- ---------------------------------------------------------------------------

create or replace function cardtrade.enforce_trade_shipping_deadlines()
returns integer
language plpgsql
security definer
set search_path to 'cardtrade', 'pg_temp'
as $function$
declare
  v_actioned integer := 0;
  r record;
  v_target uuid;
begin
  -- 1. Nudge, once, while there is still time to act.
  for r in
    select t.id, t.initiator_id, t.counterpart_id, t.shipping_deadline_at,
           t.initiator_shipped_at, t.counterpart_shipped_at
    from cardtrade.trades t
    where t.state = 'COLLATERAL_LOCKED'
      and t.handover_method = 'DELIVERY'
      and t.shipping_deadline_at is not null
      and t.shipping_warned_at is null
      and t.shipping_deadline_at > now()
      and t.shipping_deadline_at <= now()
        + make_interval(hours => cardtrade.trade_shipping_warning_hours())
      -- Nothing to chase once both have dispatched.
      and (t.initiator_shipped_at is null or t.counterpart_shipped_at is null)
    for update of t skip locked
  loop
    -- Only the side that has not dispatched gets the nudge; telling someone who
    -- already posted to hurry up trains them to ignore notifications.
    foreach v_target in array array[
      case when r.initiator_shipped_at is null then r.initiator_id end,
      case when r.counterpart_shipped_at is null then r.counterpart_id end
    ]
    loop
      if v_target is not null then
        insert into cardtrade.notifications (user_id, type, title, body, link)
        values (
          v_target,
          'TRADE',
          'Dispatch your item soon',
          'Both sides need to post within '
            || cardtrade.trade_shipping_deadline_hours()
            || ' hours of collateral locking. The card authorisation holding the '
            || 'collateral expires about 7 days after it was placed, so a late '
            || 'dispatch risks the trade losing its protection before it finishes.',
          '/trades/' || r.id
        );
      end if;
    end loop;

    update cardtrade.trades
    set shipping_warned_at = now(), updated_at = now()
    where id = r.id;

    v_actioned := v_actioned + 1;
  end loop;

  -- 2. Deadline breached. Record it and tell BOTH sides — the party who did post
  --    is the one carrying the risk, and they need to know.
  for r in
    select t.id, t.state, t.initiator_id, t.counterpart_id
    from cardtrade.trades t
    where t.state = 'COLLATERAL_LOCKED'
      and t.handover_method = 'DELIVERY'
      and t.shipping_deadline_at is not null
      and t.shipping_deadline_at <= now()
      and t.shipping_overdue_at is null
      and (t.initiator_shipped_at is null or t.counterpart_shipped_at is null)
    for update of t skip locked
  loop
    update cardtrade.trades
    set shipping_overdue_at = now(), updated_at = now()
    where id = r.id;

    -- Same-state audit row: the Trade_State genuinely has not changed, and the
    -- realtime trade view already subscribes to this table.
    insert into cardtrade.trade_state_transitions
      (trade_id, from_state, to_state, requested_by, event)
    values (r.id, r.state, r.state, null, 'SHIPPING_OVERDUE');

    insert into cardtrade.notifications (user_id, type, title, body, link)
    select
      participant,
      'TRADE',
      'Trade dispatch is overdue',
      'This trade has passed its dispatch deadline and at least one item has not '
        || 'been posted. The trade is still open, but the collateral authorisation '
        || 'will lapse about 7 days after it was placed. If the item does not '
        || 'arrive, raise a dispute before then rather than after.',
      '/trades/' || r.id
    from unnest(array[r.initiator_id, r.counterpart_id]) as participant
    where participant is not null;

    v_actioned := v_actioned + 1;
  end loop;

  return v_actioned;
end;
$function$;

comment on function cardtrade.enforce_trade_shipping_deadlines is
  'Nudges the non-dispatching side before the DELIVERY dispatch deadline, then '
  'records SHIPPING_OVERDUE and alerts both parties once it passes. Never '
  'cancels a trade or moves money.';

-- Offset from the other three passes so they do not contend.
select cron.schedule(
  'cardtrade_enforce_trade_shipping_deadlines',
  '37 * * * *',
  $cron$ select cardtrade.enforce_trade_shipping_deadlines(); $cron$
);

-- Backfill: existing DELIVERY trades already holding collateral get a deadline
-- measured from now, not retroactively breached the moment this ships.
update cardtrade.trades
set shipping_deadline_at =
  now() + make_interval(hours => cardtrade.trade_shipping_deadline_hours())
where state = 'COLLATERAL_LOCKED'
  and handover_method = 'DELIVERY'
  and shipping_deadline_at is null;
