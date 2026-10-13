-- 0138_payout_release_policy.sql
--
-- ESC-03 (Critical) / ESC-14 / ESC-20: money left the platform faster than fraud can be
-- detected. A COMPLETED cash sale was paid out on the next hourly drain, and an
-- in-person sale paid out INLINE on the second "handover confirmed" tap, so a seller
-- paid with a stolen card (by their own second account) was cashed out in seconds and
-- the chargeback landed on the platform weeks later. Nothing held a payout while a
-- chargeback was open.
--
-- The rule lives in TypeScript (`domain/payouts/releasePolicy.ts`, the ONE holdback
-- rule); this migration gives it somewhere to record its answer:
--
--   * `seller_payout_release_at` — when a deferred payout may next move. The drain
--     skips the sale until then and spends no attempt on it.
--   * `seller_payout_hold_reason` — CHARGE_DISPUTE / FRAUD_WARNING / STAFF: held
--     outright until cleared.
--   * `fraud_warning_received_at` — a Radar early-fraud warning arrived for the
--     sale's charge.
--
-- And it gives the in-person cash sale a buyer inspection window before the money
-- moves (ESC-20): `in_person_inspection_hours()` is pinned to
-- `IN_PERSON_INSPECTION_HOURS` by `tests/unit/tradeClockAgreement.test.ts`.

alter table cardtrade.cash_sales
  add column if not exists seller_payout_release_at timestamptz,
  add column if not exists seller_payout_hold_reason text,
  add column if not exists fraud_warning_received_at timestamptz;

alter table cardtrade.cash_sales
  drop constraint if exists cash_sales_seller_payout_hold_reason_check;
alter table cardtrade.cash_sales
  add constraint cash_sales_seller_payout_hold_reason_check
  check (seller_payout_hold_reason is null
    or seller_payout_hold_reason in ('CHARGE_DISPUTE', 'FRAUD_WARNING', 'STAFF'));

-- ESC-03 layer 2: one idempotency key per payment ATTEMPT. The old key was fixed per
-- terms version, so a re-pay after an abandoned 3-D Secure challenge replayed the
-- provider's cached, cancelled intent. Server-only: no member grant.
alter table cardtrade.cash_sales
  add column if not exists payment_attempt integer not null default 0;

-- ESC-03 layer 1 / ESC-14: staff's per-seller exposure override, and the mark left
-- on a buyer whose chargeback was lost as fraud. Both service-role only.
alter table cardtrade.profiles
  add column if not exists exposure_limit_override_minor bigint,
  add column if not exists buyer_risk_flagged_at timestamptz;

alter table cardtrade.profiles
  drop constraint if exists profiles_exposure_limit_override_minor_check;
alter table cardtrade.profiles
  add constraint profiles_exposure_limit_override_minor_check
  check (exposure_limit_override_minor is null or exposure_limit_override_minor >= 0);

create index if not exists cash_sales_payout_release_idx
  on cardtrade.cash_sales (seller_payout_status, seller_payout_release_at)
  where status = 'COMPLETED';

-- The in-person buyer inspection window, in hours (ESC-20).
create or replace function cardtrade.in_person_inspection_hours()
returns integer
language sql
immutable
set search_path to 'cardtrade', 'pg_temp'
as $function$ select 24 $function$;

-- Grants last. Members may READ when their payout releases and why it is held (the
-- room and the payouts dashboard say so); nothing here is member-writable.
revoke all on function cardtrade.in_person_inspection_hours() from public, anon;
grant execute on function cardtrade.in_person_inspection_hours() to authenticated, service_role;
grant select (seller_payout_release_at, seller_payout_hold_reason) on cardtrade.cash_sales to authenticated;
