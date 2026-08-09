-- 0083_trade_dispute_reason.sql
--
-- TRADE / CASH_SALE PARITY: give a trade dispute the claimant's own words.
--
-- WHAT WAS BROKEN. `cash_sales.dispute_reason` has existed since 0044, so a disputed
-- sale reaches an arbitrator with a sentence explaining what went wrong. A disputed
-- TRADE had `dispute_raised_by`, `disputed_against` and `disputed_at` and nothing
-- else — three ids and a timestamp. The arbitration case page rendered "The claim" for
-- a sale and an empty panel for a trade, and `reportFraud` papered over it by writing
-- the literal string 'Objective fraud reported by a trader' into
-- `trade_fraud_claims.reason`, which tells a reader only that the button was pressed.
--
-- That asymmetry is not cosmetic. A trade dispute captures a $20 Friction_Tax
-- immediately and can end in a full collateral capture paid to the other side, so it is
-- the flow where knowing WHY matters most, and it was the one with no field for it.
--
-- The two rooms are meant to behave identically wherever they can (see the fulfilment
-- parity work in 0057), and a dispute is one of those places.
--
-- NULLABLE, NOT NOT-NULL. Trades disputed before this migration have no reason and
-- never will; a NOT NULL with a backfilled placeholder would invent a claim nobody
-- made. The UI reads null as "no reason recorded", exactly as it already does for a
-- pre-0044 sale.

alter table cardtrade.trades
  add column if not exists dispute_reason text;

comment on column cardtrade.trades.dispute_reason is
  'The disputing trader''s own account of what went wrong, captured when the dispute is raised. Mirrors cash_sales.dispute_reason. Null for trades disputed before 0083, and for a dispute raised without one.';

-- Bound it the same way the statement on dispute_evidence is bounded, and for the same
-- reason: a one-word claim is not a claim, and an unbounded text column on a
-- Realtime-published table is a payload nobody wants to ship.
--
-- Written as a CHECK that tolerates NULL so the pre-existing rows stay valid.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'trades_dispute_reason_length'
      and conrelid = 'cardtrade.trades'::regclass
  ) then
    alter table cardtrade.trades
      add constraint trades_dispute_reason_length
      check (dispute_reason is null or length(trim(dispute_reason)) between 10 and 2000);
  end if;
end $$;

-- =============================================================================
-- Grants
-- =============================================================================

-- NOT granted to `authenticated`, deliberately.
--
-- Every other dispute column on this table is written by the dispute orchestrator
-- through the service role, and 0072/0073 narrowed member write grants to least
-- privilege on purpose. A member who could UPDATE `dispute_reason` directly could
-- rewrite their claim after staff had read it — the same failure the append-only rule
-- on `arbitration_notes` and `dispute_evidence` exists to prevent.
--
-- Members ADD to their account through `dispute_evidence`, which is append-only and
-- has its own insert policy. This column is the opening claim and is written once.
