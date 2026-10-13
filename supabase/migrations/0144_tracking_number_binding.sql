-- 0144_tracking_number_binding.sql
--
-- ESC-12: one tracking number belongs to one contract.
--
-- Nothing stopped a seller entering the same tracking number on several sales, or a
-- buyer entering the seller's own outbound number as the "return". One genuine parcel
-- could start several inspection clocks or release a refund for goods never sent back.
--
-- A number is in use when another contract carrying it is still live, or closed in
-- the last 90 days. The one exception is the same buyer and seller on the outbound
-- leg: several items from one seller to one buyer legitimately share a parcel. A
-- return number may never equal any outbound number, or another return.
--
-- Raises 'tracking-in-use'; the repository maps it to TRACKING_IN_USE.

create or replace function cardtrade.normalize_tracking(p text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select nullif(upper(regexp_replace(coalesce(p, ''), '[\s-]+', '', 'g')), '')
$function$;

create index if not exists cash_sales_tracking_norm_idx
  on cardtrade.cash_sales (cardtrade.normalize_tracking(tracking_number))
  where tracking_number is not null;
create index if not exists cash_sales_return_tracking_norm_idx
  on cardtrade.cash_sales (cardtrade.normalize_tracking(return_tracking_number))
  where return_tracking_number is not null;
create index if not exists trades_initiator_tracking_norm_idx
  on cardtrade.trades (cardtrade.normalize_tracking(initiator_tracking_number))
  where initiator_tracking_number is not null;
create index if not exists trades_counterpart_tracking_norm_idx
  on cardtrade.trades (cardtrade.normalize_tracking(counterpart_tracking_number))
  where counterpart_tracking_number is not null;

-- True when a normalised number is held by any contract other than the one being
-- written. `p_pair_seller` / `p_pair_buyer` exempt the same-pair outbound case.
create or replace function cardtrade.tracking_in_use(
  p_norm text,
  p_cash_sale_id uuid,
  p_trade_id uuid,
  p_pair_seller uuid,
  p_pair_buyer uuid,
  p_is_return boolean
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    -- Outbound legs of other cash sales.
    select 1 from cardtrade.cash_sales cs
    where cardtrade.normalize_tracking(cs.tracking_number) = p_norm
      and cs.id is distinct from p_cash_sale_id
      and (
        cs.status not in ('COMPLETED', 'CANCELLED', 'FAILED', 'REFUNDED')
        or coalesce(cs.completed_at, cs.cancelled_at, cs.updated_at) > now() - interval '90 days'
      )
      and (
        p_is_return
        or not (cs.seller_id = p_pair_seller and cs.buyer_id = p_pair_buyer)
      )
  )
  or exists (
    -- A return number may never be any outbound number, including its own sale's.
    select 1 from cardtrade.cash_sales cs
    where p_is_return
      and cardtrade.normalize_tracking(cs.tracking_number) = p_norm
  )
  or exists (
    -- Return legs of other cash sales.
    select 1 from cardtrade.cash_sales cs
    where cardtrade.normalize_tracking(cs.return_tracking_number) = p_norm
      and cs.id is distinct from p_cash_sale_id
      and (
        cs.status not in ('COMPLETED', 'CANCELLED', 'FAILED', 'REFUNDED')
        or coalesce(cs.completed_at, cs.cancelled_at, cs.updated_at) > now() - interval '90 days'
      )
  )
  or exists (
    -- Either side of any trade other than this one.
    select 1 from cardtrade.trades t
    where (
        cardtrade.normalize_tracking(t.initiator_tracking_number) = p_norm
        or cardtrade.normalize_tracking(t.counterpart_tracking_number) = p_norm
      )
      and t.id is distinct from p_trade_id
      and (
        t.state not in ('COMPLETED', 'CANCELLED', 'FRAUD_RESOLVED')
        or coalesce(t.cancelled_at, t.updated_at) > now() - interval '90 days'
      )
  );
$function$;

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
     and (tg_op = 'INSERT' or v_out is distinct from cardtrade.normalize_tracking(old.tracking_number))
     and cardtrade.tracking_in_use(v_out, new.id, null, new.seller_id, new.buyer_id, false) then
    raise exception 'tracking-in-use' using errcode = 'P0001';
  end if;
  if v_ret is not null
     and (tg_op = 'INSERT' or v_ret is distinct from cardtrade.normalize_tracking(old.return_tracking_number))
     and cardtrade.tracking_in_use(v_ret, new.id, null, null, null, true) then
    raise exception 'tracking-in-use' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

drop trigger if exists cash_sales_tracking_binding on cardtrade.cash_sales;
create trigger cash_sales_tracking_binding
  before insert or update of tracking_number, return_tracking_number on cardtrade.cash_sales
  for each row execute function cardtrade.cash_sales_tracking_binding();

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
     and v_init is distinct from cardtrade.normalize_tracking(old.initiator_tracking_number)
     and (v_init = v_counter or cardtrade.tracking_in_use(v_init, null, new.id, null, null, true)) then
    raise exception 'tracking-in-use' using errcode = 'P0001';
  end if;
  if v_counter is not null
     and v_counter is distinct from cardtrade.normalize_tracking(old.counterpart_tracking_number)
     and (v_counter = v_init or cardtrade.tracking_in_use(v_counter, null, new.id, null, null, true)) then
    raise exception 'tracking-in-use' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

drop trigger if exists trades_tracking_binding on cardtrade.trades;
create trigger trades_tracking_binding
  before update of initiator_tracking_number, counterpart_tracking_number on cardtrade.trades
  for each row execute function cardtrade.trades_tracking_binding();

-- Grants last. Trigger functions and the lookup are not callable by members.
revoke all on function cardtrade.tracking_in_use(text, uuid, uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function cardtrade.cash_sales_tracking_binding() from public, anon, authenticated;
revoke all on function cardtrade.trades_tracking_binding() from public, anon, authenticated;
grant execute on function cardtrade.normalize_tracking(text) to authenticated, service_role;
