-- CardTrade — 0008_bilateral_cash_sales.sql
-- Bilateral Cash_Sale agreement, funding, fulfillment, and dispute lifecycle.
-- All money is integer AUD cents. ESCROW_HELD is an internal payment-protection
-- state only; it does not represent regulated escrow, a trust, or custody.

-- New enum labels must be committed before PostgreSQL permits their use by the
-- backfill and new defaults later in this migration.
alter type cardtrade.cash_sale_status add value if not exists 'AGREEMENT';
alter type cardtrade.cash_sale_status add value if not exists 'PAYMENT_PENDING';
alter type cardtrade.cash_sale_status add value if not exists 'ESCROW_HELD';
alter type cardtrade.cash_sale_status add value if not exists 'IN_TRANSIT';
alter type cardtrade.cash_sale_status add value if not exists 'HANDOVER';
alter type cardtrade.cash_sale_status add value if not exists 'INSPECTION';
alter type cardtrade.cash_sale_status add value if not exists 'DISPUTED';
alter type cardtrade.cash_sale_status add value if not exists 'CANCELLED';
alter type cardtrade.cash_sale_status add value if not exists 'REFUNDED';

commit;

comment on type cardtrade.cash_sale_status is
  'Cash-sale lifecycle. ESCROW_HELD means internal Pinch payment protection, not regulated escrow.';

alter table cardtrade.cash_sales
  add column if not exists item_price_cents bigint,
  add column if not exists terms_version integer not null default 1,
  add column if not exists fulfillment_method text,
  add column if not exists shipping_cost_cents bigint not null default 0,
  add column if not exists shipping_details text,
  add column if not exists meeting_location text,
  add column if not exists meeting_at timestamptz,
  add column if not exists buyer_accepted_version integer,
  add column if not exists seller_accepted_version integer,
  add column if not exists buyer_accepted_terms_at timestamptz,
  add column if not exists seller_accepted_terms_at timestamptz,
  add column if not exists conversation_id uuid,
  add column if not exists payment_nonce text default gen_random_uuid()::text,
  add column if not exists tracking_carrier text,
  add column if not exists tracking_number text,
  add column if not exists tracking_status text,
  add column if not exists shipped_at timestamptz,
  add column if not exists buyer_received_at timestamptz,
  add column if not exists inspection_started_at timestamptz,
  add column if not exists buyer_accepted_at timestamptz,
  add column if not exists buyer_handover_confirmed_at timestamptz,
  add column if not exists seller_handover_confirmed_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid,
  add column if not exists cancelled_reason text,
  add column if not exists disputed_at timestamptz,
  add column if not exists disputed_by uuid,
  add column if not exists disputed_reason text,
  add column if not exists refunded_at timestamptz;

-- Legacy immediate-payment sales had already passed buyer intent and payment
-- initiation. Preserve that fact as mutual acceptance of version 1.
update cardtrade.cash_sales
set item_price_cents = amount_cents - platform_fee_cents
where item_price_cents is null;

update cardtrade.cash_sales
set status = 'PAYMENT_PENDING'
where status = 'PENDING';

update cardtrade.cash_sales
set buyer_accepted_version = coalesce(buyer_accepted_version, terms_version),
    seller_accepted_version = coalesce(seller_accepted_version, terms_version),
    buyer_accepted_terms_at = coalesce(buyer_accepted_terms_at, created_at),
    seller_accepted_terms_at = coalesce(seller_accepted_terms_at, created_at),
    completed_at = case
      when status = 'COMPLETED' then coalesce(completed_at, updated_at)
      else completed_at
    end,
    payment_nonce = coalesce(payment_nonce, gen_random_uuid()::text)
where status in ('PAYMENT_PENDING', 'COMPLETED', 'FAILED');

alter table cardtrade.cash_sales
  alter column status set default 'AGREEMENT',
  alter column item_price_cents set not null,
  alter column payment_nonce set not null;

create unique index if not exists cash_sales_payment_nonce_key
  on cardtrade.cash_sales (payment_nonce);
create index if not exists cash_sales_buyer_idx
  on cardtrade.cash_sales (buyer_id, created_at desc);
create index if not exists cash_sales_seller_idx
  on cardtrade.cash_sales (seller_id, created_at desc);
create index if not exists cash_sales_status_idx
  on cardtrade.cash_sales (status);
create index if not exists cash_sales_conversation_idx
  on cardtrade.cash_sales (conversation_id)
  where conversation_id is not null;

-- Add named constraints defensively so this migration can be replayed against a
-- database where some remote changes were already applied.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'cardtrade.cash_sales'::regclass
      and conname = 'cash_sales_fulfillment_method_check'
  ) then
    alter table cardtrade.cash_sales add constraint cash_sales_fulfillment_method_check
      check (fulfillment_method is null or fulfillment_method in ('SHIPPING', 'FACE_TO_FACE'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'cardtrade.cash_sales'::regclass
      and conname = 'cash_sales_money_check'
  ) then
    alter table cardtrade.cash_sales add constraint cash_sales_money_check
      check (
        item_price_cents >= 0
        and platform_fee_cents >= 0
        and shipping_cost_cents >= 0
        and amount_cents = item_price_cents + platform_fee_cents + shipping_cost_cents
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'cardtrade.cash_sales'::regclass
      and conname = 'cash_sales_terms_version_check'
  ) then
    alter table cardtrade.cash_sales add constraint cash_sales_terms_version_check
      check (
        terms_version >= 1
        and (buyer_accepted_version is null or buyer_accepted_version between 1 and terms_version)
        and (seller_accepted_version is null or seller_accepted_version between 1 and terms_version)
        and ((buyer_accepted_version is null) = (buyer_accepted_terms_at is null))
        and ((seller_accepted_version is null) = (seller_accepted_terms_at is null))
      );
  end if;
end
$$;

-- Foreign keys are named and guarded because the remote schema already contains
-- conversations while older local migration snapshots may have been replayed.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'cardtrade.cash_sales'::regclass
      and conname = 'cash_sales_conversation_id_fkey'
  ) then
    alter table cardtrade.cash_sales add constraint cash_sales_conversation_id_fkey
      foreign key (conversation_id) references cardtrade.conversations(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'cardtrade.cash_sales'::regclass
      and conname = 'cash_sales_cancelled_by_fkey'
  ) then
    alter table cardtrade.cash_sales add constraint cash_sales_cancelled_by_fkey
      foreign key (cancelled_by) references cardtrade.profiles(id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'cardtrade.cash_sales'::regclass
      and conname = 'cash_sales_disputed_by_fkey'
  ) then
    alter table cardtrade.cash_sales add constraint cash_sales_disputed_by_fkey
      foreign key (disputed_by) references cardtrade.profiles(id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'cardtrade.cash_sales'::regclass
      and conname = 'cash_sales_participants_distinct_check'
  ) then
    alter table cardtrade.cash_sales add constraint cash_sales_participants_distinct_check
      check (buyer_id <> seller_id);
  end if;
end
$$;

create table if not exists cardtrade.cash_sale_private_terms (
  sale_id uuid primary key references cardtrade.cash_sales(id) on delete cascade,
  delivery_address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cash_sale_private_terms_address_check
    check (delivery_address is null or char_length(btrim(delivery_address)) between 1 and 2000)
);

comment on table cardtrade.cash_sale_private_terms is
  'Private fulfillment data. Buyer-readable always; Seller-readable only after payment protection is secured.';
comment on column cardtrade.cash_sale_private_terms.delivery_address is
  'Private Buyer delivery address; never copy this value into public sale events.';

create table if not exists cardtrade.cash_sale_events (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references cardtrade.cash_sales(id) on delete cascade,
  actor_id uuid references cardtrade.profiles(id),
  event text not null,
  from_status text,
  to_status text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table cardtrade.cash_sale_events is
  'Append-only service-role audit stream for bilateral Cash_Sale lifecycle changes.';

create index if not exists cash_sale_events_sale_created_idx
  on cardtrade.cash_sale_events (sale_id, created_at, id);

alter table cardtrade.cash_sales enable row level security;
alter table cardtrade.cash_sale_private_terms enable row level security;
alter table cardtrade.cash_sale_events enable row level security;

-- Participants may read the aggregate, but no end-user write policy is created;
-- all lifecycle mutations remain service-role-only.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'cardtrade'
      and tablename = 'cash_sales'
      and policyname = 'cash_sales_participant_select'
  ) then
    create policy cash_sales_participant_select on cardtrade.cash_sales
      for select to authenticated
      using (auth.uid() = buyer_id or auth.uid() = seller_id);
  end if;
end
$$;

-- The Buyer can always retrieve their own address. The Seller gains access only
-- once funds are secured and retains it through post-funding resolution states.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'cardtrade'
      and tablename = 'cash_sale_private_terms'
      and policyname = 'cash_sale_private_terms_participant_select'
  ) then
    create policy cash_sale_private_terms_participant_select
      on cardtrade.cash_sale_private_terms
      for select to authenticated
      using (
        exists (
          select 1
          from cardtrade.cash_sales sale
          where sale.id = sale_id
            and (
              sale.buyer_id = auth.uid()
              or (
                sale.seller_id = auth.uid()
                and sale.status in (
                  'ESCROW_HELD', 'IN_TRANSIT', 'HANDOVER', 'INSPECTION',
                  'DISPUTED', 'COMPLETED', 'REFUNDED'
                )
              )
            )
        )
      );
  end if;
end
$$;

-- Cross-field lifecycle checks prevent payment without bilateral acceptance and
-- prevent shipment/handover evidence from appearing before protected funding.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'cardtrade.cash_sales'::regclass
      and conname = 'cash_sales_funded_acceptance_check'
  ) then
    alter table cardtrade.cash_sales add constraint cash_sales_funded_acceptance_check
      check (
        status not in (
          'PAYMENT_PENDING', 'ESCROW_HELD', 'IN_TRANSIT', 'HANDOVER',
          'INSPECTION', 'DISPUTED', 'COMPLETED', 'REFUNDED', 'FAILED'
        )
        or (
          buyer_accepted_version = terms_version
          and seller_accepted_version = terms_version
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'cardtrade.cash_sales'::regclass
      and conname = 'cash_sales_shipping_evidence_check'
  ) then
    alter table cardtrade.cash_sales add constraint cash_sales_shipping_evidence_check
      check (
        shipped_at is null
        or (
          fulfillment_method = 'SHIPPING'
          and nullif(btrim(tracking_carrier), '') is not null
          and nullif(btrim(tracking_number), '') is not null
          and status in ('IN_TRANSIT', 'INSPECTION', 'DISPUTED', 'COMPLETED', 'REFUNDED')
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'cardtrade.cash_sales'::regclass
      and conname = 'cash_sales_receipt_inspection_check'
  ) then
    alter table cardtrade.cash_sales add constraint cash_sales_receipt_inspection_check
      check (
        (buyer_received_at is null or (shipped_at is not null and buyer_received_at >= shipped_at))
        and (inspection_started_at is null or (
          buyer_received_at is not null and inspection_started_at >= buyer_received_at
        ))
        and (buyer_accepted_at is null or (
          inspection_started_at is not null and buyer_accepted_at >= inspection_started_at
        ))
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'cardtrade.cash_sales'::regclass
      and conname = 'cash_sales_handover_evidence_check'
  ) then
    alter table cardtrade.cash_sales add constraint cash_sales_handover_evidence_check
      check (
        (buyer_handover_confirmed_at is null and seller_handover_confirmed_at is null)
        or (
          fulfillment_method = 'FACE_TO_FACE'
          and status in ('HANDOVER', 'DISPUTED', 'COMPLETED', 'REFUNDED')
        )
      );
  end if;
end
$$;

-- Participant-only event reads; events remain append-only to end users because
-- no INSERT, UPDATE, or DELETE policy exists.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'cardtrade'
      and tablename = 'cash_sale_events'
      and policyname = 'cash_sale_events_participant_select'
  ) then
    create policy cash_sale_events_participant_select
      on cardtrade.cash_sale_events
      for select to authenticated
      using (
        exists (
          select 1
          from cardtrade.cash_sales sale
          where sale.id = sale_id
            and (sale.buyer_id = auth.uid() or sale.seller_id = auth.uid())
        )
      );
  end if;
end
$$;

-- Reinforce service-role-only writes even if broad schema default privileges are
-- present. Authenticated participants retain SELECT through RLS.
revoke insert, update, delete on cardtrade.cash_sales from anon, authenticated;
revoke insert, update, delete on cardtrade.cash_sale_private_terms from anon, authenticated;
revoke insert, update, delete on cardtrade.cash_sale_events from anon, authenticated;
grant select on cardtrade.cash_sales to authenticated;
grant select on cardtrade.cash_sale_private_terms to authenticated;
grant select on cardtrade.cash_sale_events to authenticated;

comment on column cardtrade.cash_sales.status is
  'ESCROW_HELD is an internal Pinch payment-protection state, not regulated escrow.';
comment on column cardtrade.cash_sales.payment_nonce is
  'Unique server-generated idempotency nonce persisted before payment submission.';
comment on column cardtrade.cash_sales.conversation_id is
  'Participant conversation used to negotiate the current versioned terms.';

-- Realtime publication membership is guarded and explicitly targets the
-- cardtrade schema. Full row identity provides complete update payloads.
do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;
end
$$;

alter table cardtrade.cash_sales replica identity full;
alter table cardtrade.cash_sale_events replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'cardtrade'
      and tablename = 'cash_sales'
  ) then
    alter publication supabase_realtime add table cardtrade.cash_sales;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'cardtrade'
      and tablename = 'cash_sale_events'
  ) then
    alter publication supabase_realtime add table cardtrade.cash_sale_events;
  end if;
end
$$;
