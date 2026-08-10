-- 0084_cash_sale_dispute_withdrawal.sql
--
-- Chat copy for a dispute that ends WITHOUT an arbitrator.
--
-- WHAT THIS MIGRATION IS NOT. It adds no columns, no RPC and no grants, because none
-- are needed. `cash_sale_events.event` is free text bounded to 80 characters (0008),
-- not an enum, so a new event code inserts without a schema change; every dispute
-- column already exists (0008 for the claim, 0044 for the resolution); and the whole
-- cash-sale repository writes through the service role, so there is no member grant to
-- widen. This file exists ONLY so the two new codes read like English in the contract
-- thread.
--
-- WHY THAT MATTERS ENOUGH TO BE A MIGRATION. `mirror_cash_sale_event_to_chat` (0012)
-- posts a SYSTEM message for every row inserted into `cash_sale_events`, and
-- `describe_cash_sale_event` has an `else` branch that lower-cases an unknown code and
-- prints it. So without this the other party's only notification that a dispute against
-- them had been dropped would read "Alice — dispute withdrawn". That is the moment a
-- member most needs a clear sentence, and it is the one place the wording is not
-- already written down.
--
-- TWO NEW CODES:
--
--   DISPUTE_WITHDRAWN        the raiser retracted their own claim; the contract returns
--                            to the status it was in before the dispute and no money
--                            moves. Only ever written by the raiser.
--   DISPUTE_SETTLED_BY_PARTY the dispute ended because ONE party conceded — a buyer
--                            releasing the seller, or a seller refunding the buyer in
--                            full. The money outcome is logged separately by the
--                            existing DISPUTE_RESOLVED_* code from 0044, so this is the
--                            line that records it was a party and not an arbitrator.
--
-- CREATE OR REPLACE REPRODUCES THE WHOLE FUNCTION, deliberately. Every existing branch
-- below is carried over verbatim from 0012 — a replace drops what it omits, and losing a
-- branch would silently degrade every future message of that kind to the `else`
-- fallback. Diff this against 0012 rather than trusting the new lines alone.

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
      '. Both parties need to accept again.'
    when 'PRICE_PROPOSED' then
      v_who || ' requested a price change' ||
      case when p_detail is null then '' else ' — ' || p_detail end ||
      '. Both parties need to accept again.'
    when 'TERMS_ACCEPTED' then
      v_who || ' accepted the current terms.'
    when 'PAYMENT_REQUESTED' then
      'Both parties accepted the same terms, so payment was requested.'
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
      v_who || ' accepted the item. The contract is complete.'
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
    -- New in 0084.
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
      -- Unknown codes still surface, lower-cased and readable, rather than vanishing.
      v_who || ' — ' || replace(lower(p_event), '_', ' ') ||
      case when p_detail is null then '' else ': ' || p_detail end
  end;
end;
$$;

comment on function cardtrade.describe_cash_sale_event(text, text, text) is
  'Human-readable chat line for one cash_sale_events row. Extended in 0084 with '
  'DISPUTE_WITHDRAWN and DISPUTE_SETTLED_BY_PARTY, the two ways a dispute ends '
  'without an arbitrator. Replacing this function must reproduce every branch.';
