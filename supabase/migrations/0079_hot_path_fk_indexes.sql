-- 0079_hot_path_fk_indexes.sql
--
-- Adds covering indexes for the foreign keys that sit on a READ PATH or inside an
-- RLS predicate. Supabase's linter flags 40 unindexed foreign keys in `cardtrade`;
-- this migration deliberately covers a subset rather than all of them.
--
-- WHY A SUBSET. An unindexed foreign key costs in two different places, and only one
-- of them is worth an index here:
--
--   1. A query or RLS predicate filters on the column. `pre_auth_holds.trade_id` is
--      read on every contract-room render and appears in `holds_participant_select`;
--      `conversations.participant_a/b` appear in the inbox query AND in
--      `conversations_participant_select` AND in the `messages` policy's subquery.
--      These are worth indexing.
--   2. Nothing filters on it, but deleting the REFERENCED row has to scan for
--      children. `cash_sales.dispute_resolved_by`, `trades.fraud_claimed_against`
--      and the rest of the nullable staff-attribution columns are only ever read
--      by primary key on the row that already contains them, and the referenced
--      rows (profiles, trades) are never deleted in normal operation — a fraud ban
--      suspends an account, it does not delete it. Indexing those would add write
--      cost on every insert to buy nothing.
--
-- Every index below is justified by case 1.
--
-- THE "UNUSED INDEX" WARNINGS ARE NOT A REASON TO DROP ANYTHING. The linter also
-- reports `items_region_catalog_idx`, `items_search_tsv_idx` and the two
-- `trades_negotiating_*` partial indexes as never used. They are never used because
-- this database has had no production traffic, not because the planner rejected
-- them. Dropping an index that matches the catalog's exact predicate because nobody
-- has browsed yet is the wrong lesson to take from a zero-traffic linter run.
--
-- Requirements: 1.6, 1.7, 9.6, 9.7.

-- ---------------------------------------------------------------------------
-- Contract room reads. Both of these are also RLS predicates
-- (`holds_participant_select` joins on trade_id).
-- ---------------------------------------------------------------------------

create index if not exists pre_auth_holds_trade_id_idx
  on cardtrade.pre_auth_holds (trade_id);

create index if not exists pre_auth_holds_trader_id_idx
  on cardtrade.pre_auth_holds (trader_id);

create index if not exists trade_state_transitions_trade_id_idx
  on cardtrade.trade_state_transitions (trade_id);

create index if not exists trade_items_trade_item_idx
  on cardtrade.trade_items (item_id);

create index if not exists trade_items_trader_id_idx
  on cardtrade.trade_items (trader_id);

create index if not exists trade_fees_trader_id_idx
  on cardtrade.trade_fees (trader_id);

-- The trade bundle pickers and the availability guards ask "is this item already in
-- a trade", which reads `trades` BY item rather than by id.
create index if not exists trades_initiator_item_id_idx
  on cardtrade.trades (initiator_item_id);

create index if not exists trades_counterpart_item_id_idx
  on cardtrade.trades (counterpart_item_id);

-- ---------------------------------------------------------------------------
-- Inbox. `participant_a/b` are in the conversations policy AND in the subquery
-- that `messages_participant_select` runs, so an unindexed scan here is paid
-- twice on every message read.
-- ---------------------------------------------------------------------------

create index if not exists conversations_participant_a_idx
  on cardtrade.conversations (participant_a);

create index if not exists conversations_participant_b_idx
  on cardtrade.conversations (participant_b);

create index if not exists messages_sender_id_idx
  on cardtrade.messages (sender_id);

-- ---------------------------------------------------------------------------
-- Member-owned lists: /listings/mine, /sellers/[id], /saved, /offers.
-- ---------------------------------------------------------------------------

create index if not exists items_owner_id_idx
  on cardtrade.items (owner_id);

create index if not exists items_category_id_idx
  on cardtrade.items (category_id);

create index if not exists watchlist_item_id_idx
  on cardtrade.watchlist (item_id);

create index if not exists offers_offered_by_idx
  on cardtrade.offers (offered_by);

-- ---------------------------------------------------------------------------
-- RLS predicates that filter on the column directly.
-- ---------------------------------------------------------------------------

create index if not exists charge_disputes_profile_id_idx
  on cardtrade.charge_disputes (profile_id);

create index if not exists reports_reporter_id_idx
  on cardtrade.reports (reporter_id);

-- The contract room can arrive from a conversation rather than from the sale.
create index if not exists cash_sales_conversation_id_idx
  on cardtrade.cash_sales (conversation_id);
