-- 0088a_return_status_values.sql
--
-- The two Cash_Sale statuses the return flow needs, added on their own.
--
-- WHY THIS IS ITS OWN FILE, RUN BEFORE 0088. Postgres refuses to USE a new enum value
-- in the same transaction that added it ("unsafe use of new value of enum type"). 0088
-- references both values — in an RLS policy and in a function body — so the two cannot
-- share a transaction. Splitting them is the fix; merging them back will fail on a
-- fresh database even though it appears to work against one where the values already
-- exist.
--
-- `if not exists` so re-running is harmless.

alter type cardtrade.cash_sale_status add value if not exists 'RETURN_PENDING';
alter type cardtrade.cash_sale_status add value if not exists 'RETURN_IN_TRANSIT';
