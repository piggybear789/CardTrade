-- 0099_cash_sale_pay_without_confirm.sql
--
-- Buys have no mutual confirm step. The buyer pays once handover details exist.
-- Historical TERMS_ACCEPTED lines stay readable without sounding like a gate.

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
      v_who || ' updated the fulfillment terms' ||
      case when p_detail is null then '' else ' — ' || p_detail end || '.'
    when 'PRICE_PROPOSED' then
      v_who || ' requested a price change' ||
      case when p_detail is null then '' else ' — ' || p_detail end || '.'
    when 'TERMS_ACCEPTED' then
      v_who || ' continued to payment.'
    when 'PAYMENT_REQUESTED' then
      v_who || ' started payment.'
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
  'Human-readable chat line for one cash_sale_events row. 0099: buys pay '
  'without a confirm step. Replacing this function must reproduce every branch.';

-- Chat lines are stored at insert time. Rewrite the four events whose copy
-- still talked about a confirm gate so existing rooms match the new wording.
update cardtrade.messages m
set body = left(
  cardtrade.describe_cash_sale_event(e.event, e.detail, p.display_name),
  4000
)
from cardtrade.cash_sale_events e
join cardtrade.cash_sales s on s.id = e.cash_sale_id
left join cardtrade.profiles p on p.id = e.actor_id
where m.conversation_id = s.conversation_id
  and m.kind = 'SYSTEM'
  and m.system_event = e.event
  and m.created_at = e.created_at
  and e.event in (
    'TERMS_UPDATED',
    'PRICE_PROPOSED',
    'TERMS_ACCEPTED',
    'PAYMENT_REQUESTED'
  );
