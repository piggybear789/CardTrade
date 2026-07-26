-- CardTrade — 0008_cash_sale_contract.sql
-- Bilateral Cash_Sale agreements, protected fulfillment terms, and audit events.
-- Req 4: Buy reserves the Item; both parties accept one terms version before
-- payment; cleared funds gate shipping/handover; fulfillment completes the sale.

-- Replace the three-value legacy enum while preserving historical rows.
alter type cardtrade.cash_sale_status rename to cash_sale_status_legacy;
create type cardtrade.cash_sale_status as enum (
  'AGREEMENT',
  'PAYMENT_PENDING',
  'ESCROW_HELD',
  'IN_TRANSIT',
  'HANDOVER',
  'INSPECTION',
  'COMPLETED',
  'DISPUTED',
  'CANCELLED',
  'FAILED',
  'REFUNDED'
);

alter table cardtrade.cash_sales alter column status drop default;
alter table cardtrade.cash_sales
  alter column status type cardtrade.cash_sale_status
  using (
    case status::text
      when 'PENDING' then 'PAYMENT_PENDING'
      when 'COMPLETED' then 'COMPLETED'
      else 'FAILED'
    end
  )::cardtrade.cash_sale_status;
alter table cardtrade.cash_sales alter column status set default 'AGREEMENT';
drop type cardtrade.cash_sale_status_legacy;

alter table cardtrade.profiles
  add column payment_source_id text;

comment on column cardtrade.profiles.payment_source_id is
  'Provider-vaulted src_... reference proving a reusable payment source exists; service-role only.';
alter table cardtrade.cash_sales
  add column version integer not null default 1,
  add column agreed_price_cents bigint,
  add column item_title text,
  add column item_description text,
  add column item_condition text,
  add column item_image_paths text[] not null default '{}',
  add column fulfillment_method cardtrade.handover_method,
  add column shipping_cost_cents bigint not null default 0,
  add column shipping_notes text,
  add column delivery_address text,
  add column meeting_location text,
  add column meeting_at timestamptz,
  add column terms_version integer not null default 1,
  add column terms_updated_at timestamptz,
  add column buyer_terms_accepted_version integer,
  add column seller_terms_accepted_version integer,
  add column buyer_terms_accepted_at timestamptz,
  add column seller_terms_accepted_at timestamptz,
  add column payment_nonce text,
  add column payment_requested_at timestamptz,
  add column payment_settled_at timestamptz,
  add column tracking_carrier text,
  add column tracking_number text,
  add column tracking_url text,
  add column tracking_status text,
  add column shipped_at timestamptz,
  add column received_at timestamptz,
  add column inspection_accepted_at timestamptz,
  add column buyer_handover_confirmed_at timestamptz,
  add column seller_handover_confirmed_at timestamptz,
  add column completed_at timestamptz,
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references cardtrade.profiles(id),
  add column cancel_reason text,
  add column disputed_at timestamptz,
  add column disputed_by uuid references cardtrade.profiles(id),
  add column dispute_reason text,
  add column conversation_id uuid references cardtrade.conversations(id);

update cardtrade.cash_sales s
set agreed_price_cents = s.amount_cents - s.platform_fee_cents,
    item_title = i.title,
    item_description = i.description,
    item_condition = i.condition,
    item_image_paths = i.image_paths,
    payment_requested_at = case when s.transfer_id is not null then s.created_at else null end,
    payment_settled_at = case when s.status = 'COMPLETED' then s.updated_at else null end,
    completed_at = case when s.status = 'COMPLETED' then s.updated_at else null end
from cardtrade.items i
where i.id = s.item_id;

alter table cardtrade.cash_sales
  alter column agreed_price_cents set not null,
  alter column item_title set not null,
  add constraint cash_sales_distinct_parties check (buyer_id <> seller_id),
  add constraint cash_sales_agreed_price_positive check (agreed_price_cents > 0),
  add constraint cash_sales_fee_nonnegative check (platform_fee_cents >= 0),
  add constraint cash_sales_amount_components check (
    amount_cents = agreed_price_cents + platform_fee_cents + shipping_cost_cents
  ),
  add constraint cash_sales_shipping_cost_nonnegative check (shipping_cost_cents >= 0),
  add constraint cash_sales_terms_version_positive check (terms_version > 0),
  add constraint cash_sales_version_positive check (version > 0),
  add constraint cash_sales_delivery_address_length check (
    delivery_address is null or char_length(delivery_address) between 1 and 1000
  ),
  add constraint cash_sales_tracking_number_length check (
    tracking_number is null or char_length(tracking_number) between 2 and 120
  ),
  add constraint cash_sales_reason_length check (
    (cancel_reason is null or char_length(cancel_reason) between 1 and 500)
    and (dispute_reason is null or char_length(dispute_reason) between 1 and 1000)
  );

create unique index cash_sales_payment_nonce_key
  on cardtrade.cash_sales (payment_nonce)
  where payment_nonce is not null;

create unique index cash_sales_one_active_per_item
  on cardtrade.cash_sales (item_id)
  where status in (
    'AGREEMENT','PAYMENT_PENDING','ESCROW_HELD','IN_TRANSIT',
    'HANDOVER','INSPECTION','DISPUTED'
  );

create index cash_sales_buyer_idx on cardtrade.cash_sales (buyer_id, updated_at desc);
create index cash_sales_seller_idx on cardtrade.cash_sales (seller_id, updated_at desc);
create table cardtrade.cash_sale_events (
  id uuid primary key default gen_random_uuid(),
  cash_sale_id uuid not null references cardtrade.cash_sales(id) on delete cascade,
  actor_id uuid references cardtrade.profiles(id),
  event text not null check (char_length(event) between 1 and 80),
  from_status cardtrade.cash_sale_status,
  to_status cardtrade.cash_sale_status,
  detail text check (detail is null or char_length(detail) <= 1000),
  created_at timestamptz not null default now()
);

create index cash_sale_events_sale_idx
  on cardtrade.cash_sale_events (cash_sale_id, created_at);

alter table cardtrade.cash_sale_events enable row level security;

create policy cash_sale_events_participant_select
  on cardtrade.cash_sale_events for select to authenticated
  using (
    exists (
      select 1
      from cardtrade.cash_sales s
      where s.id = cash_sale_events.cash_sale_id
        and ((select auth.uid()) = s.buyer_id or (select auth.uid()) = s.seller_id)
    )
  );

drop policy if exists cash_sales_participant_select on cardtrade.cash_sales;
create policy cash_sales_participant_select
  on cardtrade.cash_sales for select to authenticated
  using (
    (select auth.uid()) is not null
    and ((select auth.uid()) = buyer_id or (select auth.uid()) = seller_id)
  );

revoke all on cardtrade.cash_sale_events from anon, authenticated;
grant select on cardtrade.cash_sale_events to authenticated;
grant all on cardtrade.cash_sale_events to service_role;

-- A substantive terms edit is legal only before payment and invalidates both
-- acceptances. The database owns the version bump so concurrent edits cannot
-- preserve stale ticks.
create or replace function cardtrade.reset_cash_sale_acceptances()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'AGREEMENT' then
    raise exception 'Cash-sale terms are locked after payment starts';
  end if;

  new.terms_version := old.terms_version + 1;
  new.version := old.version + 1;
  new.terms_updated_at := now();
  new.buyer_terms_accepted_version := null;
  new.seller_terms_accepted_version := null;
  new.buyer_terms_accepted_at := null;
  new.seller_terms_accepted_at := null;
  return new;
end;
$$;

create trigger cash_sales_reset_acceptances
before update of fulfillment_method, shipping_cost_cents, shipping_notes,
  delivery_address, meeting_location, meeting_at
on cardtrade.cash_sales
for each row execute function cardtrade.reset_cash_sale_acceptances();
-- Reserve an Item, create/reuse its participant conversation, and create the
-- agreement in one transaction. Only trusted server code may call this RPC.
create or replace function cardtrade.create_cash_sale_agreement(
  p_item_id uuid,
  p_buyer_id uuid,
  p_agreed_price_cents bigint,
  p_platform_fee_cents bigint,
  p_seller_identity_version text,
  p_seller_legal_entity_name text,
  p_seller_trading_name text,
  p_seller_registration_number text,
  p_seller_organisation_type text,
  p_seller_identity_verified_at timestamptz,
  p_buyer_identity_confirmed_at timestamptz
)
returns setof cardtrade.cash_sales
language plpgsql
set search_path = ''
as $$
declare
  v_item cardtrade.items%rowtype;
  v_sale cardtrade.cash_sales%rowtype;
  v_conversation_id uuid;
  v_a uuid;
  v_b uuid;
begin
  select * into v_item
  from cardtrade.items
  where id = p_item_id
  for update;

  if not found or v_item.status <> 'AVAILABLE' then
    return;
  end if;
  if v_item.owner_id = p_buyer_id then
    raise exception 'A seller cannot buy their own item';
  end if;

  if p_buyer_id::text < v_item.owner_id::text then
    v_a := p_buyer_id;
    v_b := v_item.owner_id;
  else
    v_a := v_item.owner_id;
    v_b := p_buyer_id;
  end if;

  select id into v_conversation_id
  from cardtrade.conversations
  where item_id = p_item_id
    and participant_a = v_a
    and participant_b = v_b
  limit 1;

  if v_conversation_id is null then
    begin
      insert into cardtrade.conversations (item_id, participant_a, participant_b)
      values (p_item_id, v_a, v_b)
      returning id into v_conversation_id;
    exception when unique_violation then
      select id into v_conversation_id
      from cardtrade.conversations
      where item_id = p_item_id
        and participant_a = v_a
        and participant_b = v_b
      limit 1;
    end;
  end if;

  update cardtrade.items
  set status = 'RESERVED', updated_at = now()
  where id = p_item_id;

  insert into cardtrade.cash_sales (
    item_id, buyer_id, seller_id, agreed_price_cents, amount_cents,
    platform_fee_cents, status, item_title, item_description, item_condition,
    item_image_paths, seller_identity_version, seller_legal_entity_name,
    seller_trading_name, seller_registration_number, seller_organisation_type,
    seller_identity_verified_at, buyer_seller_identity_confirmed_at,
    conversation_id
  ) values (
    p_item_id, p_buyer_id, v_item.owner_id, p_agreed_price_cents,
    p_agreed_price_cents + p_platform_fee_cents, p_platform_fee_cents,
    'AGREEMENT', v_item.title, v_item.description, v_item.condition,
    v_item.image_paths, p_seller_identity_version, p_seller_legal_entity_name,
    p_seller_trading_name, p_seller_registration_number,
    p_seller_organisation_type, p_seller_identity_verified_at,
    p_buyer_identity_confirmed_at, v_conversation_id
  ) returning * into v_sale;

  insert into cardtrade.cash_sale_events (
    cash_sale_id, actor_id, event, to_status, detail
  ) values (
    v_sale.id, p_buyer_id, 'AGREEMENT_CREATED', 'AGREEMENT',
    'Item reserved; no payment collected.'
  );

  return next v_sale;
end;
$$;

revoke all on function cardtrade.create_cash_sale_agreement(
  uuid, uuid, bigint, bigint, text, text, text, text, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function cardtrade.create_cash_sale_agreement(
  uuid, uuid, bigint, bigint, text, text, text, text, text, timestamptz, timestamptz
) to service_role;
-- Provider-controlled payment fields stay service-role only.
revoke update on cardtrade.profiles from authenticated;
revoke update on cardtrade.profiles from anon;
grant update (display_name, contact_email) on cardtrade.profiles to authenticated;

alter table cardtrade.cash_sales replica identity full;
alter table cardtrade.cash_sale_events replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'cardtrade'
      and tablename = 'cash_sales'
  ) then
    alter publication supabase_realtime add table cardtrade.cash_sales;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'cardtrade'
      and tablename = 'cash_sale_events'
  ) then
    alter publication supabase_realtime add table cardtrade.cash_sale_events;
  end if;
end
$$;

comment on column cardtrade.cash_sales.delivery_address is
  'Participant-only Buyer delivery address. Never expose in catalog/public profile queries.';
comment on column cardtrade.cash_sales.payment_nonce is
  'Persisted before provider submission and reused for every retry.';
comment on column cardtrade.cash_sales.status is
  'Application contract state. ESCROW_HELD means CardTrade collected funds pending fulfillment; it is not a representation of regulated escrow.';
