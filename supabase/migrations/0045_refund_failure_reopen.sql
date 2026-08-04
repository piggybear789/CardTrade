-- 0045_refund_failure_reopen.sql
--
-- Handle a dispute refund that failed AFTER being accepted (Req 4.15).
--
-- WHY THIS IS NEEDED. `refundPayment` reports SETTLED for a Stripe refund in
-- `pending` as well as `succeeded`, because card refunds normally settle
-- asynchronously and treating `pending` as a failure would make an operator retry a
-- refund already on its way. The cost of that decision is this path: a refund can
-- still fail at the bank days later (a closed card account, most often), and
-- without handling it the sale would sit at REFUNDED while the money was never
-- actually returned — the platform holding funds it believes it has sent.
--
-- THE REOPEN IS CONDITIONAL, and the condition is what makes this safe:
--
--   * A FULL refund (status REFUNDED, no seller release) is fully reversible. The
--     sale returns to DISPUTED, the resolution is cleared, and the item is pulled
--     back out of the catalog so it cannot be sold twice. An operator resolves it
--     again.
--   * A PARTIAL refund completed the sale and may already have released the
--     remainder to the Seller. Reversing that would mean clawing back a settled
--     transfer, which this function will not silently attempt. The refund is marked
--     FAILED so it surfaces in the admin console, and the sale is left alone for an
--     operator to handle deliberately.
--
-- Idempotent: re-delivery of the same failure finds `refund_status` already FAILED
-- and changes nothing.

create or replace function cardtrade.record_cash_sale_refund_failure(
  p_cash_sale_id uuid,
  p_reason text default null
)
returns cardtrade.cash_sale_status
language plpgsql
security definer
set search_path to 'cardtrade', 'pg_temp'
as $function$
declare
  v_sale cardtrade.cash_sales;
  v_reopened boolean := false;
begin
  select * into v_sale from cardtrade.cash_sales where id = p_cash_sale_id;
  if v_sale.id is null then
    return null;
  end if;

  -- Already recorded: nothing to do.
  if v_sale.refund_status = 'FAILED' then
    return v_sale.status;
  end if;

  -- Fully reversible only when the refund was the whole resolution and no money has
  -- since gone the other way.
  v_reopened := v_sale.status = 'REFUNDED'
    and v_sale.dispute_resolution = 'REFUND_BUYER'
    and v_sale.seller_payout_status <> 'SETTLED';

  update cardtrade.cash_sales
  set refund_status = 'FAILED',
      refund_error = coalesce(p_reason, 'The refund was returned by the bank'),
      -- Clear the decision only when reopening, so the sale genuinely needs
      -- deciding again rather than looking resolved with no money moved.
      dispute_resolution = case when v_reopened then null else dispute_resolution end,
      dispute_resolved_at = case when v_reopened then null else dispute_resolved_at end,
      dispute_resolved_by = case when v_reopened then null else dispute_resolved_by end,
      refund_cents = case when v_reopened then 0 else refund_cents end,
      -- A reopened refund must be re-queueable, which means releasing the nonce so
      -- the next attempt is a genuinely new refund rather than a deduplicated
      -- replay of the one that failed.
      refund_nonce = case when v_reopened then null else refund_nonce end,
      refund_status = case when v_reopened then 'NOT_DUE' else 'FAILED' end,
      status = case when v_reopened then 'DISPUTED' else status end,
      updated_at = now()
  where id = p_cash_sale_id;

  if v_reopened then
    -- Pull the item back out of the catalog: the sale is live again, so it must not
    -- be available for someone else to buy.
    update cardtrade.items
    set status = 'RESERVED'
    where id = v_sale.item_id and status = 'AVAILABLE';

    insert into cardtrade.cash_sale_events (
      cash_sale_id, actor_id, event, from_status, to_status, detail
    )
    values (
      p_cash_sale_id, null, 'DISPUTE_REFUND_REVERSED', 'REFUNDED', 'DISPUTED',
      coalesce(p_reason, 'The refund was returned by the bank')
    );

    return 'DISPUTED'::cardtrade.cash_sale_status;
  end if;

  insert into cardtrade.cash_sale_events (
    cash_sale_id, actor_id, event, from_status, to_status, detail
  )
  values (
    p_cash_sale_id, null, 'DISPUTE_REFUND_FAILED', v_sale.status, v_sale.status,
    coalesce(p_reason, 'The refund was returned by the bank')
  );

  return v_sale.status;
end;
$function$;

comment on function cardtrade.record_cash_sale_refund_failure is
  'Records a dispute refund that failed after acceptance. A full refund with no '
  'settled seller release is reopened to DISPUTED with the nonce released so it '
  'can be retried; a partial refund is only flagged, because reversing it would '
  'mean clawing back a settled transfer.';
