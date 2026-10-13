-- 0150_tracking_binding_lock.sql
--
-- Review finding #12: 0144's binding was check-then-write. Two transactions writing
-- the same tracking number onto two different contracts could each run
-- `tracking_in_use`, both see no owner, and both commit, so one carrier delivery
-- advanced two refunds.
--
-- Each trigger now takes a transaction-scoped advisory lock keyed by the normalised
-- number BEFORE checking. The second writer waits for the first to commit, then sees
-- its row and is refused. The lock is per number, so unrelated writes never wait.

create or replace function cardtrade.cash_sales_tracking_binding()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_out text := cardtrade.normalize_tracking(new.tracking_number);
  v_ret text := cardtrade.normalize_tracking(new.return_tracking_number);
begin
  if v_out is not null
     and (tg_op = 'INSERT' or v_out is distinct from cardtrade.normalize_tracking(old.tracking_number)) then
    perform pg_advisory_xact_lock(hashtextextended('tracking:' || v_out, 0));
    if cardtrade.tracking_in_use(v_out, new.id, null, new.seller_id, new.buyer_id, false) then
      raise exception 'tracking-in-use' using errcode = 'P0001';
    end if;
  end if;
  if v_ret is not null
     and (tg_op = 'INSERT' or v_ret is distinct from cardtrade.normalize_tracking(old.return_tracking_number)) then
    perform pg_advisory_xact_lock(hashtextextended('tracking:' || v_ret, 0));
    if cardtrade.tracking_in_use(v_ret, new.id, null, null, null, true) then
      raise exception 'tracking-in-use' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function cardtrade.trades_tracking_binding()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_init text := cardtrade.normalize_tracking(new.initiator_tracking_number);
  v_counter text := cardtrade.normalize_tracking(new.counterpart_tracking_number);
begin
  if v_init is not null
     and v_init is distinct from cardtrade.normalize_tracking(old.initiator_tracking_number) then
    perform pg_advisory_xact_lock(hashtextextended('tracking:' || v_init, 0));
    if v_init = v_counter or cardtrade.tracking_in_use(v_init, null, new.id, null, null, true) then
      raise exception 'tracking-in-use' using errcode = 'P0001';
    end if;
  end if;
  if v_counter is not null
     and v_counter is distinct from cardtrade.normalize_tracking(old.counterpart_tracking_number) then
    perform pg_advisory_xact_lock(hashtextextended('tracking:' || v_counter, 0));
    if v_counter = v_init or cardtrade.tracking_in_use(v_counter, null, new.id, null, null, true) then
      raise exception 'tracking-in-use' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$function$;

-- Grants last (re-stated; trigger functions are never member-callable).
revoke all on function cardtrade.cash_sales_tracking_binding() from public, anon, authenticated;
revoke all on function cardtrade.trades_tracking_binding() from public, anon, authenticated;
