-- 0142_trade_auth_budget.sql
--
-- ESC-17b (Medium): a trade's inspection deadline could outlive the collateral behind
-- it. The deadline was `base + 72h`, floored at `now + 24h`, with no regard for when
-- the card authorisations actually lapse, so a late handover or a slow carrier set a
-- window that ended AFTER the holds had gone. A problem raised near the end of that
-- window had nothing left to capture.
--
-- ESC-33 (Low): the expiry warning went only to the trader whose hold was lapsing. The
-- other trader, whose protection it actually is, was never told; and on a disputed
-- trade staff were not told either.
--
-- Now:
--   * `set_trade_inspection_deadline` clamps the deadline to the earliest live hold's
--     expiry minus `collateral_margin_hours()`. THE CLAMP BEATS THE FLOOR: a window that
--     outlives the money backing it is a promise that cannot be kept. When the clamped
--     window leaves under 6 hours, both traders are told to raise any problem now.
--   * `warn_expiring_holds` notifies BOTH traders, and staff on a DISPUTED trade.
--
-- `deriveTradeInspectionDeadline` in `domain/fulfilment/inspection.ts` applies the same
-- clamp in TypeScript.

create or replace function cardtrade.set_trade_inspection_deadline()
returns trigger
language plpgsql
set search_path to 'cardtrade', 'pg_temp'
as $function$
declare
  v_base timestamptz;
  v_floor timestamptz;
  v_deadline timestamptz;
  v_min_expiry timestamptz;
  v_clamp timestamptz;
begin
  if new.state <> 'INSPECTION'
     or (old.state is not null and old.state = 'INSPECTION')
     or new.inspection_deadline_at is not null then
    return new;
  end if;

  if new.handover_method = 'IN_PERSON' then
    v_base := coalesce(new.meeting_at, now());
  else
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
  v_deadline := greatest(
    v_base + make_interval(hours => cardtrade.trade_inspection_hours()),
    v_floor
  );

  -- ESC-17b: never past the collateral. The earliest expiry among the live holds,
  -- less the margin a capture needs. No live expiry on file: no clamp.
  select min(h.expires_at) into v_min_expiry
    from cardtrade.pre_auth_holds h
   where h.trade_id = new.id
     and h.status = 'ACTIVE'
     and h.expires_at is not null;
  if v_min_expiry is not null then
    v_clamp := v_min_expiry - make_interval(hours => cardtrade.collateral_margin_hours());
    if v_clamp < v_deadline then
      v_deadline := v_clamp;
    end if;
  end if;

  new.inspection_deadline_at := v_deadline;

  -- Under six hours left: both traders are told now, while a problem can still be
  -- raised against live collateral.
  if v_deadline < now() + interval '6 hours' then
    insert into cardtrade.notifications (user_id, type, title, body, link)
    select uid, 'TRADE', 'Check your trade now',
           'The card holds behind this trade expire soon. If anything is wrong with what '
           || 'you received, raise a problem now.',
           '/trades/' || new.id
      from unnest(array[new.initiator_id, new.counterpart_id]) as uid;
  end if;

  return new;
end;
$function$;

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
    select h.id, h.trade_id, h.trader_id, h.expires_at, t.initiator_id, t.counterpart_id, t.state
    from cardtrade.pre_auth_holds h
    join cardtrade.trades t on t.id = h.trade_id
    where h.status = 'ACTIVE'
      and h.expires_at is not null
      and h.expiry_warned_at is null
      and h.expires_at <= now()
        + make_interval(hours => cardtrade.hold_expiry_warning_hours())
      and h.expires_at > now()
      and t.state not in ('COMPLETED', 'FRAUD_RESOLVED', 'CANCELLED')
    for update of h skip locked
  loop
    -- ESC-33: BOTH traders. The hold protects the OTHER trader as much as its owner.
    insert into cardtrade.notifications (user_id, type, title, body, link)
    select uid, 'TRADE', 'Trade collateral expires soon',
           'A card hold behind this trade lapses on '
             || to_char(r.expires_at at time zone 'Australia/Melbourne', 'FMDay D FMMon at HH12:MIam')
             || '. Resolve the trade or raise any problem before then, while the hold can still answer it.',
           '/trades/' || r.trade_id
      from unnest(array[r.initiator_id, r.counterpart_id]) as uid;

    -- And staff, when a dispute is waiting on that collateral.
    if r.state = 'DISPUTED' then
      insert into cardtrade.notifications (user_id, type, title, body, link)
      select p.id, 'SYSTEM', 'Disputed trade: collateral expiring',
             'A hold on a disputed trade lapses on '
               || to_char(r.expires_at at time zone 'Australia/Melbourne', 'FMDay D FMMon at HH12:MIam')
               || '. Decide the case before then.',
             '/admin/arbitration/TRADE/' || r.trade_id
        from cardtrade.profiles p
       where p.is_admin or p.is_support;
    end if;

    update cardtrade.pre_auth_holds
    set expiry_warned_at = now(), updated_at = now()
    where id = r.id;

    v_warned := v_warned + 1;
  end loop;

  return v_warned;
end;
$function$;

comment on function cardtrade.warn_expiring_holds() is
  'Warn BOTH traders before a collateral authorisation lapses on a live trade, and staff '
  'when the trade is DISPUTED (ESC-33). expire_lapsed_holds remains the backstop.';

-- Grants (re-stated; unchanged policy).
revoke all on function cardtrade.warn_expiring_holds() from public, anon, authenticated;
grant execute on function cardtrade.warn_expiring_holds() to service_role;
