-- 0088_return_conditional_refunds.sql
--
-- Return-conditional refunds. See `.kiro/specs/return-refunds/requirements.md`.
--
-- THE DEFECT THIS FIXES. A `REFUND_BUYER` dispute outcome refunded the Buyer in full
-- and returned the Item to the catalog, while nothing asked the Buyer to send the
-- goods back and no return was tracked. For the commonest reason a full refund is
-- awarded — "it arrived and is not what was agreed" — the Buyer kept both the item and
-- the money, and the Seller was handed a live listing for goods they no longer held.
--
-- ORDERING: GOODS FIRST, THEN MONEY. The platform already holds Cash_Sale proceeds, so
-- requiring the return before releasing the refund costs the Buyer nothing they have
-- not already accepted — their money is frozen either way. eBay/PayPal sequence the
-- other way because THERE the seller may already have been paid and a refund is a
-- clawback; that constraint does not apply here and their ordering should not be copied
-- without noticing it. The Buyer's protection is that the refund releases AUTOMATICALLY
-- on carrier-confirmed delivery, so the Seller cannot sit on it.
--
-- ENUM VALUES ARE ADDED IN 0088a, SEPARATELY. Postgres refuses to use a new enum value
-- in the same transaction that added it, so the two statements cannot share a migration
-- run. 0088a must be applied first.

-- ---------------------------------------------------------------------------
-- Seller return address
-- ---------------------------------------------------------------------------
--
-- A SIBLING TABLE, not a `party` column on `cash_sale_delivery_details`. That table is
-- `primary key (cash_sale_id)` — one row per sale, hard-enforced — so holding a second
-- address there means dropping and recreating the primary key of a table the entire buy
-- path depends on. The two addresses are also genuinely different things: the Buyer's
-- delivery address is captured at terms and disclosed once funds are held; the Seller's
-- return address is captured at dispute resolution and disclosed only while a return is
-- owed. Different writer, different lifecycle, different disclosure timing.
create table if not exists cardtrade.cash_sale_return_details (
  cash_sale_id uuid primary key references cardtrade.cash_sales(id) on delete cascade,
  -- Denormalised so RLS can check ownership without joining `cash_sales`.
  seller_id uuid not null references cardtrade.profiles(id),
  address_label text not null,
  place_id text,
  country_code text,
  latitude double precision,
  longitude double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Same shape checks as the outbound address, so one leg cannot accept an address the
  -- other would refuse.
  constraint cash_sale_return_details_address_label_check
    check (char_length(btrim(address_label)) between 1 and 2000),
  constraint cash_sale_return_details_place_id_check
    check (place_id is null or char_length(btrim(place_id)) between 1 and 255),
  constraint cash_sale_return_details_country_code_check
    check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  constraint cash_sale_return_details_coords_check
    check (
      (latitude is null and longitude is null)
      or (latitude between -90 and 90 and longitude between -180 and 180)
    )
);

comment on table cardtrade.cash_sale_return_details is
  'Seller address a disputed Cash_Sale is returned to. Readable by the buyer only while a return is owed.';

alter table cardtrade.cash_sale_return_details enable row level security;

-- The Seller owns the row. SELECT/INSERT/UPDATE only, and deliberately NOT DELETE:
-- removing the address mid-return would strip the Buyer of the place they are meant to
-- post to. Correcting a typo is an UPDATE.
--
-- Written as three explicit policies rather than `for all`, so the policy set matches
-- the grant set exactly — `for all` implies a DELETE policy, and a policy with no grant
-- behind it is a feature that looks enabled and silently is not. The RLS test in
-- `tests/database/policies.test.ts` fails on precisely that mismatch.
create policy cash_sale_return_details_seller_select
  on cardtrade.cash_sale_return_details
  for select
  using ((select auth.uid()) = seller_id);

create policy cash_sale_return_details_seller_insert
  on cardtrade.cash_sale_return_details
  for insert
  with check ((select auth.uid()) = seller_id);

create policy cash_sale_return_details_seller_update
  on cardtrade.cash_sale_return_details
  for update
  using ((select auth.uid()) = seller_id)
  with check ((select auth.uid()) = seller_id);

-- DISCLOSURE TIMING IS THE WHOLE PROTECTION. This is the first time a Seller's physical
-- address enters the system, so the Buyer may read it ONLY while a return is actually
-- owed — not before a dispute, and not after the sale closed. Mirrors how 0057/0050
-- gate the Buyer's address behind funds being held.
create policy cash_sale_return_details_returning_buyer_select
  on cardtrade.cash_sale_return_details
  for select
  using (
    exists (
      select 1 from cardtrade.cash_sales cs
      where cs.id = cash_sale_return_details.cash_sale_id
        and cs.buyer_id = (select auth.uid())
        and cs.status in ('RETURN_PENDING', 'RETURN_IN_TRANSIT')
    )
  );

-- A banned account reaches nothing.
--
-- `AS RESTRICTIVE` IS LOAD-BEARING, not stylistic. Postgres OR-combines PERMISSIVE
-- policies, so a permissive `not is_fraud_banned()` would ADD an access path for
-- everyone who is not banned rather than removing one for those who are — the opposite
-- of the intent. RESTRICTIVE is AND-ed with the rest, which is what makes it a deny.
-- Every other table in this schema declares it this way, and the RLS test asserts it.
--
-- `is_fraud_banned()` takes no argument; it reads `auth.uid()` itself.
create policy fraud_banned_no_access
  on cardtrade.cash_sale_return_details
  as restrictive
  for all
  using (not cardtrade.is_fraud_banned());

grant select, insert, update on cardtrade.cash_sale_return_details to authenticated;

-- ---------------------------------------------------------------------------
-- Return shipment leg + deadline
-- ---------------------------------------------------------------------------
--
-- A SEPARATE COLUMN SET, deliberately. `cash_sales` had ONE set of tracking columns and
-- a return is a second leg; reusing them would overwrite the outbound delivery record
-- that the original inspection — and any arbitration — depends on. Arbitration needs to
-- read both legs.
alter table cardtrade.cash_sales
  add column if not exists return_tracking_carrier text,
  add column if not exists return_tracking_number text,
  add column if not exists return_tracking_status text,
  add column if not exists return_tracking_url text,
  add column if not exists return_carrier_delivered_at timestamptz,
  add column if not exists return_shipped_at timestamptz,
  -- When the Buyer must have handed the parcel to a carrier by. Deliberately a
  -- DISPATCH deadline, not an arrival deadline: the Buyer controls the former and
  -- cannot control the latter.
  add column if not exists return_deadline_at timestamptz,
  add column if not exists return_warned_at timestamptz,
  -- Set when the Seller contests the return (arrived empty, damaged, never came).
  -- Freezes the automatic refund and sends the case back to arbitration.
  add column if not exists return_disputed_at timestamptz,
  add column if not exists return_dispute_reason text;

comment on column cardtrade.cash_sales.return_deadline_at is
  'When the buyer must have DISPATCHED the return by. Lapsing sends the case to arbitration, never an automatic release.';
comment on column cardtrade.cash_sales.return_carrier_delivered_at is
  'Carrier-confirmed delivery of the RETURN to the seller. Only a carrier sets this; it releases the refund.';

-- Finding lapsed returns is a scheduled scan, so it gets an index like the inspection
-- sweep's.
create index if not exists cash_sales_return_deadline_idx
  on cardtrade.cash_sales (return_deadline_at)
  where return_deadline_at is not null;

-- ---------------------------------------------------------------------------
-- Apply carrier tracking to the RETURN leg
-- ---------------------------------------------------------------------------
--
-- Mirrors `apply_cash_sale_tracking`, with the same central rule: a DELIVERED status is
-- the ONLY thing that sets a carrier-confirmed timestamp, and a party's assertion never
-- is. Unlike the outbound version this does NOT start a clock — it queues the refund,
-- which is the terminal money movement for this outcome.
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

  -- Only meaningful while a return is owed. A late carrier event on a closed sale is
  -- recorded nowhere rather than reopening it.
  if v_sale.status not in ('RETURN_PENDING', 'RETURN_IN_TRANSIT') then
    return next v_sale; return;
  end if;

  if p_tracking_status <> 'DELIVERED' then
    update cardtrade.cash_sales
    set return_tracking_status = p_tracking_status, updated_at = now()
    where id = p_cash_sale_id returning * into v_sale;
    return next v_sale; return;
  end if;

  -- MONOTONIC: a second delivery event must not re-queue a refund that already went.
  if v_sale.return_carrier_delivered_at is not null then
    return next v_sale; return;
  end if;

  v_delivered_at := coalesce(p_delivered_at, now());

  update cardtrade.cash_sales
  set return_tracking_status = 'DELIVERED',
      return_carrier_delivered_at = v_delivered_at,
      updated_at = now()
  where id = p_cash_sale_id returning * into v_sale;

  insert into cardtrade.cash_sale_events
    (cash_sale_id, actor_id, event, from_status, to_status, detail)
  values
    (p_cash_sale_id, null, 'RETURN_DELIVERED', v_sale.status, v_sale.status,
     'Carrier confirmed the return reached the seller. The refund is queued.');

  -- The Seller contesting the return freezes the automatic refund; the case is back
  -- with an operator and must not self-resolve.
  if v_sale.return_disputed_at is null then
    perform cardtrade.mark_cash_sale_refund_due(p_cash_sale_id, v_sale.amount_cents);
  end if;

  select * into v_sale from cardtrade.cash_sales where id = p_cash_sale_id;
  return next v_sale;
end;
$$;

revoke all on function cardtrade.apply_cash_sale_return_tracking(uuid, text, timestamptz) from public;
