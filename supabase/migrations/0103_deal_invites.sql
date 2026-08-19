-- 0103_deal_invites.sql
--
-- Restore the shareable private-deal link without resurrecting the Deal ledger
-- (dropped in 0055). A deal_invite is pending until claimed; claim opens a
-- normal Cash_Sale or Trade. This is NOT the old `deals` table.

create type cardtrade.deal_invite_kind as enum ('CASH_SALE', 'TRADE');
create type cardtrade.deal_invite_host_role as enum ('SELLER', 'BUYER');

create table cardtrade.deal_invites (
  id uuid primary key default gen_random_uuid(),
  token text not null,
  host_id uuid not null references cardtrade.profiles (id),
  kind cardtrade.deal_invite_kind not null,
  -- Cash deals only: who the host is. Null on TRADE.
  host_role cardtrade.deal_invite_host_role,
  -- Host's hidden card. Required for TRADE and for CASH_SALE / SELLER.
  -- Null when the host is a cash BUYER (they only bring the price).
  host_item_id uuid references cardtrade.items (id),
  -- Cash asking / offer price. Null on TRADE.
  price_cents bigint,
  -- Trade cash-to-even. Unused on CASH_SALE (always 0).
  cash_amount_cents bigint not null default 0,
  cash_direction cardtrade.trade_cash_direction not null default 'PROPOSER_PAYS',
  declared_value_cents bigint,
  -- What the host wants the other side to put up (cash BUYER, or TRADE).
  wanted_description text,
  offer_message text,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  claimed_by uuid references cardtrade.profiles (id),
  cash_sale_id uuid references cardtrade.cash_sales (id),
  trade_id uuid references cardtrade.trades (id),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),

  constraint deal_invites_token_len check (
    char_length(token) >= 16 and char_length(token) <= 64
  ),
  constraint deal_invites_price_positive check (
    price_cents is null or price_cents > 0
  ),
  constraint deal_invites_cash_nonneg check (cash_amount_cents >= 0),
  constraint deal_invites_wanted_len check (
    wanted_description is null or char_length(wanted_description) <= 1000
  ),
  constraint deal_invites_message_len check (
    offer_message is null or char_length(offer_message) <= 2000
  ),
  constraint deal_invites_one_contract check (
    not (cash_sale_id is not null and trade_id is not null)
  ),
  constraint deal_invites_kind_shape check (
    (
      kind = 'CASH_SALE'
      and host_role is not null
      and price_cents is not null
      and (
        (host_role = 'SELLER' and host_item_id is not null)
        or (host_role = 'BUYER' and wanted_description is not null)
      )
    )
    or (
      kind = 'TRADE'
      and host_role is null
      and host_item_id is not null
    )
  ),
  constraint deal_invites_claimed_pair check (
    (claimed_at is null and claimed_by is null)
    or (claimed_at is not null and claimed_by is not null)
  )
);

create unique index deal_invites_token_uidx on cardtrade.deal_invites (token);
create index deal_invites_host_pending_idx
  on cardtrade.deal_invites (host_id)
  where claimed_at is null and revoked_at is null;

comment on table cardtrade.deal_invites is
  'Pending private-deal invite. Claim opens a Cash_Sale or Trade; this is not the retired deals ledger.';

alter table cardtrade.deal_invites enable row level security;

drop policy if exists deal_invites_host_select on cardtrade.deal_invites;
create policy deal_invites_host_select on cardtrade.deal_invites
  for select
  to authenticated
  using (host_id = (select auth.uid()));

drop policy if exists fraud_banned_no_access on cardtrade.deal_invites;
create policy fraud_banned_no_access
  on cardtrade.deal_invites
  as restrictive
  for all
  to authenticated
  using (not cardtrade.is_fraud_banned())
  with check (not cardtrade.is_fraud_banned());

revoke all on cardtrade.deal_invites from public, anon, authenticated;
grant select on cardtrade.deal_invites to authenticated;
-- Writes go through the service role from lib/actions/dealInvites.ts.
grant all on cardtrade.deal_invites to service_role;
