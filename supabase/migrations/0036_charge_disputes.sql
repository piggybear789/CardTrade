-- 0036_charge_disputes.sql
--
-- A ledger for chargebacks, and the escalation path for them.
--
-- WHY THIS IS NOT OPTIONAL. The platform is merchant of record and accepted
-- `losses_collector: application` when creating connected accounts, so a payer's
-- chargeback debits the PLATFORM balance directly. Until now no `charge.dispute.*`
-- event was subscribed, translated or stored, which meant a chargeback was money
-- leaving with no record, no owner, and no chance to contest it before the
-- provider's evidence deadline passed (missing that deadline forfeits the dispute
-- automatically).
--
-- Deliberately a separate table rather than a column on cash_sales or trades:
--   * a dispute may not be attributable to either (the metadata can be absent,
--     or the charge created outside StripeService), and an unattributable
--     chargeback still has to be recorded;
--   * a single charge can be disputed, won, and disputed again;
--   * the evidence deadline is a platform obligation, not a party's.

create table if not exists cardtrade.charge_disputes (
  id uuid primary key default gen_random_uuid(),
  -- Provider dispute id (`dp_...`). Unique so redelivery cannot double-insert.
  dispute_ref text not null unique,
  -- Provider charge id (`ch_...`) the dispute is against.
  charge_ref text not null,
  -- Attribution, when the stamped metadata allowed it. All nullable on purpose.
  trade_id uuid references cardtrade.trades (id) on delete set null,
  cash_sale_id uuid references cardtrade.cash_sales (id) on delete set null,
  profile_id uuid references cardtrade.profiles (id) on delete set null,
  amount_cents bigint not null check (amount_cents >= 0),
  -- Provider reason string (`fraudulent`, `product_not_received`, ...).
  reason text,
  -- Provider status string, kept verbatim for audit.
  status text not null,
  /*
   * Terminal outcome. `lost` is the only value that means the platform has
   * absorbed the funds; `warning_closed` is an early-fraud-warning that closed
   * without moving money and must not be counted as a loss.
   */
  outcome text check (outcome in ('won', 'lost', 'warning_closed', 'other')),
  -- Hard provider deadline for submitting evidence. Missing it forfeits.
  evidence_due_by timestamptz,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table cardtrade.charge_disputes is
  'Chargebacks reported by the payment provider. The platform is merchant of '
  'record and absorbs these losses, so every dispute is recorded here even when '
  'it cannot be attributed to a Trade or Cash_Sale.';

create index if not exists charge_disputes_open_idx
  on cardtrade.charge_disputes (evidence_due_by)
  where closed_at is null;

create index if not exists charge_disputes_trade_idx
  on cardtrade.charge_disputes (trade_id)
  where trade_id is not null;

create index if not exists charge_disputes_cash_sale_idx
  on cardtrade.charge_disputes (cash_sale_id)
  where cash_sale_id is not null;

-- RLS: this is platform financial data. No participant-level read — a dispute
-- exposes the provider's fraud assessment of a payer, which is not a party's
-- business. Writes come from the webhook pipeline on the service-role client,
-- which bypasses RLS, so no write policy is granted to anyone.
alter table cardtrade.charge_disputes enable row level security;

drop policy if exists "Admins read charge disputes" on cardtrade.charge_disputes;
create policy "Admins read charge disputes"
  on cardtrade.charge_disputes
  for select
  to authenticated
  using (
    exists (
      select 1 from cardtrade.profiles p
      where p.id = auth.uid() and p.is_admin
    )
  );

-- Keep updated_at honest on redelivery/closure.
create or replace function cardtrade.touch_charge_disputes()
returns trigger
language plpgsql
set search_path to 'cardtrade', 'pg_temp'
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists charge_disputes_touch on cardtrade.charge_disputes;
create trigger charge_disputes_touch
  before update on cardtrade.charge_disputes
  for each row execute function cardtrade.touch_charge_disputes();

-- ---------------------------------------------------------------------------
-- Record + escalate
-- ---------------------------------------------------------------------------

create or replace function cardtrade.record_charge_dispute(
  p_dispute_ref text,
  p_charge_ref text,
  p_amount_cents bigint,
  p_status text,
  p_reason text default null,
  p_trade_id uuid default null,
  p_cash_sale_id uuid default null,
  p_profile_id uuid default null,
  p_evidence_due_by timestamptz default null,
  p_outcome text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'cardtrade', 'pg_temp'
as $function$
declare
  v_id uuid;
  v_is_new boolean := false;
begin
  insert into cardtrade.charge_disputes (
    dispute_ref, charge_ref, amount_cents, status, reason,
    trade_id, cash_sale_id, profile_id, evidence_due_by, outcome,
    closed_at
  )
  values (
    p_dispute_ref, p_charge_ref, p_amount_cents, p_status, p_reason,
    p_trade_id, p_cash_sale_id, p_profile_id, p_evidence_due_by, p_outcome,
    case when p_outcome is null then null else now() end
  )
  on conflict (dispute_ref) do update
    set status = excluded.status,
        -- Never blank an attribution or a deadline we already resolved.
        reason = coalesce(excluded.reason, cardtrade.charge_disputes.reason),
        trade_id = coalesce(cardtrade.charge_disputes.trade_id, excluded.trade_id),
        cash_sale_id = coalesce(cardtrade.charge_disputes.cash_sale_id, excluded.cash_sale_id),
        profile_id = coalesce(cardtrade.charge_disputes.profile_id, excluded.profile_id),
        evidence_due_by = coalesce(
          cardtrade.charge_disputes.evidence_due_by, excluded.evidence_due_by),
        outcome = coalesce(excluded.outcome, cardtrade.charge_disputes.outcome),
        closed_at = case
          when excluded.outcome is not null then now()
          else cardtrade.charge_disputes.closed_at
        end
  returning id, (created_at = updated_at) into v_id, v_is_new;

  -- Tell every admin, once per dispute. A chargeback needs a human before the
  -- evidence window closes, and there is no other surface that would show it.
  if v_is_new then
    insert into cardtrade.notifications (user_id, type, title, body, link)
    select
      p.id,
      'SYSTEM',
      'Chargeback opened',
      'A payer disputed '
        || to_char(p_amount_cents / 100.0, 'FM999,999,990.00')
        || ' AUD (' || coalesce(p_reason, 'no reason given') || ').'
        || case
             when p_evidence_due_by is null then ' No evidence deadline reported.'
             else ' Evidence is due by '
                  || to_char(p_evidence_due_by at time zone 'Australia/Melbourne',
                             'FMDay D FMMon YYYY at HH12:MIam')
                  || '.'
           end,
      '/admin'
    from cardtrade.profiles p
    where p.is_admin;
  end if;

  return v_id;
end;
$function$;

comment on function cardtrade.record_charge_dispute is
  'Upserts a provider chargeback and notifies admins the first time it is seen. '
  'Idempotent on dispute_ref so provider redelivery cannot double-record or '
  're-notify.';
