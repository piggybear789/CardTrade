-- CardTrade — 0012_contract_events_in_chat.sql
-- Every contract history entry also appears in the contract chat as a stored
-- system message, so the thread is the single chronological record of the deal.
--
-- The mirror is a TRIGGER on cash_sale_events rather than application code: the
-- events come from server actions, security-definer RPCs and the pg_cron sweeper
-- alike, and all of them must show up in chat. Doing it in the database means no
-- write path can bypass it.

alter table cardtrade.messages
  add column kind text not null default 'USER'
    check (kind in ('USER', 'SYSTEM')),
  add column system_event text;

-- A system message has no human author; a user message always does.
alter table cardtrade.messages
  alter column sender_id drop not null,
  add constraint messages_sender_matches_kind check (
    (kind = 'USER' and sender_id is not null)
    or (kind = 'SYSTEM' and sender_id is null)
  );

comment on column cardtrade.messages.kind is
  'USER for a participant message, SYSTEM for a mirrored contract event.';
comment on column cardtrade.messages.system_event is
  'The cash_sale_events.event code this system message was generated from.';

-- End users may only ever write their own USER messages. System messages are
-- inserted by the trigger, which runs with the table owner's rights.
drop policy if exists messages_participant_insert on cardtrade.messages;
create policy messages_participant_insert on cardtrade.messages
  for insert to authenticated
  with check (
    kind = 'USER'
    and sender_id = (select auth.uid())
    and exists (
      select 1 from cardtrade.conversations c
      where c.id = messages.conversation_id
        and ((select auth.uid()) = c.participant_a or (select auth.uid()) = c.participant_b)
    )
  );

/**
 * Human-readable chat line for one contract event. Keeps the wording in one
 * place so history and chat can never drift apart.
 */
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
    when 'LEGACY_CONTRACT_CLOSED' then
      'This contract was closed during a system migration.'
    else
      -- Unknown codes still surface, lower-cased and readable, rather than vanishing.
      v_who || ' — ' || replace(lower(p_event), '_', ' ') ||
      case when p_detail is null then '' else ': ' || p_detail end
  end;
end;
$$;

/** Mirror an inserted contract event into its contract chat. */
create or replace function cardtrade.mirror_cash_sale_event_to_chat()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_conversation_id uuid;
  v_actor_name text;
  v_body text;
begin
  select conversation_id into v_conversation_id
  from cardtrade.cash_sales
  where id = new.cash_sale_id;

  -- A contract without a thread yet simply has nothing to mirror into.
  if v_conversation_id is null then
    return new;
  end if;

  if new.actor_id is not null then
    select display_name into v_actor_name
    from cardtrade.profiles
    where id = new.actor_id;
  end if;

  v_body := cardtrade.describe_cash_sale_event(new.event, new.detail, v_actor_name);

  -- created_at is copied from the event so the thread stays in true chronological
  -- order even when events are backfilled or written by a scheduled job.
  insert into cardtrade.messages (
    conversation_id, sender_id, kind, system_event, body, created_at
  ) values (
    v_conversation_id, null, 'SYSTEM', new.event, left(v_body, 4000), new.created_at
  );

  update cardtrade.conversations
  set last_message_at = greatest(last_message_at, new.created_at)
  where id = v_conversation_id;

  return new;
end;
$$;

drop trigger if exists cash_sale_events_mirror_to_chat on cardtrade.cash_sale_events;
create trigger cash_sale_events_mirror_to_chat
after insert on cardtrade.cash_sale_events
for each row execute function cardtrade.mirror_cash_sale_event_to_chat();

-- Backfill history that predates the mirror, oldest first so ordering holds.
do $$
declare
  r record;
  v_conversation_id uuid;
  v_actor_name text;
begin
  for r in
    select e.* from cardtrade.cash_sale_events e order by e.created_at, e.id
  loop
    select conversation_id into v_conversation_id
    from cardtrade.cash_sales where id = r.cash_sale_id;
    if v_conversation_id is null then
      continue;
    end if;
    -- Skip anything already mirrored, so the backfill can be re-run safely.
    if exists (
      select 1 from cardtrade.messages m
      where m.conversation_id = v_conversation_id
        and m.kind = 'SYSTEM'
        and m.system_event = r.event
        and m.created_at = r.created_at
    ) then
      continue;
    end if;

    v_actor_name := null;
    if r.actor_id is not null then
      select display_name into v_actor_name from cardtrade.profiles where id = r.actor_id;
    end if;

    insert into cardtrade.messages (
      conversation_id, sender_id, kind, system_event, body, created_at
    ) values (
      v_conversation_id, null, 'SYSTEM', r.event,
      left(cardtrade.describe_cash_sale_event(r.event, r.detail, v_actor_name), 4000),
      r.created_at
    );
  end loop;
end
$$;
