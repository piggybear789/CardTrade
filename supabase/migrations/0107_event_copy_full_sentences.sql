-- 0107_event_copy_full_sentences.sql
--
-- Every contract line in chat is a full sentence.
--
-- THE SHORTHAND WAS NEVER AUTHORED, IT WAS FALLEN THROUGH TO. Both describe
-- functions end in an `else` that stringifies the raw enum, and a thread showing
--
--   terms accepted -> collateral locked
--   accepted -> completed
--   Test — shipped: Australia Post AP5567110284MM
--
-- is reading those fallbacks, not copy anyone wrote. Two separate causes:
--
--   1. `describe_trade_event` (0016) was written against an event vocabulary
--      that has since moved on. `TERMS_AGREED`, `OFFER_DECLINED`,
--      `BOTH_HANDOVER_CONFIRMED`, `HANDOVER_FAILED` and `INSPECTION_EXPIRED` are
--      all live members of the `TradeEvent` union in
--      `domain/state-machine/types.ts` and none of them had a branch.
--   2. Older rows — and the demo seed — carry short codes (`SHIPPED`,
--      `RECEIVED`, `ACCEPTED`, and `TERMS_ACCEPTED` on a trade) that no branch
--      names either. They exist in real tables, so they get real copy here for
--      the same reason `LEGACY_CONTRACT_CLOSED` does.
--
-- Both fallbacks are rewritten too, so a code added by a future migration
-- degrades to a sentence rather than to an arrow. The state name is the one
-- thing a fallback can always say truthfully.
--
-- Chat bodies are frozen at insert time, so each function change is paired with
-- a backfill over the rows that rendered from the old wording.

-- ---------------------------------------------------------------------------
-- Cash sales
-- ---------------------------------------------------------------------------

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
    -- Legacy short code for the same act, still present in older rooms and in
    -- the demo seed. Worded identically to `SHIPMENT_RECORDED` on purpose: the
    -- reader should not be able to tell which code their room happens to hold.
    when 'SHIPPED' then
      v_who || ' marked the item as shipped' ||
      case when p_detail is null then '' else ' — ' || p_detail end || '.'
    when 'CARRIER_DELIVERED' then
      'The carrier confirmed delivery' ||
      case when p_detail is null then '' else '. ' || p_detail end
    when 'RECEIPT_RECORDED' then
      v_who || ' confirmed the item arrived. Inspection has started.'
    -- Legacy short code for `RECEIPT_RECORDED`. The old fallback rendered this
    -- as "test — received: Delivery confirmed by carrier.", which credited the
    -- buyer with the carrier's action.
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
      -- A sentence, not `name — event: detail`. An unnamed code cannot be
      -- described accurately, so this says only what is certainly true — that
      -- someone recorded a step — and hands the detail over verbatim.
      v_who || ' recorded a contract update' ||
      case when p_detail is null then '.' else ': ' || p_detail end
  end;
end;
$$;

comment on function cardtrade.describe_cash_sale_event(text, text, text) is
  'Human-readable chat line for one cash_sale_events row. 0107: legacy SHIPPED '
  'and RECEIVED codes are named, and the fallback is a sentence. Replacing this '
  'function must reproduce every branch.';

-- Re-render the rooms that were showing the old fallback. Bounded to the two
-- codes this migration newly names, so no already-correct line is rewritten.
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
  and e.event in ('SHIPPED', 'RECEIVED');

-- ---------------------------------------------------------------------------
-- Trades
-- ---------------------------------------------------------------------------

create or replace function cardtrade.describe_trade_event(
  p_event text,
  p_to_state text,
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
    -- Live vocabulary, `domain/state-machine/types.ts`.
    when 'TERMS_AGREED' then 'Both traders agreed the same terms. Collateral is next.'
    when 'OFFER_DECLINED' then v_who || ' declined the offer, so the trade did not open.'
    when 'HOLDS_CONFIRMED' then 'Collateral is in place — the trade is locked in.'
    when 'HOLDS_FAILED' then 'Collateral could not be arranged. The trade was cancelled.'
    when 'BOTH_SHIPPED' then 'Both sides have shipped.'
    when 'BOTH_RECEIVED' then 'Both sides have been received.'
    when 'BOTH_HANDOVER_CONFIRMED' then
      'Both traders confirmed the handover. Inspection has started.'
    when 'HANDOVER_FAILED' then
      v_who || ' reported that the exchange did not happen. The trade is frozen for review.'
    when 'BOTH_ACCEPTED' then 'Both sides accepted — this trade is complete.'
    when 'INSPECTION_EXPIRED' then
      'The inspection window closed with no objection, so the trade completed.'
    when 'CONDITION_DISPUTE' then v_who || ' raised a condition dispute.'
    when 'DISPUTE_RESOLVED' then 'The dispute was resolved.'
    when 'FRAUD_CONFIRMED' then 'This trade was closed as fraud.'

    -- Per-trader codes from 0016 and older rooms.
    when 'RECORD_SHIPMENT' then v_who || ' shipped their side.'
    when 'RECORD_RECEIPT' then v_who || ' received their side.'
    when 'RECORD_ACCEPTANCE' then v_who || ' accepted what they received.'

    -- Short codes carried by older rows and the demo seed. These are what the
    -- arrow shorthand was rendering.
    when 'TERMS_ACCEPTED' then v_who || ' accepted the terms.'
    when 'SHIPPED' then v_who || ' shipped their side.'
    when 'RECEIVED' then v_who || ' received their side.'
    when 'ACCEPTED' then v_who || ' accepted what they received.'

    else
      -- The destination state is the one thing an unnamed event can still state
      -- truthfully, so the fallback reports that rather than printing the code.
      case
        when coalesce(nullif(btrim(p_to_state), ''), '') = '' then
          v_who || ' updated this trade.'
        else
          v_who || ' moved this trade to ' ||
          replace(lower(p_to_state), '_', ' ') || '.'
      end
  end;
end;
$$;

comment on function cardtrade.describe_trade_event(text, text, text) is
  'Human-readable chat line for one trade_state_transitions row. 0107: covers '
  'the live TradeEvent union plus legacy short codes, and the fallback names '
  'the destination state as a sentence. Replacing this function must reproduce '
  'every branch.';

-- Re-render every trade line that came from the arrow fallback. Matched on the
-- codes this migration newly names rather than on the body text, so a room that
-- already read correctly is left alone.
update cardtrade.messages m
set body = left(
  cardtrade.describe_trade_event(t.event, t.to_state::text, p.display_name),
  4000
)
from cardtrade.trade_state_transitions t
join cardtrade.trades tr on tr.id = t.trade_id
left join cardtrade.profiles p on p.id = t.requested_by
where m.conversation_id = tr.conversation_id
  and m.kind = 'SYSTEM'
  and m.system_event = t.event
  and m.created_at = t.created_at
  and t.event in (
    'TERMS_AGREED',
    'OFFER_DECLINED',
    'BOTH_HANDOVER_CONFIRMED',
    'HANDOVER_FAILED',
    'INSPECTION_EXPIRED',
    'TERMS_ACCEPTED',
    'SHIPPED',
    'RECEIVED',
    'ACCEPTED'
  );
