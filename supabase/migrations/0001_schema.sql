-- CardTrade — 0001_schema.sql
-- Enums and tables for the CardTrade MVP.
-- All monetary values are stored as integer AUD cents (bigint) to avoid
-- floating-point drift; the UI formats to AUD. Timestamps are timestamptz.
--
-- Ordering: enums are created first, then tables in dependency order
-- (profiles -> items -> trades -> cash_sales / pre_auth_holds /
-- trade_state_transitions / webhook_logs) so every referenced type and
-- table exists before its dependents.
--
-- RLS policies (0002_rls.sql), realtime + seed (0003), and generated types
-- are intentionally NOT part of this migration.

-- =============================================================================
-- Enumerated Types
-- =============================================================================

create type kyc_status       as enum ('UNVERIFIED','PENDING','VERIFIED','REJECTED');
create type item_status      as enum ('AVAILABLE','RESERVED','SOLD');
create type trade_state      as enum ('COLLATERAL_PENDING','COLLATERAL_LOCKED','IN_TRANSIT','INSPECTION','COMPLETED','DISPUTED','FRAUD_RESOLVED');
create type cash_sale_status as enum ('PENDING','COMPLETED','FAILED');
create type hold_status      as enum ('ACTIVE','VOIDED','PARTIALLY_CAPTURED','FULLY_CAPTURED','FAILED');
create type webhook_outcome  as enum ('SUCCESS','FAILURE','NO_OP');

-- =============================================================================
-- Tables
-- =============================================================================

-- Profiles (1:1 with auth.users)
create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 255),
  contact_email text not null,
  kyc_status    kyc_status not null default 'UNVERIFIED',
  kyc_reason    text,                      -- failure reason (Req 2.3)
  payer_id      text,                      -- Pinch/Mock payer reference (Req 2.1)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Items
create table items (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references profiles(id) on delete cascade,
  title         text not null check (char_length(title) between 1 and 120),
  description   text not null check (char_length(description) between 1 and 2000),
  category      text not null,
  condition     text not null,
  fmv_cents     bigint not null check (fmv_cents between 1 and 99999999999), -- 0.01 .. 999,999,999.99
  status        item_status not null default 'AVAILABLE',
  image_paths   text[] not null check (array_length(image_paths, 1) between 1 and 10),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Trades (the aggregate root for the state machine)
create table trades (
  id                    uuid primary key default gen_random_uuid(),
  initiator_id          uuid not null references profiles(id),
  counterpart_id        uuid not null references profiles(id),
  initiator_item_id     uuid not null references items(id),
  counterpart_item_id   uuid not null references items(id),
  state                 trade_state not null default 'COLLATERAL_PENDING',
  version               integer not null default 0,     -- optimistic concurrency (Req 9.3)
  -- lifecycle flags (Req 6)
  initiator_shipped_at    timestamptz,
  counterpart_shipped_at  timestamptz,
  initiator_received_at   timestamptz,
  counterpart_received_at timestamptz,
  initiator_accepted_at   timestamptz,
  counterpart_accepted_at timestamptz,
  -- dispute/fraud (Req 7, 8)
  dispute_raised_by      uuid references profiles(id),
  disputed_against       uuid references profiles(id),
  disputed_at            timestamptz,
  fraud_victim_id        uuid references profiles(id),
  evidence_pack_path     text,            -- Storage path to Police_Evidence_Pack PDF
  evidence_pack_complete boolean,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (initiator_id <> counterpart_id)
);

-- Cash Sales
create table cash_sales (
  id                 uuid primary key default gen_random_uuid(),
  item_id            uuid not null references items(id),
  buyer_id           uuid not null references profiles(id),
  seller_id          uuid not null references profiles(id),
  amount_cents       bigint not null,          -- fmv + platform fee
  platform_fee_cents bigint not null,          -- flat (Req 4.7)
  status             cash_sale_status not null default 'PENDING',
  transfer_id        text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Pre-Auth Holds (one per trader per trade)
create table pre_auth_holds (
  id             uuid primary key default gen_random_uuid(),
  trade_id       uuid not null references trades(id) on delete cascade,
  trader_id      uuid not null references profiles(id),
  hold_ref       text,                     -- Pinch/Mock hold id
  amount_cents   bigint not null,
  captured_cents bigint not null default 0,
  status         hold_status not null default 'ACTIVE',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Trade State Transitions (append-only audit, Req 9.5)
create table trade_state_transitions (
  id            uuid primary key default gen_random_uuid(),
  trade_id      uuid not null references trades(id) on delete cascade,
  from_state    trade_state not null,
  to_state      trade_state not null,
  requested_by  uuid references profiles(id),
  event         text not null,
  created_at    timestamptz not null default now()
);

-- Webhook Logs (idempotency + outcome, Req 10.3)
create table webhook_logs (
  id         uuid primary key default gen_random_uuid(),
  event_id   text not null unique,         -- idempotency key (Req 10.5)
  event_type text not null,
  payload    jsonb not null,
  outcome    webhook_outcome not null,
  trade_id   uuid references trades(id),
  created_at timestamptz not null default now()
);
