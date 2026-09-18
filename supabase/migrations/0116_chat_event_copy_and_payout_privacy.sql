-- 0116_chat_event_copy_and_payout_privacy.sql
--
-- TWO FIXES TO WHAT THE CONTRACT CHAT SAYS ABOUT THE CONTRACT.
--
-- Observed on a completed sale: the last two lines of the transcript, and therefore
-- the inbox preview for the whole conversation, read
--
--     A participant recorded a contract update: 100
--     A participant recorded a contract update.
--
-- Those were SELLER_PAYOUT_QUEUED (detail = the net payout in cents) and
-- SELLER_PAYOUT_FAILED. Neither had a branch in `describe_cash_sale_event`, so both
-- fell to the fallback, which glued the raw `detail` on with a colon; and both are
-- system-actor events, so `v_who` resolved to "A participant".
--
-- 1. PAYOUT EVENTS DO NOT BELONG IN THE CHAT AT ALL. They are the seller's money
--    moving between the platform and the seller's account, AFTER the contract is
--    complete. The buyer has no stake in them and "payout failed" in a two-party
--    thread reads to the buyer as something going wrong with their purchase. The
--    seller already sees payout state in the Payouts read model. The mirror trigger
--    now skips them, and the lines it already posted are removed.
--
-- 2. EVERY OTHER EVENT GETS A SENTENCE. The copy function covered the happy path and
--    the dispute-raise; the return flow (0088), refund failures, inspection expiry,
--    handover failure and the staff resolutions all fell to the fallback. Each has a
--    branch now. Where the orchestrator already writes `detail` as a full sentence
--    (RETURN_REQUIRED, RETURN_COMPLETED, RETURN_CASE_RESOLVED_*) that sentence is
--    used; where it is a fragment (a carrier + number, a reason) it is appended in the
--    same shape the existing branches use.
--
-- 3. THE FALLBACK NO LONGER PRINTS `detail`. A code this function does not know is a
--    code whose `detail` shape it does not know either, and the one time it fired in
--    anger it printed a cents figure as if it were a sentence. It now says the one
--    thing it can vouch for.
--
-- Existing chat rows for the newly-covered events are rewritten from the same
-- function, so a transcript reads the same whether it was written before or after
-- this migration. The function comment's rule — "replacing this must reproduce every
-- branch" — is honoured: every branch from 0113 is present below, verbatim, with one
-- exception called out inline (CARRIER_DELIVERED, which was doubling its sentence).

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
    -- THE ONE 0113 BRANCH THAT CHANGED. The orchestrator writes this detail as a
    -- complete sentence ("Carrier confirmed delivery. Auto-completes after 7 days
    -- unless the buyer acts."), so prefixing it produced "The carrier confirmed
    -- delivery. Carrier confirmed delivery. Auto-completes…" in every transcript.
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

    -- Payout events never reach the chat (see the trigger below), but the copy
    -- function is called from other places too, so they still describe themselves.
    when 'SELLER_PAYOUT_QUEUED' then
      'The seller''s payout has been queued.'
    when 'SELLER_PAYOUT_SETTLED' then
      'The seller''s payout has been paid.'
    when 'SELLER_PAYOUT_FAILED' then
      'The seller''s payout could not be sent.'

    else
      -- No `detail` here. See the header: an unknown code has an unknown detail
      -- shape, and the fallback once printed a cents figure as prose.
      'The contract was updated.'
  end;
end;
$$;

comment on function cardtrade.describe_cash_sale_event(text, text, text, text, boolean) is
  'Human-readable Cash_Sale event copy with fulfillment and binder-aware wording. Replacing this function must reproduce every branch.';

-- The mirror trigger, with the payout events skipped.
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
  -- SELLER-ONLY BOOKKEEPING STAYS OUT OF THE SHARED THREAD. These fire after the
  -- contract is complete and describe money moving to the seller; the buyer has no
  -- part in them and the seller reads them in Payouts.
  if new.event in ('SELLER_PAYOUT_QUEUED', 'SELLER_PAYOUT_SETTLED', 'SELLER_PAYOUT_FAILED') then
    return new;
  end if;

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

-- Remove the payout lines already posted.
delete from cardtrade.messages
where kind = 'SYSTEM'
  and system_event in ('SELLER_PAYOUT_QUEUED', 'SELLER_PAYOUT_SETTLED', 'SELLER_PAYOUT_FAILED');

-- Rewrite existing chat rows for the newly-covered events from the same function,
-- so old and new transcripts read alike. Actor name and sale context come from the
-- event row and the sale, exactly as the trigger would have found them.
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
  and m.system_event in (
    'CARRIER_DELIVERED',
    'INSPECTION_EXPIRED', 'BOTH_RECEIVED', 'HANDOVER_FAILED', 'HANDOVER_ASSUMED',
    'DISPUTE_RESOLVED', 'FRAUD_CONFIRMED', 'DISPUTE_REFUND_FAILED',
    'RETURN_REQUIRED', 'RETURN_SHIPPED', 'RETURN_COMPLETED', 'RETURN_DISPUTED',
    'RETURN_REFUND_FAILED', 'RETURN_CASE_RESOLVED_REFUND_BUYER',
    'RETURN_CASE_RESOLVED_RELEASE_SELLER'
  );

-- A conversation whose newest line was a payout notice now points at the line before it.
update cardtrade.conversations c
set last_message_at = latest.at
from (
  select conversation_id, max(created_at) as at
  from cardtrade.messages
  group by conversation_id
) latest
where latest.conversation_id = c.id
  and latest.at < c.last_message_at;
