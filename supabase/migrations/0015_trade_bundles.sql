-- =============================================================================
-- CardTrade — 0015_trade_bundles.sql
-- Multi-item + cash Trade offers, and a declared value for the offered bundle.
--
-- WHY: a real swap is rarely one card for one card. A trader offers two or three
-- things, often with cash to make up a difference, and states what they think
-- their side is worth. The Counterpart accepting is what makes the valuation
-- binding — CardTrade does not appraise goods.
--
-- Additive by design: a proposal with no extra items and no cash behaves exactly
-- as it did before this migration, so the 1:1 path is unchanged.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Trade_Proposal: cash leg + declared value
--
-- Cash flows one way only, from the proposer to the lister. A proposer asking
-- for cash BACK would need the proposer to be payout-approved, which is a
-- different flow (see Req 3.9) and is deliberately not modelled here.
-- -----------------------------------------------------------------------------
alter table cardtrade.trade_proposals
  add column if not exists cash_amount_cents bigint not null default 0,
  add column if not exists declared_value_cents bigint;

alter table cardtrade.trade_proposals
  drop constraint if exists trade_proposals_cash_non_negative;
alter table cardtrade.trade_proposals
  add constraint trade_proposals_cash_non_negative
  check (cash_amount_cents >= 0);

alter table cardtrade.trade_proposals
  drop constraint if exists trade_proposals_declared_value_positive;
alter table cardtrade.trade_proposals
  add constraint trade_proposals_declared_value_positive
  check (declared_value_cents is null or declared_value_cents > 0);

comment on column cardtrade.trade_proposals.cash_amount_cents is
  'Cash the proposer adds on top of their goods, in integer AUD cents. Always proposer -> counterpart.';
comment on column cardtrade.trade_proposals.declared_value_cents is
  'What the proposer says their whole side is worth. Self-declared: it is the Counterpart''s acceptance that makes it binding, and it NEVER sizes a Bond (see Req 5.4).';

-- -----------------------------------------------------------------------------
-- The proposer's additional Items
--
-- `trade_proposals.proposer_item_id` remains the primary offered Item so every
-- existing read keeps working; this table carries the rest of the bundle.
-- -----------------------------------------------------------------------------
create table if not exists cardtrade.trade_proposal_items (
  proposal_id uuid not null references cardtrade.trade_proposals(id) on delete cascade,
  item_id     uuid not null references cardtrade.items(id),
  created_at  timestamptz not null default now(),
  primary key (proposal_id, item_id)
);

comment on table cardtrade.trade_proposal_items is
  'Additional Items in a proposer''s bundle, beyond trade_proposals.proposer_item_id.';

create index if not exists trade_proposal_items_item_idx
  on cardtrade.trade_proposal_items (item_id);

alter table cardtrade.trade_proposal_items enable row level security;

-- Readable by the two participants of the owning proposal; writes go through the
-- orchestrator on the service-role client, as for trade_proposals itself.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'cardtrade'
      and tablename = 'trade_proposal_items'
      and policyname = 'trade_proposal_items_participant_select'
  ) then
    create policy trade_proposal_items_participant_select
      on cardtrade.trade_proposal_items
      for select
      to authenticated
      using (
        exists (
          select 1
          from cardtrade.trade_proposals p
          where p.id = trade_proposal_items.proposal_id
            and (auth.uid() = p.proposer_id or auth.uid() = p.counterpart_id)
        )
      );
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Trade: the accepted bundle and cash leg
-- -----------------------------------------------------------------------------
alter table cardtrade.trades
  add column if not exists cash_amount_cents bigint not null default 0;

alter table cardtrade.trades
  drop constraint if exists trades_cash_non_negative;
alter table cardtrade.trades
  add constraint trades_cash_non_negative
  check (cash_amount_cents >= 0);

comment on column cardtrade.trades.cash_amount_cents is
  'Cash the initiator pays the counterpart on top of goods, in integer AUD cents.';

create table if not exists cardtrade.trade_items (
  trade_id   uuid not null references cardtrade.trades(id) on delete cascade,
  -- Which side is giving this Item.
  trader_id  uuid not null references cardtrade.profiles(id),
  item_id    uuid not null references cardtrade.items(id),
  created_at timestamptz not null default now(),
  primary key (trade_id, item_id)
);

comment on table cardtrade.trade_items is
  'Every Item on each side of a Trade. The trades.*_item_id columns remain the primary Item per side.';

create index if not exists trade_items_trader_idx
  on cardtrade.trade_items (trade_id, trader_id);

alter table cardtrade.trade_items enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'cardtrade'
      and tablename = 'trade_items'
      and policyname = 'trade_items_participant_select'
  ) then
    create policy trade_items_participant_select
      on cardtrade.trade_items
      for select
      to authenticated
      using (
        exists (
          select 1
          from cardtrade.trades t
          where t.id = trade_items.trade_id
            and (auth.uid() = t.initiator_id or auth.uid() = t.counterpart_id)
        )
      );
  end if;
end $$;
