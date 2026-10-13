-- 0140_risk_signals.sql
--
-- ESC-03 (Critical) layers 3 and 4, ESC-14, ESC-24, ESC-25: the stores the fraud
-- controls read. Everything here is service-role only; none of it is member-readable.
--
--   * member_risk_signals: HMAC'd card and payout-account fingerprints per profile, so
--     two accounts sharing a card or a bank account can be refused as a pair before a
--     stolen-card self-deal (ESC-03 layer 3). Never the raw fingerprint.
--   * blocked_payment_fingerprints: a card whose chargeback was LOST as fraud or
--     non-receipt cannot be saved or used again (ESC-14).
--   * rate_limit_hits + consume_rate_limit(): a limiter that holds across serverless
--     instances, unlike the in-memory one (ESC-03 layer 4). Pruned hourly at :53.
--   * profiles: the duplicate-identity review (ESC-24), the payee-name mismatch flag and
--     its staff override (ESC-25), the person-key backfill marker (ESC-15), and the
--     explicit record of which members were grandfathered onto a Connect-reported name
--     at 0069 (ESC-25), backfilled here.

-- ---------------------------------------------------------------------------
-- 1. Risk signals
-- ---------------------------------------------------------------------------
create table if not exists cardtrade.member_risk_signals (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references cardtrade.profiles(id) on delete cascade,
  kind text not null check (kind in ('CARD_FINGERPRINT', 'PAYOUT_ACCOUNT_FINGERPRINT')),
  value_hash text not null,
  created_at timestamptz not null default now(),
  unique (profile_id, kind, value_hash)
);

create index if not exists member_risk_signals_value_idx
  on cardtrade.member_risk_signals (kind, value_hash);

alter table cardtrade.member_risk_signals enable row level security;

create table if not exists cardtrade.blocked_payment_fingerprints (
  value_hash text primary key,
  reason text not null,
  source_dispute_ref text,
  created_at timestamptz not null default now()
);

alter table cardtrade.blocked_payment_fingerprints enable row level security;

-- ---------------------------------------------------------------------------
-- 2. A limiter that survives across instances
-- ---------------------------------------------------------------------------
create table if not exists cardtrade.rate_limit_hits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);

alter table cardtrade.rate_limit_hits enable row level security;

-- One atomic increment per call, in a fixed window. True while the caller is within
-- the limit. The caller fails OPEN on an error, so a database hiccup never blocks a
-- payment; this is a brake on bursts, not the gate.
create or replace function cardtrade.consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_window timestamptz;
  v_count integer;
begin
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into cardtrade.rate_limit_hits (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start)
  do update set count = cardtrade.rate_limit_hits.count + 1
  returning count into v_count;
  return v_count <= p_limit;
end;
$function$;

create or replace function cardtrade.prune_rate_limits()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_deleted integer;
begin
  delete from cardtrade.rate_limit_hits where window_start < now() - interval '1 day';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Profile review columns (service role only)
-- ---------------------------------------------------------------------------
alter table cardtrade.profiles
  add column if not exists identity_duplicate_of uuid references cardtrade.profiles(id),
  add column if not exists identity_duplicate_approved_by uuid references cardtrade.profiles(id),
  add column if not exists identity_duplicate_approved_at timestamptz,
  add column if not exists payee_identity_mismatch_at timestamptz,
  add column if not exists payee_mismatch_cleared_by uuid references cardtrade.profiles(id),
  add column if not exists payee_mismatch_cleared_at timestamptz,
  add column if not exists payee_mismatch_cleared_pair text,
  add column if not exists payee_name_unavailable_logged_at timestamptz,
  add column if not exists identity_keys_missing_at timestamptz,
  add column if not exists identity_grandfathered_at timestamptz;

-- The members 0069 carried over on a Connect-reported name: verified, no document
-- name on file, and never opened an Identity session. Recorded explicitly so the
-- disclosure fallback applies to them and to nobody else.
update cardtrade.profiles
set identity_grandfathered_at = now()
where identity_check_status = 'VERIFIED'
  and identity_check_name is null
  and identity_check_session_id is null
  and identity_grandfathered_at is null;

-- ---------------------------------------------------------------------------
-- 4. Schedule
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'cardtrade_prune_rate_limits') then
    perform cron.unschedule('cardtrade_prune_rate_limits');
  end if;
  perform cron.schedule(
    'cardtrade_prune_rate_limits',
    '53 * * * *',
    $job$ select cardtrade.prune_rate_limits(); $job$
  );
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants (last). Nothing here is member-readable or member-executable.
-- ---------------------------------------------------------------------------
revoke all on table cardtrade.member_risk_signals from public, anon, authenticated;
revoke all on table cardtrade.blocked_payment_fingerprints from public, anon, authenticated;
revoke all on table cardtrade.rate_limit_hits from public, anon, authenticated;
grant all on table cardtrade.member_risk_signals to service_role;
grant all on table cardtrade.blocked_payment_fingerprints to service_role;
grant all on table cardtrade.rate_limit_hits to service_role;
revoke all on function cardtrade.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function cardtrade.consume_rate_limit(text, integer, integer) to service_role;
revoke all on function cardtrade.prune_rate_limits() from public, anon, authenticated;
grant execute on function cardtrade.prune_rate_limits() to service_role;
