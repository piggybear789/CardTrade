-- 0035_hold_expiry_reconciler.sql
--
-- Makes the authorisation window REAL rather than advisory.
--
-- The problem this fixes: collateral holds are genuine card authorisations and
-- lapse after about 7 days. Until now `pre_auth_holds.expires_at` was never
-- populated and never read, so once the window passed the provider released the
-- collateral while the app still believed the Trade was secured. `voidHold`,
-- `partialCapture` and `fullCapture` would all fail, taking the Friction_Tax
-- (Req 7) and fraud capture (Req 8) with them, and nobody was told.
--
-- Two scheduled passes, mirroring `auto_complete_due_cash_sales`:
--   * warn_expiring_holds()  — tell both Traders while they can still act
--   * expire_lapsed_holds()  — reconcile belief with reality once it is too late
--
-- Neither one auto-resolves the Trade. Goods may already be in transit, so
-- cancelling on a timer could destroy a legitimate trade; the correct behaviour
-- is to make the loss of collateral loud and let the participants and the
-- dispute path decide.

-- Fire the warning once per hold rather than every run.
alter table cardtrade.pre_auth_holds
  add column if not exists expiry_warned_at timestamptz;

comment on column cardtrade.pre_auth_holds.expiry_warned_at is
  'When the pre-expiry warning was sent. Set by warn_expiring_holds() so the '
  'notification fires once rather than on every scheduled pass.';

-- How much notice a Trader gets before the authorisation lapses. A function
-- rather than a literal so it is tunable in one place, matching
-- cash_sale_inspection_days().
create or replace function cardtrade.hold_expiry_warning_hours()
returns integer
language sql
immutable
set search_path to 'cardtrade', 'pg_temp'
as $function$ select 48 $function$;

-- Only rows the reconciler cares about: live holds with a known deadline.
create index if not exists pre_auth_holds_expiring_idx
  on cardtrade.pre_auth_holds (expires_at)
  where status = 'ACTIVE' and expires_at is not null;

-- ---------------------------------------------------------------------------
-- Pre-expiry warning
-- ---------------------------------------------------------------------------

create or replace function cardtrade.warn_expiring_holds()
returns integer
language plpgsql
security definer
set search_path to 'cardtrade', 'pg_temp'
as $function$
declare
  v_warned integer := 0;
  r record;
begin
  for r in
    select h.id, h.trade_id, h.trader_id, h.expires_at
    from cardtrade.pre_auth_holds h
    join cardtrade.trades t on t.id = h.trade_id
    where h.status = 'ACTIVE'
      and h.expires_at is not null
      and h.expiry_warned_at is null
      and h.expires_at <= now()
        + make_interval(hours => cardtrade.hold_expiry_warning_hours())
      and h.expires_at > now()
      -- A resolved Trade needs no warning; its holds are about to be released
      -- deliberately anyway.
      and t.state not in ('COMPLETED', 'FRAUD_RESOLVED')
    for update of h skip locked
  loop
    insert into cardtrade.notifications (user_id, type, title, body, link)
    values (
      r.trader_id,
      'TRADE',
      'Trade collateral expires soon',
      'The authorisation holding your collateral lapses on '
        || to_char(r.expires_at at time zone 'Australia/Melbourne', 'FMDay D FMMon at HH12:MIam')
        || '. Resolve this trade before then, or the hold will be released and '
        || 'the trade will no longer be protected.',
      '/trades/' || r.trade_id
    );

    update cardtrade.pre_auth_holds
    set expiry_warned_at = now(), updated_at = now()
    where id = r.id;

    v_warned := v_warned + 1;
  end loop;

  return v_warned;
end;
$function$;

comment on function cardtrade.warn_expiring_holds is
  'Notifies each Trader once when their collateral authorisation is within '
  'hold_expiry_warning_hours() of lapsing. Returns the number of warnings sent.';

-- ---------------------------------------------------------------------------
-- Post-expiry reconciliation
-- ---------------------------------------------------------------------------

create or replace function cardtrade.expire_lapsed_holds()
returns integer
language plpgsql
security definer
set search_path to 'cardtrade', 'pg_temp'
as $function$
declare
  v_expired integer := 0;
  r record;
begin
  for r in
    select h.id, h.trade_id, h.trader_id, h.amount_cents,
           t.state, t.initiator_id, t.counterpart_id
    from cardtrade.pre_auth_holds h
    join cardtrade.trades t on t.id = h.trade_id
    where h.status = 'ACTIVE'
      and h.expires_at is not null
      and h.expires_at <= now()
    for update of h skip locked
  loop
    -- Reality: the provider has already released these funds. Recording EXPIRED
    -- rather than VOIDED keeps a lost guarantee distinguishable from an
    -- honoured one, and stops bothHoldsActive() counting it as collateral.
    update cardtrade.pre_auth_holds
    set status = 'EXPIRED', updated_at = now()
    where id = r.id and status = 'ACTIVE';

    -- Same-state audit row: the Trade_State genuinely has not changed, so this
    -- records the event without inventing a transition. The realtime trade view
    -- already subscribes to this table, so it surfaces without new plumbing.
    insert into cardtrade.trade_state_transitions
      (trade_id, from_state, to_state, requested_by, event)
    values (r.trade_id, r.state, r.state, null, 'COLLATERAL_EXPIRED');

    -- Both participants need to know the protection is gone, not just the payer.
    insert into cardtrade.notifications (user_id, type, title, body, link)
    select
      participant,
      'TRADE',
      'Trade collateral has expired',
      'The authorisation holding collateral on this trade has lapsed and the '
        || 'funds have been released by the payment provider. This trade is no '
        || 'longer protected by escrow. Do not hand over goods before contacting '
        || 'support.',
      '/trades/' || r.trade_id
    from unnest(array[r.initiator_id, r.counterpart_id]) as participant
    where participant is not null;

    v_expired := v_expired + 1;
  end loop;

  return v_expired;
end;
$function$;

comment on function cardtrade.expire_lapsed_holds is
  'Marks ACTIVE holds EXPIRED once expires_at has passed, records a same-state '
  'COLLATERAL_EXPIRED audit row, and notifies both Traders that escrow '
  'protection is gone. Returns the number of holds expired.';

-- ---------------------------------------------------------------------------
-- Schedule
-- ---------------------------------------------------------------------------

-- Hourly is enough precision for a 7-day window and a 48-hour warning, and
-- matches the existing cash-sale pass. Offset so the three jobs do not contend.
select cron.schedule(
  'cardtrade_warn_expiring_holds',
  '17 * * * *',
  $cron$ select cardtrade.warn_expiring_holds(); $cron$
);

select cron.schedule(
  'cardtrade_expire_lapsed_holds',
  '27 * * * *',
  $cron$ select cardtrade.expire_lapsed_holds(); $cron$
);
