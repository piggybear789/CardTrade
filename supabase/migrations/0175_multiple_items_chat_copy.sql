-- 0175_multiple_items_chat_copy.sql
--
-- "A listing with multiple items" replaces "binder or bulk listing" in the chat
-- transcript.
--
-- The member-facing name for a SHOPFRONT listing is now "Multiple items" everywhere
-- (the listing form, the catalog tile, the meta line, My listings, the trade
-- surfaces), so the two sentences `describe_cash_sale_event` writes for a contract
-- opened against one are reworded to match.
--
-- The chat transcript is WRITTEN rather than rendered: the system lines the contract
-- chat mirrors from `cash_sale_events` are stored in `messages.body`, so the rows 0119
-- and 0133 already wrote are rewritten from the same function. The function's rule,
-- that replacing it must reproduce every branch, is honoured: this is 0134's
-- definition verbatim, except the two named sentences:
--
--   AGREEMENT_CREATED (shopfront): "... for a listing with multiple items. Nothing in
--     the listing is held, and no money has moved yet."
--   PAYMENT_FAILED (shopfront): "The payment failed. This contract did not proceed.
--     The listing remains open, and nothing from it was held."
--
-- `components/messages/MessageLog.tsx` rewrites the older wordings at display time too,
-- for any row this backfill does not reach.
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
    when 'AGREEMENT_CREATED' then
      case when coalesce(p_from_shopfront, false) then
        v_who || ' started this purchase contract for a listing with multiple items. '
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
    -- ESC-03 (WP2): an abandoned 3-D Secure challenge was cancelled at the provider.
    when 'PAYMENT_ABANDONED' then
      'The payment wasn''t completed, so nothing was charged. The buyer can pay again from this contract.'
    -- ESC-14 (WP2): neutral on purpose. The reason is never shown to either party.
    when 'REFUNDED_BEFORE_SHIPMENT' then
      'The payment was refunded and the sale cancelled.'
    -- ESC-20 (WP2): the in-person window, named from the pinned constant.
    when 'IN_PERSON_INSPECTION_STARTED' then
      'The buyer has ' || cardtrade.in_person_inspection_hours()::text
      || ' hours to check the item and raise a problem before the seller is paid.'
    when 'PAYMENT_FAILED' then
      case when coalesce(p_from_shopfront, false) then
        'The payment failed. This contract did not proceed. The listing remains open, and nothing from it was held.'
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
    -- ESC-02. The detail is a reason code, never member text, so it is not printed.
    when 'TRACKING_FLAGGED' then
      'The tracking shows this parcel as delivered before it could have been sent for '
      || 'this sale, so support is checking it before the buyer''s inspection starts. '
      || 'The buyer can report a problem at any time.'
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
    when 'INSPECTION_EXPIRED' then
      'The inspection window closed with no action from the buyer, so the contract completed automatically.'
    when 'BOTH_RECEIVED' then
      'Both parties confirmed the exchange.'
    when 'HANDOVER_FAILED' then
      v_who || ' reported that the handover did not happen' ||
      case when p_detail is null then '.' else ': ' || p_detail end
    when 'HANDOVER_ASSUMED' then
      'The handover was taken as done — neither party reported a problem before the deadline.'
    when 'DISPUTE_RESOLVED' then
      'Support reviewed the dispute and made a decision' ||
      case when p_detail is null then '.' else ': ' || p_detail end
    when 'FRAUD_CONFIRMED' then
      'Support confirmed fraud on this contract and closed it.'
    when 'DISPUTE_REFUND_FAILED' then
      'The refund could not be processed. The dispute stays open and support has been notified.'
    -- Codes that were written without copy until the 0134 coverage guard found them.
    -- Their details are machine strings, so none of them is printed.
    when 'CONTENTS_PROPOSED' then
      v_who || ' updated the items this contract covers.'
    when 'DISPUTE_REFUND_REVERSED' then
      'The bank returned the refund, so the dispute has been reopened for support.'
    when 'DISPUTE_RESOLVED_REFUND_BUYER' then
      'Support decided the dispute in the buyer''s favour. The buyer is being refunded in full.'
    when 'DISPUTE_RESOLVED_PARTIAL_REFUND' then
      'Support decided the dispute with a partial refund to the buyer. The rest goes to the seller.'
    when 'DISPUTE_RESOLVED_RELEASE_SELLER' then
      'Support decided the dispute in the seller''s favour. The payment is being released to the seller.'
    when 'RETURN_DELIVERED' then
      'The carrier confirmed the return reached the seller. The seller has 3 days to check it, then the buyer is refunded automatically.'
    when 'TRACKING_FLAG_RESOLVED' then
      'Support checked the tracking and made a decision.'
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
    when 'SELLER_PAYOUT_QUEUED' then
      'The seller''s payout has been queued.'
    when 'SELLER_PAYOUT_SETTLED' then
      'The seller''s payout has been paid.'
    when 'SELLER_PAYOUT_FAILED' then
      'The seller''s payout could not be sent.'
    else
      'The contract was updated.'
  end;
end;
$$;

comment on function cardtrade.describe_cash_sale_event(text, text, text, text, boolean) is
  'Human-readable Cash_Sale event copy with fulfillment-aware and multiple-item-listing-aware wording. Replacing this function must reproduce every branch.';

-- Rewrite the two lines already in transcripts, from the same function and with the
-- same joins the 0116, 0119 and 0133 backfills used, so old and new contracts read
-- alike. Scoped to the two events whose wording changed, and to contracts opened
-- against a listing with multiple items: the single-listing sentences are untouched.
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