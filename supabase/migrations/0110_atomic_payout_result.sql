-- 0110_atomic_payout_result.sql
--
-- Recording the outcome of a release or a refund becomes one atomic statement.
--
-- WHAT WAS WRONG. `recordPayoutResult` and `recordRefundResult` each did a read, then a
-- write built from what they read:
--
--     const current = await selectSale(client, id);
--     ...
--     seller_payout_attempts: (current?.sellerPayoutAttempts ?? 0) + 1,
--
-- and the drain that calls them takes no lock. `listDuePayouts` is a plain SELECT with
-- no `for update skip locked` and no claim column, which makes it the outlier in this
-- schema — `auto_complete_due_cash_sales`, `apply_cash_sale_return_tracking` and
-- `create_cash_sale_agreement` all lock. So two passes CAN hold the same row: the hourly
-- cron overlapping the admin console's manual drain, or two regional passes.
--
-- Two things then go wrong, and only one of them is harmless.
--
--   * The attempt counter undercounts. Both passes read 3 and both write 4, so a release
--     that keeps failing never reaches MAX_PAYOUT_ATTEMPTS and retries forever.
--
--   * A settled release can be overwritten as FAILED. Pass A succeeds and writes
--     SETTLED; pass B, which read before A wrote, finishes and writes FAILED. Stripe's
--     idempotency key means the seller was paid exactly once — but the row now says they
--     were not, so the drain keeps picking it up, burns its attempts, and finally rests
--     on FAILED against money that is already gone. Nothing reconciles that back.
--
-- WHY NOT A CLAIM COLUMN. A lease (`claimed_at`, skip anything claimed recently) is the
-- fuller answer and it is a bigger change: a new column, the types that go with it, and a
-- staleness policy that has to be right or a crashed pass strands the row until the lease
-- expires. This closes the damaging half of the race without any of that. Money safety
-- never rested on the drain being single-threaded — it rests on the persisted nonce, and
-- that is now verified against Stripe rather than assumed. What was actually broken was
-- the BOOKKEEPING, and bookkeeping is fixed by making the write self-referential.
--
-- MONOTONIC, like every other money write here. SETTLED is terminal: once the provider
-- has taken the money, no later attempt may say otherwise.

create or replace function cardtrade.record_cash_sale_payout_result(
  p_cash_sale_id uuid,
  p_status cardtrade.cash_sale_payout_status,
  p_transfer_ref text default null,
  p_error text default null
)
returns setof cardtrade.cash_sales
language plpgsql
security definer
set search_path to 'cardtrade', 'pg_temp'
as $function$
begin
  return query
  update cardtrade.cash_sales
  set
    -- SETTLED wins and stays won. A late FAILED from a superseded pass describes an
    -- attempt, not the outcome.
    seller_payout_status =
      case when seller_payout_status = 'SETTLED' then 'SETTLED' else p_status end,
    seller_payout_ref = coalesce(p_transfer_ref, seller_payout_ref),
    seller_payout_at =
      case
        when seller_payout_status = 'SETTLED' then seller_payout_at
        when p_status = 'SETTLED' then now()
        else seller_payout_at
      end,
    seller_payout_error =
      case
        when seller_payout_status = 'SETTLED' then seller_payout_error
        when p_status = 'SETTLED' then null
        else coalesce(p_error, seller_payout_error)
      end,
    -- Self-referential, so concurrent passes each count their own attempt.
    seller_payout_attempts = seller_payout_attempts + 1,
    updated_at = now()
  where id = p_cash_sale_id
  returning *;
end;
$function$;

comment on function cardtrade.record_cash_sale_payout_result is
  'Records one seller-release attempt atomically. SETTLED is terminal and the attempt '
  'counter increments from its own column, so two concurrent drain passes cannot '
  'undercount attempts or overwrite a settled release with a stale failure.';

create or replace function cardtrade.record_cash_sale_refund_result(
  p_cash_sale_id uuid,
  p_status cardtrade.cash_sale_payout_status,
  p_refund_ref text default null,
  p_error text default null
)
returns setof cardtrade.cash_sales
language plpgsql
security definer
set search_path to 'cardtrade', 'pg_temp'
as $function$
begin
  return query
  update cardtrade.cash_sales
  set
    -- Same terminal rule, with one deliberate exception: NOT_DUE. `resolveReturnCase`
    -- stands a queued refund DOWN when the buyer keeps the goods, and that has to be
    -- able to move a row out of SETTLED — it is an operator decision, not a stale
    -- write from a racing pass.
    refund_status =
      case
        when p_status = 'NOT_DUE' then 'NOT_DUE'
        when refund_status = 'SETTLED' then 'SETTLED'
        else p_status
      end,
    refund_ref = coalesce(p_refund_ref, refund_ref),
    refund_error =
      case
        when p_status = 'NOT_DUE' then null
        when refund_status = 'SETTLED' then refund_error
        when p_status = 'SETTLED' then null
        else coalesce(p_error, refund_error)
      end,
    refund_attempts = refund_attempts + 1,
    updated_at = now()
  where id = p_cash_sale_id
  returning *;
end;
$function$;

comment on function cardtrade.record_cash_sale_refund_result is
  'Records one refund attempt atomically. SETTLED is terminal except for an explicit '
  'NOT_DUE stand-down, and the attempt counter increments from its own column.';

revoke all on function cardtrade.record_cash_sale_payout_result(
  uuid, cardtrade.cash_sale_payout_status, text, text
) from public, anon, authenticated;
revoke all on function cardtrade.record_cash_sale_refund_result(
  uuid, cardtrade.cash_sale_payout_status, text, text
) from public, anon, authenticated;
