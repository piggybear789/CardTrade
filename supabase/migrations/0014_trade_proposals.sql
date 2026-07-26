-- =============================================================================
-- CardTrade — 0014_trade_proposals.sql
-- Counterpart acceptance for 2-Way Trades, and privately offered trade Items.
--
-- WHY: a Trade previously came into existence the moment one Trader proposed it,
-- which placed a Pre_Auth_Hold on BOTH Traders and reserved BOTH Items before
-- the Counterpart had agreed to anything. A Trade_Proposal is the negotiation
-- record that precedes the Trade: nothing is reserved and no hold is requested
-- until the Counterpart accepts. Only on acceptance does Requirement 5.1 apply
-- and the Trade get created in COLLATERAL_PENDING.
--
-- Trade_State is deliberately NOT extended. The State_Machine still starts at
-- COLLATERAL_PENDING; a pending proposal is simply not yet a Trade.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- items.hidden — a privately offered trade Item
--
-- A Trader swapping a collectible should not have to publish it to the whole
-- catalog first. A hidden Item is owned, valued, and referable by a Trade, but
-- is excluded from catalog search and facets. Hidden is permanent: a private
-- item never becomes a public listing.
--
-- NOTE: application code (lib/actions/listings.ts) already filters on this
-- column, but no migration defined it, so a freshly provisioned database was
-- missing it. `if not exists` makes this safe on databases where it was applied
-- out of band.
-- -----------------------------------------------------------------------------
alter table cardtrade.items
  add column if not exists hidden boolean not null default false;

comment on column cardtrade.items.hidden is
  'True for an Item offered privately inside a Trade_Proposal. Excluded from catalog search/facets; never republished.';

create index if not exists items_catalog_visible_idx
  on cardtrade.items (status)
  where hidden = false;

-- -----------------------------------------------------------------------------
-- Trade_Proposal
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'trade_proposal_status') then
    create type cardtrade.trade_proposal_status as enum (
      'PENDING',    -- awaiting the Counterpart's decision
      'ACCEPTED',   -- Counterpart agreed; a Trade was created
      'DECLINED',   -- Counterpart refused
      'WITHDRAWN',  -- proposer retracted before a decision
      'SUPERSEDED'  -- the paired Item left AVAILABLE, so the offer lapsed
    );
  end if;
end $$;

create table if not exists cardtrade.trade_proposals (
  id                   uuid primary key default gen_random_uuid(),
  proposer_id          uuid not null references cardtrade.profiles(id),
  counterpart_id       uuid not null references cardtrade.profiles(id),
  -- The Item the proposer offers. May be hidden (privately offered).
  proposer_item_id     uuid not null references cardtrade.items(id),
  -- The Counterpart's publicly listed Item being requested.
  counterpart_item_id  uuid not null references cardtrade.items(id),
  status               cardtrade.trade_proposal_status not null default 'PENDING',
  -- Optional note from the proposer, same 2000-char ceiling as a description.
  message              text,
  -- Set once the proposal is accepted (Req 5.1 then applies to this Trade).
  trade_id             uuid references cardtrade.trades(id),
  created_at           timestamptz not null default now(),
  responded_at         timestamptz,

  constraint trade_proposals_distinct_traders
    check (proposer_id <> counterpart_id),
  constraint trade_proposals_distinct_items
    check (proposer_item_id <> counterpart_item_id),
  constraint trade_proposals_message_length
    check (message is null or char_length(message) <= 2000),
  -- A decided proposal must record when, and only an accepted one has a Trade.
  constraint trade_proposals_decision_consistent
    check (
      (status = 'PENDING' and responded_at is null and trade_id is null)
      or (status = 'ACCEPTED' and responded_at is not null and trade_id is not null)
      or (status in ('DECLINED', 'WITHDRAWN', 'SUPERSEDED') and responded_at is not null and trade_id is null)
    )
);

comment on table cardtrade.trade_proposals is
  'A proposed 2-Way Trade awaiting Counterpart acceptance. No Item is reserved and no Pre_Auth_Hold is requested while PENDING.';

-- At most one live offer per (proposer, counterpart item) pair, so a Counterpart
-- cannot be spammed with duplicates for the same Item.
create unique index if not exists trade_proposals_one_pending_per_pair_idx
  on cardtrade.trade_proposals (proposer_id, counterpart_item_id)
  where status = 'PENDING';

create index if not exists trade_proposals_counterpart_pending_idx
  on cardtrade.trade_proposals (counterpart_id, created_at desc)
  where status = 'PENDING';

create index if not exists trade_proposals_proposer_idx
  on cardtrade.trade_proposals (proposer_id, created_at desc);

-- -----------------------------------------------------------------------------
-- RLS
--
-- Follows the precedent set for trades and cash_sales in 0002_rls.sql: the two
-- participants may READ their own proposals, while every write (create, accept,
-- decline, withdraw, supersede) goes through the orchestrator on the
-- service-role client, which re-checks participation and item state.
-- -----------------------------------------------------------------------------
alter table cardtrade.trade_proposals enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'cardtrade'
      and tablename = 'trade_proposals'
      and policyname = 'trade_proposals_participant_select'
  ) then
    create policy trade_proposals_participant_select
      on cardtrade.trade_proposals
      for select
      to authenticated
      using (auth.uid() = proposer_id or auth.uid() = counterpart_id);
  end if;
end $$;
