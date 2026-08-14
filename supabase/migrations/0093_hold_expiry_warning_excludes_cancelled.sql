-- 0093_hold_expiry_warning_excludes_cancelled.sql
--
-- Stop telling members to "resolve" a trade that is already cancelled.
--
-- `warn_expiring_holds` (0035) skips trades in `COMPLETED` and `FRAUD_RESOLVED` but not
-- `CANCELLED`, which is equally terminal. So a cancelled trade whose hold is still ACTIVE
-- earned its trader this notification:
--
--   "The authorisation holding your collateral lapses on <date>. Resolve this trade
--    before then, or the hold will be released and the trade will no longer be
--    protected."
--
-- Every clause of that is wrong for a cancelled trade. There is nothing to resolve, the
-- hold being released is the DESIRED outcome rather than a loss, and "no longer
-- protected" describes a trade that ended. It reads as an urgent instruction to act on
-- something the member cannot act on, about money they are about to get back anyway.
--
-- WHY THE HOLD IS STILL ACTIVE AT ALL. Cancelling voids both holds, so normally there is
-- nothing here. An ACTIVE hold on a CANCELLED trade means the void FAILED — a provider
-- error, or an authorisation that had already lapsed. That is an operational anomaly, and
-- `expire_lapsed_holds` remains the backstop: it still marks the hold EXPIRED an hour
-- after `expires_at` and still notifies, so the member is told the authorisation is gone
-- once it actually is. What they no longer get is a false alarm beforehand.
--
-- This is a copy-and-targeting fix, not a money fix. No funds move either way: a lapsing
-- authorisation releases itself.

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
      -- ALL THREE terminal states, not two. CANCELLED was missing, which produced an
      -- urgent instruction to resolve a trade that had already ended.
      and t.state not in ('COMPLETED', 'FRAUD_RESOLVED', 'CANCELLED')
    for update of h skip locked
  loop
    insert into cardtrade.notifications (user_id, type, title, body, link)
    values (
      r.trader_id,
      'TRADE',
      'Trade collateral expires soon',
      'The authorisation holding your collateral lapses on '
        || to_char(r.expires_at at time zone 'Australia/Melbourne', 'FMDay D FMMon at HH12:MIam')
        || '. Resolve this trade before then, or the hold will be released and the trade will no longer be protected.',
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

comment on function cardtrade.warn_expiring_holds() is
  'Warn traders before a collateral authorisation lapses on a LIVE trade. Skips all '
  'three terminal states - a cancelled trade has nothing to resolve and its hold '
  'lapsing is the desired outcome. expire_lapsed_holds remains the backstop that '
  'reports the authorisation actually going.';
