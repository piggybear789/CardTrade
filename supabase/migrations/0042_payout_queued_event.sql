-- 0042_payout_queued_event.sql
--
-- Record a persisted event when a Seller release is queued (Req 5.5).
--
-- WHY. The Transfer_History shows one entry per state change of one release, so a
-- release that is owed but not yet sent needs a recorded moment. Without it the
-- history can only ever show terminal states, and a Member whose money is queued
-- sees nothing at all until it settles or fails.
--
-- WHY IN SQL RATHER THAN THE ORCHESTRATOR. A release is queued from two places:
-- `payoutCashSaleSeller` in the orchestrator, and the auto-complete cron, which
-- calls this function directly in SQL and cannot call TypeScript. This function
-- is the single choke point, so recording the event here covers both paths and
-- cannot drift between them.
--
-- IDEMPOTENCY IS PRESERVED. The insert sits inside the `if v_status is not null`
-- branch, which only runs when the UPDATE actually transitioned a NOT_DUE row. A
-- repeat call is still a no-op and still returns the current status, so the
-- guarantee `payoutCashSaleSeller` relies on is unchanged.

create or replace function cardtrade.mark_cash_sale_payout_due(p_cash_sale_id uuid)
returns cardtrade.cash_sale_payout_status
language plpgsql
security definer
set search_path to 'cardtrade', 'pg_temp'
as $function$
declare
  v_status cardtrade.cash_sale_payout_status;
  v_net bigint;
begin
  update cardtrade.cash_sales
  set seller_payout_status = 'PENDING',
      seller_payout_due_at = coalesce(seller_payout_due_at, now()),
      seller_payout_nonce = coalesce(seller_payout_nonce, 'payout:' || id::text),
      updated_at = now()
  where id = p_cash_sale_id
    and status = 'COMPLETED'
    and seller_payout_status = 'NOT_DUE'
  returning seller_payout_status,
            greatest(amount_cents - platform_fee_cents, 0)
    into v_status, v_net;

  if v_status is not null then
    -- Only on a real transition, so the history gets exactly one queued entry per
    -- release. `actor_id` is null: the platform queued this, not a person.
    insert into cardtrade.cash_sale_events (
      cash_sale_id, actor_id, event, from_status, to_status, detail
    )
    values (
      p_cash_sale_id,
      null,
      'SELLER_PAYOUT_QUEUED',
      'COMPLETED',
      'COMPLETED',
      v_net::text
    );
  else
    select seller_payout_status into v_status
    from cardtrade.cash_sales where id = p_cash_sale_id;
  end if;

  return v_status;
end;
$function$;

comment on function cardtrade.mark_cash_sale_payout_due is
  'Queues the Seller release for a COMPLETED Cash_Sale, assigning a stable '
  'idempotency nonce and recording a SELLER_PAYOUT_QUEUED event carrying the '
  'Seller_Net in cents. Safe to call repeatedly; only NOT_DUE transitions, and '
  'only a real transition records an event.';
