-- 0090_return_refund_queuing_fix.sql
--
-- FIXES A BUG THAT WOULD HAVE TAKEN A BUYER'S MONEY AND TOLD THEM IT WAS REFUNDED.
--
-- `mark_cash_sale_refund_due` (0044) guards on `status = 'DISPUTED'`, which was the
-- only state a refund could be owed from when it was written. 0088 introduced a second
-- one: `apply_cash_sale_return_tracking` queues the refund when a carrier confirms the
-- returned goods arrived, and at that moment the sale is RETURN_IN_TRANSIT.
--
-- So the UPDATE matched nothing. `refund_status` stayed NOT_DUE, no `refund_nonce` was
-- assigned, and the refund drain — which selects on `refund_status IN ('PENDING',
-- 'FAILED')` — had nothing to find. Meanwhile `finalizeReturnedCashSale` moved the sale
-- to REFUNDED and relisted the item, and the event row said "The refund is queued".
--
-- The buyer would have posted their goods back, watched the contract say Refunded, and
-- never been paid. Nothing would have alerted anyone, because every row looked correct.
--
-- WHY THE TESTS DID NOT CATCH IT. The unit suite fakes the repository, and the fake's
-- `markRefundDue` carries the same DISPUTED guard, faithfully reproducing the bug. The
-- return-flow test then stamped `returnCarrierDeliveredAt` directly to simulate the
-- carrier, bypassing this function altogether. Both copies agreed, so 522 tests passed
-- against behaviour that does not pay people. A guard is added below the fix.

create or replace function cardtrade.mark_cash_sale_refund_due(
  p_cash_sale_id uuid,
  p_amount_cents bigint
)
returns cardtrade.cash_sale_payout_status
language plpgsql
security definer
set search_path to 'cardtrade', 'pg_temp'
as $function$
declare
  v_status cardtrade.cash_sale_payout_status;
begin
  update cardtrade.cash_sales
  set refund_status = 'PENDING',
      refund_cents = p_amount_cents,
      -- COALESCE, not assignment: a retry must reuse the nonce it already has, because
      -- the provider deduplicates on it. Regenerating would authorise a second refund.
      refund_nonce = coalesce(refund_nonce, 'refund:' || id::text),
      updated_at = now()
  where id = p_cash_sale_id
    -- TWO STATES OWE A REFUND, not one. DISPUTED is the operator deciding directly;
    -- RETURN_IN_TRANSIT is the carrier confirming the goods came back, which is the
    -- same decision with its condition finally met. RETURN_PENDING is included for
    -- completeness — `apply_cash_sale_return_tracking` accepts a delivery event from
    -- it, and a refund queued there is still owed.
    and status in ('DISPUTED', 'RETURN_PENDING', 'RETURN_IN_TRANSIT')
    -- Unchanged, and the real idempotency guard: NOT_DUE means no refund has ever been
    -- queued for this sale, so this cannot queue a second one.
    and refund_status = 'NOT_DUE'
  returning refund_status into v_status;

  if v_status is null then
    select refund_status into v_status
    from cardtrade.cash_sales where id = p_cash_sale_id;
  end if;

  return v_status;
end;
$function$;

comment on function cardtrade.mark_cash_sale_refund_due(uuid, bigint) is
  'Queue a refund owed to the buyer, idempotently. Callable from DISPUTED (operator '
  'decision) and from the return states (0088, carrier confirmed the goods came back). '
  'The NOT_DUE guard is what makes it safe to call twice; the nonce is reused, never '
  'regenerated, because the provider deduplicates on it.';

-- A late return is still a return.
--
-- 0089 said the lapse marker "clears itself if the buyer posts late" and nothing
-- implemented that, so a case that resolved on its own would have sat in the
-- arbitration queue permanently, sending staff to look at settled cases.
create or replace function cardtrade.clear_cash_sale_return_lapse(p_cash_sale_id uuid)
returns void
language sql
security definer
set search_path to 'cardtrade', 'pg_temp'
as $function$
  update cardtrade.cash_sales
  set return_lapsed_at = null, updated_at = now()
  where id = p_cash_sale_id and return_lapsed_at is not null;
$function$;

comment on function cardtrade.clear_cash_sale_return_lapse(uuid) is
  'Drop the lapse triage flag once the buyer posts the return after all. Keeps a '
  'self-resolving case out of the arbitration queue.';

revoke all on function cardtrade.mark_cash_sale_refund_due(uuid, bigint) from public;
revoke all on function cardtrade.clear_cash_sale_return_lapse(uuid) from public;
