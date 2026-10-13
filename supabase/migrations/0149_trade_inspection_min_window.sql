-- 0149_trade_inspection_min_window.sql
--
-- Review finding #16: the ESC-17b clamp (0142) had no lower bound. A handover
-- confirmed days after the meeting put `hold expiry - margin` behind now(), so the
-- deadline started in the past: both traders were told to raise a problem now, and the
-- :17 sweep auto-completed the trade and voided the holds in the same hour.
--
-- Now the clamped deadline is never earlier than `trade_inspection_min_hours()` from
-- entry. The custody backstop (0133) captures a live hold before it lapses, so a
-- problem raised in that window still has money behind it. Pinned to
-- TRADE_INSPECTION_MIN_HOURS by tests/unit/tradeClockAgreement.test.ts.

create or replace function cardtrade.trade_inspection_min_hours()
returns integer
language sql
immutable
set search_path to 'cardtrade', 'pg_temp'
as $function$ select 6 $function$;

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
  v_minimum timestamptz;
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

  -- ESC-17b: never past the collateral.
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

  -- And never in the past: the minimum window always stands.
  v_minimum := now() + make_interval(hours => cardtrade.trade_inspection_min_hours());
  if v_deadline < v_minimum then
    v_deadline := v_minimum;
  end if;

  new.inspection_deadline_at := v_deadline;

  if v_deadline < now() + interval '12 hours' then
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

-- Grants last.
revoke all on function cardtrade.trade_inspection_min_hours() from public, anon, authenticated;
grant execute on function cardtrade.trade_inspection_min_hours() to service_role;
