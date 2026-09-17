-- 0113_contextual_cash_sale_chat.sql
--
-- A listing conversation may carry more than one Cash_Sale over its lifetime,
-- and a SHOPFRONT can carry several at once. Persist the source sale on mirrored
-- SYSTEM messages so those histories never depend on query order. Payment copy
-- also names the fulfillment method that the parties actually agreed instead of
-- offering the impossible generic choice to "ship or meet" after terms are set.

alter table cardtrade.messages
  add column cash_sale_id uuid
    references cardtrade.cash_sales(id) on delete set null;

alter table cardtrade.messages
  add constraint messages_cash_sale_source_matches_kind check (
    kind = 'SYSTEM' or cash_sale_id is null
  );

comment on column cardtrade.messages.cash_sale_id is
  'Source Cash_Sale for a mirrored SYSTEM event. Null for participant and Trade messages.';

create index messages_cash_sale_id_idx
  on cardtrade.messages (cash_sale_id)
  where cash_sale_id is not null;

/**
 * Human-readable chat line for one Cash_Sale event, with the selected handover
 * path available for copy that depends on the frozen contract terms.
 */
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
        v_who || ' started this purchase contract for a binder or bulk listing. '
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
    when 'PAYMENT_FAILED' then
      case when coalesce(p_from_shopfront, false) then
        'The payment failed. This contract did not proceed. The binder or bulk listing remains open, and nothing from it was held.'
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
      'The carrier confirmed delivery' ||
      case when p_detail is null then '' else '. ' || p_detail end
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
    else
      v_who || ' recorded a contract update' ||
      case when p_detail is null then '.' else ': ' || p_detail end
  end;
end;
$$;

comment on function cardtrade.describe_cash_sale_event(text, text, text, text, boolean) is
  'Human-readable Cash_Sale event copy with fulfillment and binder-aware wording. Replacing this function must reproduce every branch.';

-- Compatibility for callers that know fulfillment but not Listing_Kind.
create or replace function cardtrade.describe_cash_sale_event(
  p_event text,
  p_detail text,
  p_actor_name text,
  p_fulfillment_method text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select cardtrade.describe_cash_sale_event(
    p_event,
    p_detail,
    p_actor_name,
    p_fulfillment_method,
    null
  );
$$;

comment on function cardtrade.describe_cash_sale_event(text, text, text, text) is
  'Compatibility wrapper for event copy when Listing_Kind context is unavailable.';

-- Compatibility for callers that do not have a Cash_Sale row in scope. The
-- payment branch degrades truthfully rather than inventing either handover path.
create or replace function cardtrade.describe_cash_sale_event(
  p_event text,
  p_detail text,
  p_actor_name text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select cardtrade.describe_cash_sale_event(
    p_event,
    p_detail,
    p_actor_name,
    null,
    null
  );
$$;

comment on function cardtrade.describe_cash_sale_event(text, text, text) is
  'Compatibility wrapper for event copy when Cash_Sale context is unavailable.';

/** Mirror an inserted Cash_Sale event into its participant conversation. */
create or replace function cardtrade.mirror_cash_sale_event_to_chat()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_conversation_id uuid;
  v_fulfillment_method text;
  v_from_shopfront boolean;
  v_actor_name text;
  v_body text;
begin
  select conversation_id, fulfillment_method::text, from_shopfront
  into v_conversation_id, v_fulfillment_method, v_from_shopfront
  from cardtrade.cash_sales
  where id = new.cash_sale_id;

  if v_conversation_id is null then
    return new;
  end if;

  if new.actor_id is not null then
    select display_name into v_actor_name
    from cardtrade.profiles
    where id = new.actor_id;
  end if;

  v_body := cardtrade.describe_cash_sale_event(
    new.event,
    new.detail,
    v_actor_name,
    v_fulfillment_method,
    v_from_shopfront
  );

  insert into cardtrade.messages (
    conversation_id,
    cash_sale_id,
    sender_id,
    kind,
    system_event,
    body,
    created_at
  ) values (
    v_conversation_id,
    new.cash_sale_id,
    null,
    'SYSTEM',
    new.event,
    left(v_body, 4000),
    new.created_at
  );

  update cardtrade.conversations
  set last_message_at = greatest(last_message_at, new.created_at)
  where id = v_conversation_id;

  return new;
end;
$$;

-- Associate old mirrored rows only when their event tuple identifies exactly
-- one Cash_Sale. Ambiguous rows remain null rather than being assigned by chance.
with candidates as (
  select
    m.id as message_id,
    min(e.cash_sale_id::text)::uuid as cash_sale_id
  from cardtrade.messages m
  join cardtrade.cash_sale_events e
    on e.event = m.system_event
   and e.created_at = m.created_at
  join cardtrade.cash_sales s
    on s.id = e.cash_sale_id
   and s.conversation_id = m.conversation_id
  where m.kind = 'SYSTEM'
    and m.cash_sale_id is null
  group by m.id
  having count(distinct e.cash_sale_id) = 1
)
update cardtrade.messages m
set cash_sale_id = candidates.cash_sale_id
from candidates
where m.id = candidates.message_id;

-- Existing contextual lines were frozen without Listing_Kind or fulfillment.
-- Re-render only rows tied to their source event, preserving every unrelated
-- historical body and making binder copy explicit that nothing is held.
update cardtrade.messages m
set body = left(
  cardtrade.describe_cash_sale_event(
    e.event,
    e.detail,
    p.display_name,
    s.fulfillment_method::text,
    s.from_shopfront
  ),
  4000
)
from cardtrade.cash_sale_events e
join cardtrade.cash_sales s on s.id = e.cash_sale_id
left join cardtrade.profiles p on p.id = e.actor_id
where m.cash_sale_id = e.cash_sale_id
  and m.kind = 'SYSTEM'
  and m.system_event = e.event
  and m.created_at = e.created_at
  and e.event in ('AGREEMENT_CREATED', 'PAYMENT_CLEARED', 'PAYMENT_FAILED');
