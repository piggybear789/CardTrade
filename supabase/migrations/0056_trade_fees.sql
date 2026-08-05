-- 0056_trade_fees.sql
--
-- The Trade_Fee: the platform's cut of a 2-way trade, 5% from each trader on the
-- value they receive. See `domain/trade/tradeFee.ts` for the policy and for why
-- the fee is NOT taken out of the collateral bond.
--
-- Modelled as one row per trader, mirroring `pre_auth_holds`, rather than eight
-- columns on `trades`. A trade has two symmetric fee collections with independent
-- lifecycles, so a table is the honest shape and it keeps the idempotency key
-- unique-constrained per collection.

create type cardtrade.trade_fee_status as enum ('PENDING', 'SETTLED', 'FAILED', 'REFUNDED');

create table cardtrade.trade_fees (
  trade_id uuid not null references cardtrade.trades(id) on delete cascade,
  trader_id uuid not null references cardtrade.profiles(id),
  amount_cents bigint not null check (amount_cents >= 0),
  status cardtrade.trade_fee_status not null default 'PENDING',
  charge_ref text,
  refund_ref text,
  -- Assigned once, when the fee falls due, and reused verbatim on every retry: an
  -- ambiguous provider timeout must not be able to charge a trader twice.
  nonce text not null,
  error text,
  attempts integer not null default 0,
  settled_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (trade_id, trader_id),
  constraint trade_fees_nonce_unique unique (nonce)
);

-- The drain queue: fees still owed, oldest first.
create index trade_fees_owed_idx
  on cardtrade.trade_fees (status, created_at)
  where status in ('PENDING', 'FAILED');

alter table cardtrade.trade_fees enable row level security;

-- Participants may read their own trade's fees so the room can disclose them.
-- Writes are service-role only: a fee is never set by a member.
create policy trade_fees_participant_select
  on cardtrade.trade_fees for select to authenticated
  using (
    exists (
      select 1 from cardtrade.trades t
      where t.id = trade_fees.trade_id
        and (select auth.uid()) in (t.initiator_id, t.counterpart_id)
    )
  );

revoke all on cardtrade.trade_fees from anon, authenticated;
grant select on cardtrade.trade_fees to authenticated;
grant all on cardtrade.trade_fees to service_role;

comment on table cardtrade.trade_fees is
  'The platform cut of a 2-way trade, one row per trader. Charged at the Commitment_Point, separately from the collateral bond, which is always released in full.';
comment on column cardtrade.trade_fees.nonce is
  'Persisted idempotency key. Reused verbatim on retry so an ambiguous timeout cannot charge a trader twice.';

alter publication supabase_realtime add table cardtrade.trade_fees;
