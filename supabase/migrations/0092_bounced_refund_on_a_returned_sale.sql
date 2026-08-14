-- 0092_bounced_refund_on_a_returned_sale.sql
--
-- A BOUNCED REFUND ON A RETURNED SALE DEMANDED THE GOODS BACK A SECOND TIME.
--
-- `record_cash_sale_refund_failure` (0045) reopens a bounced FULL refund: it reverts the
-- sale to DISPUTED, clears the resolution, clears `refund_cents` and `refund_nonce`, and
-- re-reserves the item. That is right for the case it was written for — the refund WAS
-- the whole remedy, it failed, so the case needs deciding again and the goods never moved.
--
-- Return-conditional refunds (0088) broke that assumption. A finalised return leaves
-- exactly the state the reopen looks for — status REFUNDED, dispute_resolution
-- REFUND_BUYER, no seller payout — but the goods have physically travelled back to the
-- seller and the listing was legitimately restored. Reopening then does four harmful
-- things at once:
--
--   1. Re-reserves an item the seller is holding, pulling their live listing out of the
--      catalog with nothing to explain it.
--   2. Leaves every return_ column set, so `returnRequiredForRefund` still answers true.
--      An operator resolving REFUND_BUYER again therefore enters RETURN_PENDING and asks
--      the buyer to post back goods they have already posted back and no longer own.
--   3. Zeroes refund_cents and drops the nonce, which takes the sale OUT of the refund
--      drain's query (refund_cents > 0). The buyer's money stops being retried at all.
--   4. Discards the operator's finding, which nothing about a failed bank transfer
--      contradicts.
--
-- The net effect is a buyer with no money, no automatic retry, and a demand for a second
-- return — with every column looking plausible. It is the same failure shape as the
-- refund-queuing bug fixed in 0090: a guard written when one state could reach it, later
-- reached by another.
--
-- THE RULE. Once goods have come back, the FINDING stands and only the PAYMENT failed, so
-- the sale stays REFUNDED and the refund stays retryable. Reopening is reserved for the
-- case where nothing physical has moved.

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
  v_returned boolean := false;
begin
  select * into v_sale from cardtrade.cash_sales where id = p_cash_sale_id;
  if v_sale.id is null then
    return null;
  end if;

  if v_sale.refund_status = 'FAILED' then
    return v_sale.status;
  end if;

  -- Did this sale settle through a RETURN? Keyed on the carrier confirmation rather than
  -- on the status, because that is the fact that matters: a carrier said the goods
  -- reached the seller, which is why the item was relisted in the first place.
  v_returned := v_sale.return_carrier_delivered_at is not null;

  v_reopened := v_sale.status = 'REFUNDED'
    and v_sale.dispute_resolution = 'REFUND_BUYER'
    and v_sale.seller_payout_status <> 'SETTLED'
    -- NEVER reopen a sale whose goods came back. See the header.
    and not v_returned;

  update cardtrade.cash_sales
  set refund_error = coalesce(p_reason, 'The refund was returned by the bank'),
      dispute_resolution = case when v_reopened then null else dispute_resolution end,
      dispute_resolved_at = case when v_reopened then null else dispute_resolved_at end,
      dispute_resolved_by = case when v_reopened then null else dispute_resolved_by end,
      refund_cents = case when v_reopened then 0 else refund_cents end,
      refund_nonce = case when v_reopened then null else refund_nonce end,
      refund_status = case when v_reopened then 'NOT_DUE'::cardtrade.cash_sale_payout_status else 'FAILED'::cardtrade.cash_sale_payout_status end,
      status = case when v_reopened then 'DISPUTED'::cardtrade.cash_sale_status else status end,
      updated_at = now()
  where id = p_cash_sale_id;

  if v_reopened then
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
    p_cash_sale_id, null,
    -- Named distinctly so the timeline does not claim a dispute is in play on a sale
    -- that is settled and merely awaiting a working payment.
    case when v_returned then 'RETURN_REFUND_FAILED' else 'DISPUTE_REFUND_FAILED' end,
    v_sale.status, v_sale.status,
    coalesce(
      p_reason,
      case
        when v_returned
          then 'The refund was returned by the bank. The item has already come back to the seller, so the refund is retried rather than the case reopened.'
        else 'The refund was returned by the bank'
      end
    )
  );

  return v_sale.status;
end;
$function$;

comment on function cardtrade.record_cash_sale_refund_failure(uuid, text) is
  'Record a bounced refund. Reopens a full refund to DISPUTED so it can be decided '
  'again - EXCEPT on a sale whose goods already came back (0088), where the finding '
  'stands, the item stays listed, and the refund stays retryable by the drain. Never '
  'reopens a partial refund, because the buyer kept the item.';
