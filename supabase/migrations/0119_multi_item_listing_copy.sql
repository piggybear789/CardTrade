-- 0119_multi_item_listing_copy.sql
--
-- "Binder" leaves the member-facing vocabulary.
--
-- A SHOPFRONT listing (0064) is a browsable inventory — several items, from which each
-- buyer names the ones they want. The product called that a "binder", after the ring
-- binder a card collector keeps their trade stock in. The word does not travel: a
-- collection of graded slabs, a sealed-product lot or a box of sports cards is not a
-- binder, and to anyone outside the hobby the word describes stationery. The listing
-- form already calls the choice "Multiple items"; every other surface now says the same
-- thing, and prose calls it a "multi-item listing".
--
-- The chat transcript is the one place that copy is WRITTEN rather than rendered:
-- `describe_cash_sale_event` (0113, 0116) composes the system lines the contract chat
-- mirrors from `cash_sale_events`, and two of its branches said "binder or bulk
-- listing". Both are reworded here, and the rows those branches already wrote are
-- rewritten from the same function so a transcript reads the same whichever side of
-- this migration it was opened on. The function's rule — replacing it must reproduce
-- every branch — is honoured: every branch below is 0116's, verbatim, except the two
-- named sentences.

create or replace function cardtrade.describe_cash_sale_event(
  p_event text,
  p_detail text,
  p_actor_name text,
  p_fulfillment_method text,
  p_from_shopfront boolean
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_who text := coalesce(nullif(btrim(p_actor_name), ''), 'A participant');
begin
  return case p_event
    -- ---------------------------------------------------------------- 0113 ----
    -- THE FIRST REWORDED SENTENCE (0119): "binder or bulk listing" -> "multi-item listing".
    when 'AGREEMENT_CREATED' then
      case when coalesce(p_from_shopfront, false) then
        v_who || ' started this purchase contract for a multi-item listing. '
        || 'Nothing in the listing is held, and no money has moved yet.'
      else
        v_who || ' started this purchase contract and reserved the item. No money has moved yet.'
      end
    when 'TERMS_UPDATED' then
      v_who || ' updated the fulfillment terms' ||
      case when p_detail is null then '' else ' — ' || p_detail end || '.'
    when 'PRICE_PROPOSED' then
      v_who || ' updated the price' ||
      case when p_detail is null then '' else ' — ' || p_detail end || '.'
    when 'TERMS_ACCEPTED' then
      v_who || ' continued to payment.'
    when 'PAYMENT_REQUESTED' then
      v_who || ' started payment.'
    when 'PAYMENT_CLEARED' then
      case upper(coalesce(p_fulfillment_method, ''))
        when 'DELIVERY' then
          'Payment confirmed. The seller can now ship the item.'
        when 'IN_PERSON' then
          'Payment confirmed. The seller can now complete the agreed in-person handover.'
        else
          'Payment confirmed. The seller can now continue with the agreed fulfillment method.'
      end
    -- THE SECOND REWORDED SENTENCE (0119).
    when 'PAYMENT_FAILED' then
      case when coalesce(p_from_shopfront, false) then
        'The payment failed. This contract did not proceed. The multi-item listing remains open, and nothing from it was held.'
      else
        'The payment failed. The item has returned to the catalogue.'
      end
    when 'SHIPMENT_RECORDED' then
      v_who || ' marked the item as shipped' ||
      case when p_detail is null then '' else ' — ' || p_detail end || '.'
    when 'SHIPPED' then
      v_who || ' marked the item as shipped' ||
      case when p_detail is null then '' else ' — ' || p_detail end || '.'
    when 'CARRIER_DELIVERED' then
      coalesce(p_detail, 'The carrier confirmed delivery.')
    when 'RECEIPT_RECORDED' then
      v_who || ' confirmed the item arrived. Inspection has started.'
    when 'RECEIVED' then
      v_who || ' confirmed the item arrived. Inspection has started.'
    when 'INSPECTION_ACCEPTED' then
      v_who || ' completed the purchase. The contract is complete.'
    when 'HANDOVER_CONFIRMED' then
      v_who || ' confirmed the handover happened.'
    when 'AUTO_COMPLETED' then
      'The contract completed automatically' ||
      case when p_detail is null then '' else ': ' || p_detail end
    when 'CANCELLED' then
      v_who || ' cancelled the contract' ||
      case when p_detail is null then '. ' else ': ' || p_detail || ' ' end ||
      'No money changed hands.'
    when 'DISPUTE_RAISED' then
      v_who || ' raised a dispute' ||
      case when p_detail is null then '' else ': ' || p_detail end
    when 'DISPUTE_WITHDRAWN' then
      v_who || ' withdrew their dispute, so the contract carries on from where it left '
      || 'off. No money moved, and the record of the dispute stays on the contract.'
    when 'DISPUTE_SETTLED_BY_PARTY' then
      v_who || ' settled the dispute directly' ||
      case when p_detail is null then '' else ': ' || p_detail end ||
      ' No arbitrator was involved.'
    when 'LEGACY_CONTRACT_CLOSED' then
      'This contract was closed during a system migration.'

    -- ---------------------------------------------------------------- 0116 ----
    -- Inspection window
    when 'INSPECTION_EXPIRED' then
      'The inspection window closed with no action from the buyer, so the contract completed automatically.'
    when 'BOTH_RECEIVED' then
      'Both parties confirmed the exchange.'

    -- In-person handover
    when 'HANDOVER_FAILED' then
      v_who || ' reported that the handover did not happen' ||
      case when p_detail is null then '.' else ': ' || p_detail end
    when 'HANDOVER_ASSUMED' then
      'The handover was taken as done — neither party reported a problem before the deadline.'

    -- Staff decisions on a dispute
    when 'DISPUTE_RESOLVED' then
      'Support reviewed the dispute and made a decision' ||
      case when p_detail is null then '.' else ': ' || p_detail end
    when 'FRAUD_CONFIRMED' then
      'Support confirmed fraud on this contract and closed it.'
    when 'DISPUTE_REFUND_FAILED' then
      'The refund could not be processed. The dispute stays open and support has been notified.'

    -- Return flow (0088). The orchestrator writes these details as sentences.
    when 'RETURN_REQUIRED' then
      coalesce(p_detail, 'The item must be returned before the refund is released.')
    when 'RETURN_SHIPPED' then
      v_who || ' posted the item back' ||
      case when p_detail is null then '.' else ' — ' || p_detail || '.' end
    when 'RETURN_COMPLETED' then
      coalesce(p_detail, 'The return arrived. The refund has been released.')
    when 'RETURN_DISPUTED' then
      v_who || ' contested the return' ||
      case when p_detail is null then '.' else ': ' || p_detail end
    when 'RETURN_REFUND_FAILED' then
      'The refund for the return could not be processed. Support has been notified.'
    when 'RETURN_CASE_RESOLVED_REFUND_BUYER' then
      'Support decided the return case in the buyer''s favour. The refund has been released.'
    when 'RETURN_CASE_RESOLVED_RELEASE_SELLER' then
      coalesce(p_detail, 'Support decided the return case in the seller''s favour. The proceeds have been released.')

    -- Payout events never reach the chat (see the 0116 mirror trigger), but the copy
    -- function is called from other places too, so they still describe themselves.
    when 'SELLER_PAYOUT_QUEUED' then
      'The seller''s payout has been queued.'
    when 'SELLER_PAYOUT_SETTLED' then
      'The seller''s payout has been paid.'
    when 'SELLER_PAYOUT_FAILED' then
      'The seller''s payout could not be sent.'

    else
      -- No `detail` here. See 0116: an unknown code has an unknown detail shape, and
      -- the fallback once printed a cents figure as prose.
      'The contract was updated.'
  end;
end;
$$;

comment on function cardtrade.describe_cash_sale_event(text, text, text, text, boolean) is
  'Human-readable Cash_Sale event copy with fulfillment and multi-item-listing-aware wording. Replacing this function must reproduce every branch.';

-- Rewrite the two lines already in transcripts, from the same function and with the
-- same joins the 0116 backfill used, so old and new contracts read alike. Scoped to
-- the two events whose wording changed, and to contracts opened against a multi-item
-- listing — the single-listing sentences are untouched and need no rewrite.
update cardtrade.messages m
set body = left(cardtrade.describe_cash_sale_event(
  e.event,
  e.detail,
  p.display_name,
  s.fulfillment_method::text,
  s.from_shopfront
), 4000)
from cardtrade.cash_sale_events e
join cardtrade.cash_sales s on s.id = e.cash_sale_id
left join cardtrade.profiles p on p.id = e.actor_id
where m.kind = 'SYSTEM'
  and m.cash_sale_id = e.cash_sale_id
  and m.system_event = e.event
  and m.created_at = e.created_at
  and s.from_shopfront
  and m.system_event in ('AGREEMENT_CREATED', 'PAYMENT_FAILED');
