-- 0075_friction_tax_return_payout.sql
--
-- Records the payout of the Friction_Tax return-shipping share, so it can actually be
-- paid instead of only allocated.
--
-- THE BUG. A Condition_Dispute partial-captures a fixed $20 from the disputed-against
-- trader's collateral and splits it $10 return shipping / $10 platform fee (Req 7.3).
-- The split was written to `friction_tax_return_cents` and `friction_tax_platform_cents`
-- and then never acted on: grepping every reference to `friction_tax_return_cents`
-- outside the write itself finds only two READS, both for display — the member's payouts
-- screen and the arbitration queue's "amount at risk".
--
-- So on every condition dispute the platform captured $20 and kept all of it, while the
-- trader who has to post the item back was under-compensated by exactly the $10 the
-- requirement allocates to them. Worse, it was invisible to the solvency check:
-- custody reconciliation reads only `cash_sales`, so a genuine obligation sitting in the
-- platform balance contributed nothing to `heldForMembersCents` — the direction that
-- hides an insolvency.
--
-- WHY COLUMNS AND NOT JUST A TRANSFER. Money that moves has to leave a record. Without
-- one there is no way to tell an unpaid share from a paid one, the payouts screen would
-- keep presenting the allocation as though it had landed, and a retry could not know
-- whether to try again. The nonce is persisted for the same reason every other transfer
-- nonce is: a retry must reuse it verbatim so the provider replays rather than pays
-- twice.
--
-- Requirements: 7.3, 12.4.

alter table cardtrade.trades
  add column if not exists friction_tax_return_nonce text,
  add column if not exists friction_tax_return_paid_at timestamptz,
  add column if not exists friction_tax_return_error text;

comment on column cardtrade.trades.friction_tax_return_nonce is
  'Persisted idempotency key for paying the Friction_Tax return-shipping share to the '
  'trader who raised the dispute. Assigned once; retries reuse it verbatim.';

comment on column cardtrade.trades.friction_tax_return_paid_at is
  'When the return-shipping share actually landed in the raising trader''s connected '
  'account. NULL means the allocation is recorded but the money is still in the '
  'platform balance and therefore still owed.';

comment on column cardtrade.trades.friction_tax_return_error is
  'Why the last attempt to pay the return-shipping share did not land. Operational '
  'detail for staff; never shown to a member.';
