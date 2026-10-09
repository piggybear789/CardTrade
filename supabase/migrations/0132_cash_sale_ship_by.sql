-- 0132_cash_sale_ship_by.sql
--
-- A ship-by date for posted cash sales.
--
-- A buyer's payment is held from the moment they pay, and nothing told the seller when
-- the parcel had to go: trades had a dispatch deadline (0039), sales had none. The
-- seller now has THREE BUSINESS DAYS from payment being held, shown on their step.
--
-- MISSING IT CANCELS NOTHING. The hourly sweep warns the seller a day ahead, and when
-- the date passes it stamps `ship_lapsed_at`, notifies both sides and puts the sale in
-- the staff case queue. A person decides what happens next; an unattended timer
-- refunding a sale whose parcel is already at the post office would be worse than a
-- late one. Recording the shipment moves the sale out of ESCROW_HELD, which takes it
-- out of the queue on its own.
--
-- BUSINESS DAYS IN SYDNEY TIME. Weekends are skipped on the Australian calendar, where
-- the platform launched and prices in AUD. Public holidays are not modelled; the date
-- is a target the seller sees, and the sweep only ever flags.

alter table cardtrade.cash_sales
  add column if not exists ship_by_at timestamptz,
  add column if not exists ship_warned_at timestamptz,
  add column if not exists ship_lapsed_at timestamptz;

comment on column cardtrade.cash_sales.ship_by_at is
  'When a posted sale must be shipped by: three business days after payment is held (0132).';
comment on column cardtrade.cash_sales.ship_warned_at is
  'When the seller was warned the ship-by date is a day away (0132). De-duplicates the warning.';
comment on column cardtrade.cash_sales.ship_lapsed_at is
  'When the sweep found the ship-by date passed unshipped and flagged the sale for staff (0132).';

create index if not exists cash_sales_ship_by_idx
  on cardtrade.cash_sales (ship_by_at)
  where status = 'ESCROW_HELD' and ship_by_at is not null;

create or replace function cardtrade.add_business_days(p_from timestamptz, p_days integer)
returns timestamptz
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  v_at timestamptz := p_from;
  v_left integer := greatest(coalesce(p_days, 0), 0);
begin
  while v_left > 0 loop
    v_at := v_at + interval '1 day';
    if extract(isodow from (v_at at time zone 'Australia/Sydney')) < 6 then
      v_left := v_left - 1;
    end if;
  end loop;
  return v_at;
end;
$$;

create or replace function cardtrade.set_cash_sale_ship_by()
returns trigger
language plpgsql
set search_path = cardtrade, pg_catalog
as $$
begin
  if new.status = 'ESCROW_HELD'
     and old.status is distinct from 'ESCROW_HELD'
     and new.fulfillment_method = 'DELIVERY'
     and new.ship_by_at is null then
    new.ship_by_at := cardtrade.add_business_days(now(), 3);
  end if;
  return new;
end;
$$;

drop trigger if exists cash_sales_set_ship_by on cardtrade.cash_sales;
create trigger cash_sales_set_ship_by
  before update of status on cardtrade.cash_sales
  for each row execute function cardtrade.set_cash_sale_ship_by();

-- Readable by the parties, like every other cash sale column they see in the room.
grant select (ship_by_at, ship_warned_at, ship_lapsed_at) on cardtrade.cash_sales to authenticated;
