-- CardTrade — 0002_rls.sql
-- Row-Level Security (RLS) policies.
--
-- RLS is the primary authorization mechanism: it enforces per-owner Profile
-- and Item access and per-participant Trade access at the database, not just
-- the UI (Req 1.6, 1.7, 3.7, 3.8, 9.6, 9.7).
--
-- Authorization model:
--   * End-user reads/writes go through the anon/authenticated roles and are
--     governed by the policies below.
--   * The webhook handler and orchestrator side effects use the service-role
--     client, which BYPASSES RLS. All privileged trade/cash-sale/hold writes
--     (state transitions, payment side effects, audit rows) happen there, so
--     no end-user write policy is granted on trades.
--
-- Depends on: 0001_schema.sql (profiles, items, trades, webhook_logs).

-- =============================================================================
-- Enable RLS
-- =============================================================================

alter table profiles     enable row level security;
alter table items         enable row level security;
alter table trades        enable row level security;
alter table webhook_logs  enable row level security;

-- =============================================================================
-- Profiles: only the owner can read/write their own profile (Req 1.6, 1.7)
-- =============================================================================

create policy profiles_owner_select on profiles
  for select using (auth.uid() = id);

create policy profiles_owner_update on profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

create policy profiles_owner_insert on profiles
  for insert with check (auth.uid() = id);

-- =============================================================================
-- Items: public read of the AVAILABLE catalog + owner read of own
-- non-available items; owner-only writes (Req 3.4-3.8)
-- =============================================================================

create policy items_catalog_select on items
  for select using (status = 'AVAILABLE' or owner_id = auth.uid());

create policy items_owner_insert on items
  for insert with check (owner_id = auth.uid());

create policy items_owner_update on items
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy items_owner_delete on items
  for delete using (owner_id = auth.uid());

-- =============================================================================
-- Trades: only the two participating Traders may read; writes go through the
-- service-role client via the orchestrator (Req 9.6, 9.7)
-- =============================================================================

create policy trades_participant_select on trades
  for select using (auth.uid() = initiator_id or auth.uid() = counterpart_id);

-- =============================================================================
-- Webhook logs: no end-user access at all (service role only)
-- =============================================================================

create policy webhook_logs_no_access on webhook_logs
  for all using (false) with check (false);

-- -----------------------------------------------------------------------------
-- Note on cash_sales, pre_auth_holds, and trade_state_transitions:
-- These tables are written exclusively by the orchestrator/webhook handler via
-- the service-role client (which bypasses RLS), per the design's authorization
-- model. Participant read access for the real-time Trade Contract view
-- (e.g. Pre_Auth_Hold status, Req 11.1) is provisioned alongside the Realtime
-- publication in the subsequent migration (task 2.3), so their read policies
-- are intentionally deferred to that migration rather than granted here.
-- -----------------------------------------------------------------------------
