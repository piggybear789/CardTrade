-- 0098_cash_sale_event_copy_confirm.sql
--
-- Buy-side chat copy must not say "accept". That word is reserved for trades.
-- Buys confirm terms and complete the purchase; the contract thread should say so.
--
-- CREATE OR REPLACE REPRODUCES THE WHOLE FUNCTION. A replace drops omitted
-- branches, so every line from 0084 is carried forward. Diff this against 0084
-- rather than trusting the new sentences alone.

create or replace function cardtrade.describe_cash_sale_event(
  p_event text,
  p_detail text,
  p_actor_name text
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
      v_who || ' started this purchase contract and reserved the item. No money has moved yet.'
    when 'TERMS_UPDATED' then
      v_who || ' proposed new fulfillment terms' ||
      case when p_detail is null then '' else ' — ' || p_detail end ||
      '. Both parties need to confirm again.'
    when 'PRICE_PROPOSED' then
      v_who || ' requested a price change' ||
      case when p_detail is null then '' else ' — ' || p_detail end ||
      '. Both parties need to confirm again.'
    when 'TERMS_ACCEPTED' then
      v_who || ' confirmed the current terms.'
    when 'PAYMENT_REQUESTED' then
      'Both parties confirmed the same terms, so payment was requested.'
    when 'PAYMENT_CLEARED' then
      'Payment confirmed. The seller can now ship or meet.'
    when 'PAYMENT_FAILED' then
      'The payment failed. The item has returned to the catalogue.'
    when 'SHIPMENT_RECORDED' then
      v_who || ' marked the item as shipped' ||
      case when p_detail is null then '' else ' — ' || p_detail end || '.'
    when 'CARRIER_DELIVERED' then
      'The carrier confirmed delivery' ||
      case when p_detail is null then '' else '. ' || p_detail end
    when 'RECEIPT_RECORDED' then
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
    else
      v_who || ' — ' || replace(lower(p_event), '_', ' ') ||
      case when p_detail is null then '' else ': ' || p_detail end
  end;
end;
$$;

comment on function cardtrade.describe_cash_sale_event(text, text, text) is
  'Human-readable chat line for one cash_sale_events row. 0098 drops "accept" '
  'from buy copy — buys confirm terms and complete the purchase. Replacing this '
  'function must reproduce every branch.';
