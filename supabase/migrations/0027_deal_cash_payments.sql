-- 0027_deal_cash_payments.sql
--
-- Private-deal cash settles through Pinch, not face-to-face. When a deal has
-- cash_amount_cents > 0, confirmDeal charges the payer into platform escrow
-- and completeDeal keeps that charge as settlement to the recipient.
-- Collateral continues to live in deal_holds; this table is cash only.

do $$ begin
  create type cardtrade.deal_payment_status as enum (
    'HELD',
    'SETTLED',
    'REFUNDED',
    'FAILED'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists cardtrade.deal_payments (
  id              uuid primary key default gen_random_uuid(),
  deal_id         uuid not null references cardtrade.deals(id) on delete cascade,
  payer_id        uuid not null references cardtrade.profiles(id),
  recipient_id    uuid not null references cardtrade.profiles(id),
  amount_cents    bigint not null check (amount_cents > 0),
  -- Provider payment id from placeHold (charge-and-refund escrow).
  payment_ref     text,
  -- Provider transfer id when settled via requestTransfer (direct payout).
  transfer_ref    text,
  status          cardtrade.deal_payment_status not null default 'HELD',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (payer_id <> recipient_id)
);

create index if not exists deal_payments_deal_id_idx
  on cardtrade.deal_payments (deal_id);
create index if not exists deal_payments_status_idx
  on cardtrade.deal_payments (status)
  where status = 'HELD';

comment on table cardtrade.deal_payments is
  'Pinch cash escrow for private deals. Separate from deal_holds (collateral). HELD on confirm; SETTLED on both-complete; kept locked on dispute.';

comment on column cardtrade.deal_payments.payment_ref is
  'Pinch/Mock payment id returned by placeHold when cash was charged on lock.';

comment on column cardtrade.deal_payments.transfer_ref is
  'Pinch/Mock transfer id when cash was routed to the recipient merchant.';

alter table cardtrade.deal_payments enable row level security;

drop policy if exists deal_payments_party_select on cardtrade.deal_payments;
create policy deal_payments_party_select on cardtrade.deal_payments
  for select
  using (
    exists (
      select 1 from cardtrade.deals d
      where d.id = deal_payments.deal_id
        and (d.creator_id = auth.uid() or d.counterparty_id = auth.uid())
    )
  );

-- Realtime so the deal room can show cash lock / settle without a full reload.
do $$ begin
  alter publication supabase_realtime add table cardtrade.deal_payments;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
