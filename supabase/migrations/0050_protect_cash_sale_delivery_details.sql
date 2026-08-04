-- 0050_protect_cash_sale_delivery_details.sql
--
-- Keep a Buyer's residential delivery address out of the Realtime-published
-- cash_sales row. Buyer-only edits and post-collection seller disclosure are
-- enforced in one protected table and one atomic terms RPC (Req 4).

create table cardtrade.cash_sale_delivery_details (
  cash_sale_id uuid primary key references cardtrade.cash_sales(id) on delete cascade,
  buyer_id uuid not null references cardtrade.profiles(id),
  -- New selections are capped at 1,000 characters by update_cash_sale_terms;
  -- this broader limit preserves valid 2,000-character legacy rows while they
  -- remain read-only until the Buyer chooses a provider-resolved replacement.
  address_label text not null check (char_length(btrim(address_label)) between 1 and 2000),
  place_id text not null check (char_length(btrim(place_id)) between 1 and 255),
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  latitude double precision,
  longitude double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cash_sale_delivery_details_coords_check check (
    (latitude is null and longitude is null)
    or (
      latitude between -90 and 90
      and longitude between -180 and 180
    )
  )
);

create index cash_sale_delivery_details_buyer_idx
  on cardtrade.cash_sale_delivery_details (buyer_id);

alter table cardtrade.cash_sale_delivery_details enable row level security;

-- The Buyer may always read their address. The Seller is told only after the
-- platform holds the payment; unfunded negotiations never disclose it.
create policy cash_sale_delivery_details_buyer_select
  on cardtrade.cash_sale_delivery_details for select to authenticated
  using ((select auth.uid()) = buyer_id);

create policy cash_sale_delivery_details_funded_seller_select
  on cardtrade.cash_sale_delivery_details for select to authenticated
  using (
    exists (
      select 1
      from cardtrade.cash_sales s
      where s.id = cash_sale_delivery_details.cash_sale_id
        and s.seller_id = (select auth.uid())
        and s.fulfillment_method = 'DELIVERY'
        and s.status in ('ESCROW_HELD', 'IN_TRANSIT', 'INSPECTION', 'COMPLETED', 'DISPUTED', 'REFUNDED')
    )
  );

revoke all on cardtrade.cash_sale_delivery_details from anon, authenticated;
grant select on cardtrade.cash_sale_delivery_details to authenticated;
grant all on cardtrade.cash_sale_delivery_details to service_role;

-- Existing addresses are retained behind the protected policy. Legacy rows have
-- no verified provider place, so their place id is deliberately marked legacy;
-- the terms editor requires a fresh Geoapify selection before a Buyer can edit.
alter table cardtrade.cash_sales
  add column delivery_address_configured boolean not null default false;

insert into cardtrade.cash_sale_delivery_details (
  cash_sale_id, buyer_id, address_label, place_id, created_at, updated_at
)
select id, buyer_id, delivery_address, 'legacy:' || id::text, created_at, updated_at
from cardtrade.cash_sales
where delivery_address is not null and btrim(delivery_address) <> '';

-- A short-lived parallel migration once used this table. Preserve any rows it
-- left behind, then remove the duplicate so there is one sensitive-address store.
do $$
begin
  if to_regclass('cardtrade.cash_sale_private_terms') is not null then
    insert into cardtrade.cash_sale_delivery_details (
      cash_sale_id, buyer_id, address_label, place_id, created_at, updated_at
    )
    select p.sale_id, s.buyer_id, p.delivery_address, 'legacy:' || p.sale_id::text,
      p.created_at, p.updated_at
    from cardtrade.cash_sale_private_terms p
    join cardtrade.cash_sales s on s.id = p.sale_id
    where p.delivery_address is not null and btrim(p.delivery_address) <> ''
    on conflict (cash_sale_id) do nothing;

    drop table cardtrade.cash_sale_private_terms;
  end if;
end
$$;

update cardtrade.cash_sales s
set delivery_address_configured = exists (
  select 1
  from cardtrade.cash_sale_delivery_details d
  where d.cash_sale_id = s.id
);

-- The old trigger watches delivery_address, so it must be dropped before that
-- legacy column is removed. It is recreated below with every public term field.
drop trigger if exists cash_sales_reset_acceptances on cardtrade.cash_sales;

alter table cardtrade.cash_sales
  drop constraint if exists cash_sales_delivery_address_length,
  drop column delivery_address;

-- Delivery data must never reappear on cash_sales: that table is published to
-- Supabase Realtime. A boolean preserves only the non-sensitive fact that the
-- Buyer completed address selection.
comment on column cardtrade.cash_sales.delivery_address_configured is
  'True when a protected buyer delivery address exists. This flag contains no address data.';
comment on table cardtrade.cash_sale_delivery_details is
  'Protected residential delivery address. Not in the Realtime publication; buyer-only until payment is secured.';

-- Recreate the trigger with every persisted public term, including the resolved
-- F2F place fields and the non-sensitive delivery-address configuration flag.
create trigger cash_sales_reset_acceptances
before update of fulfillment_method, shipping_cost_cents, shipping_notes,
  delivery_address_configured, meeting_location, meeting_lat, meeting_lng,
  meeting_place_id, meeting_at, agreed_price_cents
on cardtrade.cash_sales
for each row execute function cardtrade.reset_cash_sale_acceptances();

/**
 * Atomically update the public handover terms and, when the Buyer supplies a
 * provider-resolved address, its protected counterpart. The service role is the
 * only caller, but the actor and version guards remain in SQL so an accidental
 * call cannot bypass participant ownership or resurrect stale acceptance ticks.
 */
create or replace function cardtrade.update_cash_sale_terms(
  p_cash_sale_id uuid,
  p_actor_id uuid,
  p_expected_terms_version integer,
  p_fulfillment_method cardtrade.handover_method,
  p_shipping_cost_cents bigint,
  p_shipping_notes text,
  p_meeting_location text,
  p_meeting_lat double precision,
  p_meeting_lng double precision,
  p_meeting_place_id text,
  p_meeting_at timestamptz,
  p_delivery_address_label text default null,
  p_delivery_place_id text default null,
  p_delivery_country_code text default null,
  p_delivery_lat double precision default null,
  p_delivery_lng double precision default null
)
returns setof cardtrade.cash_sales
language plpgsql
set search_path = ''
as $$
declare
  v_sale cardtrade.cash_sales%rowtype;
  v_has_delivery_input boolean;
  v_updated cardtrade.cash_sales%rowtype;
begin
  select * into v_sale
  from cardtrade.cash_sales
  where id = p_cash_sale_id
  for update;

  if not found
    or v_sale.status <> 'AGREEMENT'
    or v_sale.terms_version <> p_expected_terms_version
    or p_actor_id not in (v_sale.buyer_id, v_sale.seller_id) then
    return;
  end if;

  if p_fulfillment_method = 'DELIVERY' then
    if p_shipping_cost_cents is null or p_shipping_cost_cents < 0
      or p_meeting_location is not null or p_meeting_lat is not null
      or p_meeting_lng is not null or p_meeting_place_id is not null
      or p_meeting_at is not null then
      return;
    end if;

    v_has_delivery_input := p_delivery_address_label is not null
      or p_delivery_place_id is not null
      or p_delivery_country_code is not null
      or p_delivery_lat is not null
      or p_delivery_lng is not null;

    -- The Seller can propose delivery costs/notes but never write or replace the
    -- Buyer's address. A partial address is rejected instead of being persisted.
    if p_actor_id = v_sale.seller_id and v_has_delivery_input then
      return;
    end if;
    if v_has_delivery_input and (
      p_delivery_address_label is null
      or p_delivery_place_id is null
      or p_delivery_country_code is null
      or p_delivery_lat is null
      or p_delivery_lng is null
      or char_length(btrim(p_delivery_address_label)) not between 1 and 1000
      or char_length(btrim(p_delivery_place_id)) not between 1 and 255
      or p_delivery_place_id like 'text:%'
      or p_delivery_place_id like 'legacy:%'
      or p_delivery_country_code !~ '^[A-Z]{2}$'
      or p_delivery_lat not between -90 and 90
      or p_delivery_lng not between -180 and 180
    ) then
      return;
    end if;

    if v_has_delivery_input then
      insert into cardtrade.cash_sale_delivery_details (
        cash_sale_id, buyer_id, address_label, place_id, country_code,
        latitude, longitude, updated_at
      ) values (
        v_sale.id, v_sale.buyer_id, btrim(p_delivery_address_label),
        btrim(p_delivery_place_id), p_delivery_country_code,
        p_delivery_lat, p_delivery_lng, now()
      )
      on conflict (cash_sale_id) do update
      set buyer_id = excluded.buyer_id,
          address_label = excluded.address_label,
          place_id = excluded.place_id,
          country_code = excluded.country_code,
          latitude = excluded.latitude,
          longitude = excluded.longitude,
          updated_at = now();
    end if;

    update cardtrade.cash_sales
    set fulfillment_method = 'DELIVERY',
        shipping_cost_cents = p_shipping_cost_cents,
        shipping_notes = nullif(btrim(p_shipping_notes), ''),
        delivery_address_configured = case
          when v_has_delivery_input then true
          else v_sale.delivery_address_configured
        end,
        meeting_location = null,
        meeting_lat = null,
        meeting_lng = null,
        meeting_place_id = null,
        meeting_at = null,
        amount_cents = v_sale.agreed_price_cents + v_sale.platform_fee_cents + p_shipping_cost_cents,
        updated_at = now()
    where id = v_sale.id
    returning * into v_updated;
  elsif p_fulfillment_method = 'IN_PERSON' then
    if p_shipping_cost_cents <> 0 or p_shipping_notes is not null
      or p_delivery_address_label is not null or p_delivery_place_id is not null
      or p_delivery_country_code is not null or p_delivery_lat is not null
      or p_delivery_lng is not null
      or p_meeting_location is null or p_meeting_place_id is null or p_meeting_at is null
      or char_length(btrim(p_meeting_location)) not between 1 and 500
      or char_length(btrim(p_meeting_place_id)) not between 1 and 255
      or p_meeting_place_id like 'text:%' or p_meeting_place_id like 'legacy:%'
      or p_meeting_lat is null or p_meeting_lng is null
      or p_meeting_lat not between -90 and 90 or p_meeting_lng not between -180 and 180
      or p_meeting_at <= now() then
      return;
    end if;

    delete from cardtrade.cash_sale_delivery_details where cash_sale_id = v_sale.id;

    update cardtrade.cash_sales
    set fulfillment_method = 'IN_PERSON',
        shipping_cost_cents = 0,
        shipping_notes = null,
        delivery_address_configured = false,
        meeting_location = btrim(p_meeting_location),
        meeting_lat = p_meeting_lat,
        meeting_lng = p_meeting_lng,
        meeting_place_id = btrim(p_meeting_place_id),
        meeting_at = p_meeting_at,
        amount_cents = v_sale.agreed_price_cents + v_sale.platform_fee_cents,
        updated_at = now()
    where id = v_sale.id
    returning * into v_updated;
  else
    return;
  end if;

  return next v_updated;
end;
$$;

revoke all on function cardtrade.update_cash_sale_terms(
  uuid, uuid, integer, cardtrade.handover_method, bigint, text, text,
  double precision, double precision, text, timestamptz, text, text, text,
  double precision, double precision
) from public, anon, authenticated;
grant execute on function cardtrade.update_cash_sale_terms(
  uuid, uuid, integer, cardtrade.handover_method, bigint, text, text,
  double precision, double precision, text, timestamptz, text, text, text,
  double precision, double precision
) to service_role;
