-- 0101_fulfillment_no_confirm.sql
--
-- Meeting place, postage and handover method are coordination, not a new deal.
-- Either party may change them without voiding acceptances or asking anyone to
-- confirm again. Cash and what is being swapped still reset both ticks — that
-- is a different number, and the listing owner is the only one who may set it.

create or replace function cardtrade.reset_trade_terms_acceptances()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- PostgreSQL fires UPDATE OF even when the new value equals the old one.
  -- A save that only touches handover would otherwise look like a price change.
  if old.cash_amount_cents is not distinct from new.cash_amount_cents
    and old.cash_direction is not distinct from new.cash_direction
    and old.declared_value_cents is not distinct from new.declared_value_cents
    and old.counterpart_goods_description is not distinct from new.counterpart_goods_description
  then
    return new;
  end if;

  if old.state <> 'NEGOTIATING' then
    raise exception 'Trade price is locked once collateral is in play';
  end if;

  new.terms_version := old.terms_version + 1;
  new.version := old.version + 1;
  new.terms_updated_at := now();
  new.initiator_terms_accepted_version := null;
  new.counterpart_terms_accepted_version := null;
  new.initiator_terms_accepted_at := null;
  new.counterpart_terms_accepted_at := null;
  return new;
end;
$$;

comment on function cardtrade.reset_trade_terms_acceptances() is
  'Voids both acceptances when cash or swapped goods change. Handover edits do '
  'not fire this. Replacing it must keep the no-op when watched columns are '
  'unchanged — UPDATE OF fires on the SET list, not on a real difference.';

drop trigger if exists trades_reset_terms_acceptances on cardtrade.trades;
create trigger trades_reset_terms_acceptances
before update of cash_amount_cents, cash_direction, declared_value_cents,
  counterpart_goods_description
on cardtrade.trades
for each row execute function cardtrade.reset_trade_terms_acceptances();

-- Chat lines are stored at insert time. 0099 rewrote by event join; leftover
-- rows still said "proposed" / "confirm again" when that join missed.
update cardtrade.messages
set body = replace(
  replace(
    body,
    '. Both parties need to confirm again.',
    '.'
  ),
  ' proposed new fulfillment terms',
  ' updated the fulfillment terms'
)
where kind = 'SYSTEM'
  and (
    position('Both parties need to confirm again' in body) > 0
    or position('proposed new fulfillment terms' in body) > 0
  );

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
      v_who || ' updated the price' ||
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
  'Human-readable chat line for one cash_sale_events row. 0101: fulfillment '
  'edits are not a confirm gate; the seller sets the price. Replacing this '
  'function must reproduce every branch.';

update cardtrade.messages
set body = replace(body, ' requested a price change', ' updated the price')
where kind = 'SYSTEM'
  and system_event = 'PRICE_PROPOSED'
  and position('requested a price change' in body) > 0;
