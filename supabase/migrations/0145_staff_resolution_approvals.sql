-- 0145_staff_resolution_approvals.sql
--
-- ESC-23: staff decisions that move money above a threshold are proposals until a
-- second staff member approves them (`domain/arbitration/approvalPolicy.ts`).
--
-- Members have no access at all. Staff read through RLS; every write goes through the
-- service role in `lib/actions/admin.ts`, which applies the policy. `is_admin()` is
-- deliberately not used here (see 0147).

create table if not exists cardtrade.staff_resolution_proposals (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in (
    'RESOLVE_CASH_SALE_DISPUTE', 'RESOLVE_CASH_SALE_RETURN', 'RESOLVE_TRACKING_FLAG',
    'REVERSE_CASH_SALE_PAYOUT', 'RESOLVE_TRADE_DISPUTE'
  )),
  case_ref uuid not null,
  value_minor bigint not null check (value_minor >= 0),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'APPROVED', 'REJECTED', 'EXECUTED')),
  proposed_by uuid not null references cardtrade.profiles(id),
  proposed_at timestamptz not null default now(),
  decided_by uuid references cardtrade.profiles(id),
  decided_at timestamptz,
  executed_at timestamptz,
  custody_hold_ref text,
  note text check (note is null or char_length(note) <= 2000)
);

-- One open proposal per case and action, so a decision cannot be proposed twice and
-- approved by two different people.
create unique index if not exists staff_resolution_proposals_open_idx
  on cardtrade.staff_resolution_proposals (action, case_ref)
  where status in ('PENDING', 'APPROVED');

alter table cardtrade.staff_resolution_proposals enable row level security;

create policy staff_resolution_proposals_staff_select
  on cardtrade.staff_resolution_proposals
  for select
  to authenticated
  using ((select cardtrade.is_staff()));

-- Grants last.
grant select on cardtrade.staff_resolution_proposals to authenticated;
grant select, insert, update on cardtrade.staff_resolution_proposals to service_role;
