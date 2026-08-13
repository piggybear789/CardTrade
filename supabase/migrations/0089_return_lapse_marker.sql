-- 0089_return_lapse_marker.sql
--
-- A return that was never posted needs a HUMAN, and this is the column that gets it
-- one. Completes the return-conditional refund flow from 0088.
--
-- WHY THIS IS NOT AUTO-RESOLVED. When a Buyer wins a full refund and then lets the
-- dispatch deadline pass without posting the goods back, the tempting move is to
-- release the money to the Seller on the timer. We deliberately do not:
--
--   * "Did not post within seven days" is not proof of bad faith. Illness, travel, a
--     parcel posted untracked, or a deadline that was simply unreasonable all look
--     identical from here.
--   * An operator has ALREADY found for the Buyer on the merits. Reversing that
--     finding on a clock, with no one looking at it, would overturn a decision with
--     an inference.
--   * The money is sitting safely in the platform balance either way. There is no
--     forcing reason to move it, which means there is no excuse for guessing.
--
-- So the lapse is a TRIAGE SIGNAL, not a settlement. It is also why this is a
-- timestamp rather than a boolean: `arbitrationCase` derives priority from how long a
-- case has been waiting, and a flag cannot say that.

alter table cardtrade.cash_sales
  -- Set by the sweep when the dispatch deadline passes with nothing posted. Cleared
  -- back to null if the Buyer subsequently posts the return, because a late return is
  -- still a return and the case should leave the queue on its own.
  add column if not exists return_lapsed_at timestamptz;

comment on column cardtrade.cash_sales.return_lapsed_at is
  'When a return dispatch deadline passed with no shipment recorded. A triage signal '
  'for arbitration, never a settlement: the refund is not reversed and nothing is '
  'released to the seller on a timer. Cleared if the buyer posts the return late.';

-- Partial index: the arbitration queue asks "what has lapsed and is still open", and
-- that is a tiny fraction of the table.
create index if not exists cash_sales_return_lapsed_idx
  on cardtrade.cash_sales (return_lapsed_at)
  where return_lapsed_at is not null;
