-- 0148_message_risk_flags.sql
--
-- ESC-27: messages that look like an attempt to take a deal off the platform.
--
-- Written by `sendMessage` with the service role when `offPlatformSignals` finds a
-- payment rail, phone number, email, messaging app or bank details. The message is
-- never blocked; the sender sees a warning and staff can read the flags. Members
-- cannot read or write this table, so flagging tells a scammer nothing.

create table if not exists cardtrade.message_risk_flags (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references cardtrade.messages(id) on delete cascade,
  conversation_id uuid not null,
  sender_id uuid not null references cardtrade.profiles(id),
  signals text[] not null check (cardinality(signals) between 1 and 10),
  created_at timestamptz not null default now()
);

create index if not exists message_risk_flags_sender_idx
  on cardtrade.message_risk_flags (sender_id, created_at desc);

alter table cardtrade.message_risk_flags enable row level security;

create policy message_risk_flags_staff_select
  on cardtrade.message_risk_flags
  for select
  to authenticated
  using ((select cardtrade.is_staff()));

-- Grants last. Service role writes; staff read through the policy above.
grant select on cardtrade.message_risk_flags to authenticated;
grant select, insert on cardtrade.message_risk_flags to service_role;
