-- CardTrade — 0004_dispute_fraud.sql
-- Adds the dispute/fraud *indication* columns the resolution orchestrator
-- (task 7.8) records against a Trade. The base dispute/fraud columns
-- (dispute_raised_by, disputed_against, disputed_at, fraud_victim_id,
-- evidence_pack_path, evidence_pack_complete) already exist in 0001_schema.sql;
-- this migration only adds the flags/allocations that could not be expressed
-- there.
--
-- All monetary values are integer AUD cents.

alter table trades
  -- Friction_Tax allocation on a settled Condition_Dispute partial capture (Req 7.3):
  --   $10.00 to the Counterpart for return shipping, $10.00 to the Platform_Fee.
  add column if not exists friction_tax_return_cents   bigint,
  add column if not exists friction_tax_platform_cents bigint,
  -- Req 7.6: the Friction_Tax Partial_Capture failed to settle; the Trade stays
  -- DISPUTED with all holds locked and this indication recorded.
  add column if not exists partial_capture_failed boolean not null default false,
  -- Req 7.7: the disputed Item was not recorded returned within 14 days; holds
  -- stay locked and this indication is recorded.
  add column if not exists return_overdue boolean not null default false,
  -- Req 8.6: the Full_Capture failed after exhausting all retries; the offending
  -- Trader's hold is preserved and the Trade is flagged for manual reconciliation.
  add column if not exists full_capture_failed   boolean not null default false,
  add column if not exists manual_reconciliation boolean not null default false;
