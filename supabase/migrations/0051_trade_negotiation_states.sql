-- 0051_trade_negotiation_states.sql
--
-- Step 1 of folding negotiation into the Trade lifecycle: the two new
-- `trade_state` labels, and nothing else.
--
-- WHY THIS IS ITS OWN MIGRATION. `alter type ... add value` cannot be followed by
-- a use of that value inside the same transaction — Postgres raises "unsafe use
-- of new value of enum type". Every migration applied through the Supabase API is
-- wrapped in one transaction, so the columns, defaults, triggers and functions
-- that reference 'NEGOTIATING' have to land in 0052. Do not merge these two.
--
-- NEGOTIATING is inserted BEFORE COLLATERAL_PENDING so the enum's sort order
-- still matches the lifecycle order. Anything that orders by the enum (queues,
-- admin lists) keeps reading correctly rather than putting a live negotiation
-- after a completed trade.

alter type cardtrade.trade_state add value if not exists 'NEGOTIATING' before 'COLLATERAL_PENDING';

-- CANCELLED is terminal and appended at the end: it is not a lifecycle stage, it
-- is an exit, so its position carries no meaning.
alter type cardtrade.trade_state add value if not exists 'CANCELLED';
