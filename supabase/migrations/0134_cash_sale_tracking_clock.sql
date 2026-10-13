-- 0134_cash_sale_tracking_clock.sql
--
-- ESC-02 (Critical): a stale delivered tracking number started the inspection clock
-- in the past, and the seller was paid about an hour later for goods never sent.
--
-- `apply_cash_sale_tracking` (0011, its only definition) computed
-- `inspection_deadline_at := coalesce(p_delivered_at, now()) + 7 days` from the
-- CARRIER's timestamp. Enter the number of any parcel delivered more than a week ago
-- and the deadline was already behind us: the :07 auto-complete job finished the sale
-- and the :47 drain paid it before the buyer could act.
--
-- Now:
--   * `carrier_delivered_at` still records the carrier's raw instant (evidence for
--     arbitration), but the inspection window runs from NOW, when we learn of it.
--   * A delivery dated before the sale was shipped (or, failing that, paid) cannot be
--     this sale's parcel. The sale is NOT advanced: it is flagged
--     DELIVERED_BEFORE_SHIPMENT, a TRACKING_FLAGGED event is written, and it stays
--     IN_TRANSIT for staff.
--   * While a flag is unresolved, no later tracking update can advance the sale, so a
--     webhook cannot start the clock behind staff's back. Staff resolve it with
--     START_CLOCK or REFUND_BUYER (`resolveTrackingFlag`).
--   * The orchestrator flags DELIVERED_AT_REGISTRATION itself (a number that is already
--     delivered when the seller enters it) through the same columns.
--
-- Also here, because both are the cash-sale event surface:
--   * `describe_cash_sale_event` gains TRACKING_FLAGGED (full 0119 body, every branch
--     reproduced).
--   * `mirror_cash_sale_event_to_chat` (full 0116 body) also skips POSTAGE_OUTLIER, a
--     staff-only risk signal written from WP5 (ESC-28); inert until then.
--   * the participant read policy on `cash_sale_events` hides POSTAGE_OUTLIER, because
--     the room subscribes to that table directly and the mirror skip alone would not
--     keep a staff signal from either party.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table cardtrade.cash_sales
  add column if not exists tracking_flagged_at timestamptz,
  add column if not exists tracking_flag_reason text,
  add column if not exists tracking_flag_resolved_at timestamptz,
  add column if not exists tracking_flag_resolved_by uuid references cardtrade.profiles(id);

alter table cardtrade.cash_sales
  drop constraint if exists cash_sales_tracking_flag_reason_check;
alter table cardtrade.cash_sales
  add constraint cash_sales_tracking_flag_reason_check
  check (tracking_flag_reason is null
    or tracking_flag_reason in ('DELIVERED_BEFORE_SHIPMENT', 'DELIVERED_AT_REGISTRATION'));

comment on column cardtrade.cash_sales.tracking_flagged_at is
  'Set when the tracking cannot be this sale''s parcel (ESC-02). While set and unresolved the sale never advances on tracking.';

-- ---------------------------------------------------------------------------
-- 2. The tracking clock
-- ---------------------------------------------------------------------------
create or replace function cardtrade.apply_cash_sale_tracking(
  p_cash_sale_id uuid,
  p_tracking_status text,
  p_delivered_at timestamptz default null
)
returns setof cardtrade.cash_sales
language plpgsql
set search_path = ''
as $$
declare
  v_sale cardtrade.cash_sales%rowtype;
  v_delivered_at timestamptz;
  v_deadline timestamptz;
  v_floor timestamptz;
begin
  select * into v_sale
  from cardtrade.cash_sales
  where id = p_cash_sale_id
  for update;

  if not found then
    return;
  end if;

  if p_tracking_status <> 'DELIVERED' then
    update cardtrade.cash_sales
    set tracking_status = p_tracking_status, updated_at = now()
    where id = p_cash_sale_id
    returning * into v_sale;
    return next v_sale;
    return;
  end if;

  -- A flagged, unresolved sale is staff's to decide. Record what the carrier says and
  -- advance nothing.
  if v_sale.tracking_flagged_at is not null and v_sale.tracking_flag_resolved_at is null then
    update cardtrade.cash_sales
    set tracking_status = 'DELIVERED', updated_at = now()
    where id = p_cash_sale_id
    returning * into v_sale;
    return next v_sale;
    return;
  end if;

  -- The carrier's own instant is evidence; the clock never runs from it.
  v_delivered_at := coalesce(p_delivered_at, now());
  v_deadline := now() + make_interval(days => cardtrade.cash_sale_inspection_days());

  -- Delivered before this sale was shipped (or paid): not this sale's parcel.
  v_floor := coalesce(v_sale.shipped_at, v_sale.payment_settled_at);
  if v_sale.status = 'IN_TRANSIT' and v_floor is not null and v_delivered_at < v_floor then
    update cardtrade.cash_sales
    set tracking_status = 'DELIVERED',
        carrier_delivered_at = v_delivered_at,
        tracking_flagged_at = now(),
        tracking_flag_reason = 'DELIVERED_BEFORE_SHIPMENT',
        updated_at = now()
    where id = p_cash_sale_id
    returning * into v_sale;

    insert into cardtrade.cash_sale_events (
      cash_sale_id, actor_id, event, from_status, to_status, detail
    ) values (
      p_cash_sale_id, null, 'TRACKING_FLAGGED', 'IN_TRANSIT', 'IN_TRANSIT',
      'DELIVERED_BEFORE_SHIPMENT'
    );
    return next v_sale;
    return;
  end if;

  if v_sale.status = 'IN_TRANSIT' then
    update cardtrade.cash_sales
    set status = 'INSPECTION',
        tracking_status = 'DELIVERED',
        carrier_delivered_at = v_delivered_at,
        received_at = coalesce(received_at, v_delivered_at),
        inspection_deadline_at = v_deadline,
        updated_at = now()
    where id = p_cash_sale_id
    returning * into v_sale;

    insert into cardtrade.cash_sale_events (
      cash_sale_id, actor_id, event, from_status, to_status, detail
    ) values (
      p_cash_sale_id, null, 'CARRIER_DELIVERED', 'IN_TRANSIT', 'INSPECTION',
      'Carrier confirmed delivery. Auto-completes after '
        || cardtrade.cash_sale_inspection_days() || ' days unless the buyer acts.'
    );
  elsif v_sale.status = 'INSPECTION' and v_sale.carrier_delivered_at is null then
    -- Buyer already recorded receipt; the carrier confirmation still sets the clock,
    -- from now, never earlier than one the buyer's own receipt already started.
    update cardtrade.cash_sales
    set tracking_status = 'DELIVERED',
        carrier_delivered_at = v_delivered_at,
        inspection_deadline_at = greatest(coalesce(inspection_deadline_at, v_deadline), v_deadline),
        updated_at = now()
    where id = p_cash_sale_id
    returning * into v_sale;
  else
    update cardtrade.cash_sales
    set tracking_status = 'DELIVERED', updated_at = now()
    where id = p_cash_sale_id
    returning * into v_sale;
  end if;

  return next v_sale;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Event copy: every 0119 branch, plus TRACKING_FLAGGED
-- ---------------------------------------------------------------------------
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
  'Human-readable Cash_Sale event copy with fulfillment and binder-listing-aware wording. Replacing this function must reproduce every branch.';

-- Rewrite the lines already in transcripts for the codes that had no copy, from the
-- same function and with the same joins the 0116 and 0119 backfills used.
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
    'CONTENTS_PROPOSED', 'DISPUTE_REFUND_REVERSED', 'DISPUTE_RESOLVED_REFUND_BUYER',
    'DISPUTE_RESOLVED_PARTIAL_REFUND', 'DISPUTE_RESOLVED_RELEASE_SELLER', 'RETURN_DELIVERED'
  );

-- ---------------------------------------------------------------------------
-- 4. The chat mirror: the full 0116 body, plus POSTAGE_OUTLIER skipped
-- ---------------------------------------------------------------------------
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
  -- Seller-only bookkeeping and staff-only risk signals stay out of the shared thread.
  if new.event in ('SELLER_PAYOUT_QUEUED', 'SELLER_PAYOUT_SETTLED', 'SELLER_PAYOUT_FAILED', 'POSTAGE_OUTLIER') then
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

-- ---------------------------------------------------------------------------
-- 5. Participant reads never see a staff risk signal
-- ---------------------------------------------------------------------------
drop policy if exists cash_sale_events_participant_select on cardtrade.cash_sale_events;
create policy cash_sale_events_participant_select
  on cardtrade.cash_sale_events for select to authenticated
  using (
    event <> 'POSTAGE_OUTLIER'
    and exists (
      select 1
      from cardtrade.cash_sales s
      where s.id = cash_sale_events.cash_sale_id
        and ((select auth.uid()) = s.buyer_id or (select auth.uid()) = s.seller_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 6. Grants (re-stated; nothing new is member-executable)
-- ---------------------------------------------------------------------------
revoke all on function cardtrade.apply_cash_sale_tracking(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function cardtrade.apply_cash_sale_tracking(uuid, text, timestamptz)
  to service_role;
-- Members read cash_sales through column grants; the room reads the flag through
-- CASH_SALE_PUBLIC_SELECT, so both parties can see that support is checking it.
grant select (tracking_flagged_at, tracking_flag_reason, tracking_flag_resolved_at) on cardtrade.cash_sales to authenticated;
