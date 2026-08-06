--
-- Permanent bans after a staff-confirmed Objective_Fraud finding.
--
-- A member allegation is never enough: lib/actions/admin.ts records this state only
-- after resolveTradeFraud succeeds, which requires staff to select the actual victim
-- and commits the FRAUD_CONFIRMED transition. The profile state makes the ban immediate
-- for existing sessions; Supabase Auth receives the matching 100-year ban separately.

alter table cardtrade.profiles
  add column if not exists fraud_banned_at timestamptz,
  add column if not exists fraud_banned_by uuid references cardtrade.profiles(id) on delete set null,
  add column if not exists fraud_ban_trade_id uuid references cardtrade.trades(id) on delete set null;

comment on column cardtrade.profiles.fraud_banned_at is
  'Permanent member ban timestamp. Set only after staff-confirmed Objective_Fraud.';
comment on column cardtrade.profiles.fraud_banned_by is
  'Staff profile that made the confirmed Objective_Fraud determination.';
comment on column cardtrade.profiles.fraud_ban_trade_id is
  'Trade whose staff-confirmed Objective_Fraud finding permanently banned this member.';

-- No UPDATE grant is issued for these columns. The service-role-only fraud
-- resolution action writes them; ordinary members retain only explicit profile grants.

-- Used only by RLS. SECURITY DEFINER is necessary because a restrictive policy on a
-- member table must read the caller's profile even once table access is denied. The
-- function exposes no profile data and its search_path is locked to prevent hijacking.
create or replace function cardtrade.is_fraud_banned()
returns boolean
language sql
stable
security definer
set search_path = cardtrade, pg_temp
as $$
  select exists (
    select 1
    from cardtrade.profiles profile
    where profile.id = auth.uid()
      and profile.fraud_banned_at is not null
  );
$$;

revoke all on function cardtrade.is_fraud_banned() from public;
grant execute on function cardtrade.is_fraud_banned() to authenticated;

-- Keep a banned Profile readable by its owner so middleware can immediately detect
-- the ban and send an already-signed-in session to /account-suspended. Its profile
-- can no longer be edited. Every other member-facing table gains a restrictive policy:
-- restrictive policies AND with existing owner/participant policies, so they never
-- widen access and block every row operation for banned authenticated members.
drop policy if exists fraud_banned_profiles_no_update on cardtrade.profiles;
create policy fraud_banned_profiles_no_update
  on cardtrade.profiles
  as restrictive
  for update
  to authenticated
  using (not cardtrade.is_fraud_banned())
  with check (not cardtrade.is_fraud_banned());

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'arbitration_assignments',
    'arbitration_notes',
    'cash_sale_delivery_details',
    'cash_sale_events',
    'cash_sales',
    'charge_disputes',
    'conversations',
    'items',
    'messages',
    'notifications',
    'offers',
    'pre_auth_holds',
    'reports',
    'reviews',
    'trade_fees',
    'trade_items',
    'trade_state_transitions',
    'trades',
    'watchlist'
  ]
  loop
    execute format('drop policy if exists fraud_banned_no_access on cardtrade.%I', table_name);
    execute format(
      'create policy fraud_banned_no_access on cardtrade.%I as restrictive for all to authenticated using (not cardtrade.is_fraud_banned()) with check (not cardtrade.is_fraud_banned())',
      table_name
    );
  end loop;
end;
$$;
