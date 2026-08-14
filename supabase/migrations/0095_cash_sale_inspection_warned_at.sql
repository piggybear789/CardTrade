-- 0095_cash_sale_inspection_warned_at.sql
--
-- Stop sending the same buyer the same warning every hour for a day.
--
-- The cash-sale inspection sweep selects sales in INSPECTION whose deadline is within 24
-- hours and notifies the buyer. It had nothing to record that it had done so, and it runs
-- HOURLY — so a single sale produced up to 24 identical in-app notifications and 24
-- identical emails, each saying the window closes "within 24 hours".
--
-- Three sibling warnings in this codebase already got this right, which is what makes the
-- omission clear rather than debatable: the trade inspection warning filters and stamps
-- `inspection_warned_at`, the return warning added in 0088 filters and stamps
-- `return_warned_at`, and `warn_expiring_holds` uses `expiry_warned_at`. This is the one
-- that was missed.
--
-- WHY IT IS WORSE THAN NOISE. Repeated identical sends are what mailbox providers use to
-- classify a sender as spam, and this platform's transactional email carries things a
-- member genuinely must receive — a dispute being raised, a refund releasing, a payout
-- landing. Burning sender reputation on 24 copies of one nudge puts the messages that
-- matter at risk.

alter table cardtrade.cash_sales
  add column if not exists inspection_warned_at timestamptz;

comment on column cardtrade.cash_sales.inspection_warned_at is
  'When the buyer was warned that their inspection window is closing. Set once by the '
  'hourly sweep so the warning cannot repeat every pass. Mirrors trades.inspection_'
  'warned_at and cash_sales.return_warned_at.';

-- Partial: the sweep asks "who still needs warning", which is a small slice of the table.
create index if not exists cash_sales_inspection_unwarned_idx
  on cardtrade.cash_sales (inspection_deadline_at)
  where inspection_warned_at is null;
