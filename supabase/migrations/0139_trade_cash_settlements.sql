-- 0139_trade_cash_settlements.sql
--
-- ESC-05 / ESC-06 (High): a trade's cash leg had no escrow at all.
--
-- The cash part of a swap ("my card plus $50 for yours") was never collected by the
-- platform. At COMPLETED, `settleTradeCash` charged the payer OFF-SESSION and
-- forwarded the money straight to the receiver in the same call. So:
--
--   * ESC-05: nothing backed the cash while the trade was live. Collateral covered
--     the goods only, and a payer whose card declined at completion had walked away
--     with the other trader's card.
--   * ESC-06: the receiver got paid inline whatever happened next, with no holdback
--     and no way to route the cash to the victim on a fraud finding.
--
-- Now the cash is collected BUYER-PRESENT before any collateral hold is placed, held
-- in the platform balance, and released (or refunded) only by the outcome. One row
-- per trade with a cash leg. Kept OFF `trades` because `trades` is published to
-- Realtime, the same reason the delivery details live in their own table.
--
-- The refund trigger exists because four writers can mark a row COLLECTED (the pay
-- action, the read-back, the 30-minute cancel job and the webhook) and the admin
-- client bypasses RLS: only a trigger binds every writer. A collection that lands on
-- a trade that has already ended is refunded, never kept.

create table if not exists cardtrade.trade_cash_settlements (
  trade_id uuid primary key references cardtrade.trades(id) on delete cascade,
  payer_id uuid not null references cardtrade.profiles(id),
  receiver_id uuid not null references cardtrade.profiles(id),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null,
  status text not null default 'NOT_COLLECTED'
    check (status in (
      'NOT_COLLECTED', 'COLLECTING', 'COLLECTED', 'RELEASE_PENDING', 'RELEASED',
      'REFUND_PENDING', 'REFUNDED', 'FAILED'
    )),
  collection_attempt integer not null default 0,
  collection_ref text,
  collection_requested_at timestamptz,
  collected_at timestamptz,
  pay_by timestamptz not null,
  release_nonce text unique,
  release_ref text,
  release_at timestamptz,
  hold_reason text check (hold_reason is null or hold_reason in ('CHARGE_DISPUTE', 'FRAUD_WARNING', 'STAFF')),
  refund_nonce text unique,
  refund_ref text,
  cancel_failures integer not null default 0,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trade_cash_settlements_status_idx
  on cardtrade.trade_cash_settlements (status, pay_by);

alter table cardtrade.trade_cash_settlements enable row level security;

-- Participants read their own trade's cash leg (the room shows its status); staff
-- read all. Every write is the service role.
drop policy if exists trade_cash_settlements_participant_select on cardtrade.trade_cash_settlements;
create policy trade_cash_settlements_participant_select
  on cardtrade.trade_cash_settlements
  for select
  to authenticated
  using (
    payer_id = (select auth.uid())
    or receiver_id = (select auth.uid())
    or (select cardtrade.is_staff())
  );

-- A collection that lands on an ended trade is refunded (R4-N2: only on the
-- transition INTO collected, so a later status change of an already-collected row is
-- not rewritten).
create or replace function cardtrade.trade_cash_settlements_refund_if_trade_terminal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_state text;
begin
  if old.status in ('NOT_COLLECTED', 'COLLECTING') and new.status = 'COLLECTED' then
    select t.state::text into v_state from cardtrade.trades t where t.id = new.trade_id;
    if v_state in ('CANCELLED', 'COMPLETED', 'FRAUD_RESOLVED') then
      new.status := 'REFUND_PENDING';
      new.refund_nonce := coalesce(new.refund_nonce, 'trade-cash:refund:' || new.trade_id::text);
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists trade_cash_settlements_refund_if_trade_terminal on cardtrade.trade_cash_settlements;
create trigger trade_cash_settlements_refund_if_trade_terminal
  before update on cardtrade.trade_cash_settlements
  for each row execute function cardtrade.trade_cash_settlements_refund_if_trade_terminal();

-- Grants last. Members read through the policy above; nothing is member-writable.
revoke all on table cardtrade.trade_cash_settlements from public, anon, authenticated;
grant select on table cardtrade.trade_cash_settlements to authenticated;
grant all on table cardtrade.trade_cash_settlements to service_role;
revoke all on function cardtrade.trade_cash_settlements_refund_if_trade_terminal() from public, anon, authenticated;
