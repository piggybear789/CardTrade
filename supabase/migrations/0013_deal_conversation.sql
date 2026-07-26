-- CardTrade — 0013_deal_conversation.sql
-- A private deal is a binding contract between two people, so it gets the same
-- participant-only chat a purchase contract has (0009 + 0012), including the
-- history-mirrored SYSTEM messages that make the thread the single
-- chronological record of the deal.
--
-- Why a dedicated link rather than reusing the unscoped DM thread: conversations
-- dedupe on (item_id, participant_a, participant_b), and a deal has no item. Two
-- members with both a direct message thread and a deal would collide on
-- (null, a, b). `conversations.deal_id` scopes a deal thread explicitly, and the
-- application's DM lookup now excludes deal threads.

-- ---------------------------------------------------------------------------
-- Linkage: conversations.deal_id (scope) + deals.conversation_id (the thread)
-- ---------------------------------------------------------------------------

alter table cardtrade.conversations
  add column if not exists deal_id uuid;

alter table cardtrade.conversations
  drop constraint if exists conversations_deal_id_fkey;
alter table cardtrade.conversations
  add constraint conversations_deal_id_fkey
    foreign key (deal_id) references cardtrade.deals (id) on delete cascade;

comment on column cardtrade.conversations.deal_id is
  'The private deal this thread belongs to; null for item/direct conversations.';

-- Exactly one thread per deal, so two participants opening the room at the same
-- moment converge instead of creating two threads.
create unique index if not exists conversations_deal_unique
  on cardtrade.conversations (deal_id)
  where deal_id is not null;

alter table cardtrade.deals
  add column if not exists conversation_id uuid;

alter table cardtrade.deals
  drop constraint if exists deals_conversation_id_fkey;
alter table cardtrade.deals
  add constraint deals_conversation_id_fkey
    foreign key (conversation_id) references cardtrade.conversations (id)
    on delete set null;

comment on column cardtrade.deals.conversation_id is
  'The participant-only chat thread for this deal (see ensure_deal_conversation).';

create index if not exists deals_conversation_idx
  on cardtrade.deals (conversation_id)
  where conversation_id is not null;

-- ---------------------------------------------------------------------------
-- ensure_deal_conversation — resolve-or-create the thread, idempotently
-- ---------------------------------------------------------------------------

/**
 * Open (or return) the chat thread for a deal. Mirrors
 * `attach_cash_sale_conversation`: re-checks that the actor is one of the two
 * parties, dedupes on `deal_id`, and links the thread in one transaction.
 *
 * Returns null when the deal does not exist, has not been joined yet (a thread
 * needs two participants), or the actor is not a party to it.
 */
create or replace function cardtrade.ensure_deal_conversation(
  p_deal_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_deal cardtrade.deals%rowtype;
  v_conversation_id uuid;
  v_a uuid;
  v_b uuid;
begin
  select * into v_deal
  from cardtrade.deals
  where id = p_deal_id
  for update;

  if not found then
    return null;
  end if;

  -- Nobody has taken the share link yet: there is no second participant.
  if v_deal.counterparty_id is null then
    return null;
  end if;

  -- Only the two parties to the deal may open or read its chat.
  if p_actor_id is distinct from v_deal.creator_id
     and p_actor_id is distinct from v_deal.counterparty_id then
    return null;
  end if;

  if v_deal.conversation_id is not null then
    return v_deal.conversation_id;
  end if;

  if v_deal.creator_id::text < v_deal.counterparty_id::text then
    v_a := v_deal.creator_id;
    v_b := v_deal.counterparty_id;
  else
    v_a := v_deal.counterparty_id;
    v_b := v_deal.creator_id;
  end if;

  select id into v_conversation_id
  from cardtrade.conversations
  where deal_id = p_deal_id
  limit 1;

  if v_conversation_id is null then
    begin
      insert into cardtrade.conversations (deal_id, item_id, participant_a, participant_b)
      values (p_deal_id, null, v_a, v_b)
      returning id into v_conversation_id;
    exception when unique_violation then
      select id into v_conversation_id
      from cardtrade.conversations
      where deal_id = p_deal_id
      limit 1;
    end;
  end if;

  update cardtrade.deals
  set conversation_id = v_conversation_id
  where id = p_deal_id;

  return v_conversation_id;
end;
$$;

revoke all on function cardtrade.ensure_deal_conversation(uuid, uuid) from public, anon, authenticated;
grant execute on function cardtrade.ensure_deal_conversation(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Deal history mirrored into the thread (the 0012 pattern, for deals)
-- ---------------------------------------------------------------------------

/**
 * Human-readable chat line for one deal event. Keeps the wording in one place so
 * the room's History and the chat thread can never drift apart.
 */
create or replace function cardtrade.describe_deal_event(
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
  v_detail text := nullif(btrim(coalesce(p_detail, '')), '');
begin
  return case p_event
    when 'DEAL_CREATED' then v_who || ' created this deal.'
    when 'COUNTERPARTY_JOINED' then v_who || ' joined the deal.'
    when 'TERMS_UPDATED' then
      v_who || ' updated the terms.' || coalesce(' ' || v_detail, '')
    when 'CONFIRMATIONS_CLEARED' then
      'Terms changed — both parties must confirm again.'
    when 'PARTY_CONFIRMED' then v_who || ' is happy with the deal.'
    when 'PARTY_UNCONFIRMED' then v_who || ' withdrew their confirmation.'
    when 'BOTH_CONFIRMED' then
      'Both parties confirmed.' || coalesce(' ' || v_detail, '')
    when 'ESCROW_LOCKED' then
      'This deal is now binding.' || coalesce(' ' || v_detail, '')
    when 'ESCROW_FAILED' then
      'The deal could not be made binding.' || coalesce(' ' || v_detail, '')
    when 'COMPLETE_MARKED' then v_who || ' marked the handover complete.'
    when 'DEAL_COMPLETED' then
      'Deal complete — any collateral was released.'
    when 'DEAL_CANCELLED' then
      v_who || ' cancelled the deal.' || coalesce(' ' || v_detail, '')
    when 'DISPUTE_RAISED' then
      v_who || ' raised a dispute.' || coalesce(' ' || v_detail, '')
    else
      lower(replace(p_event, '_', ' ')) || coalesce(' — ' || v_detail, '')
  end;
end;
$$;

/**
 * Mirror every `deal_events` row into the deal's chat as a stored SYSTEM
 * message. SECURITY DEFINER because deal events are written with the caller's
 * cookie-bound client, and `messages_participant_insert` only lets an end user
 * write their own USER messages — the derived SYSTEM row is the database's, not
 * theirs.
 */
create or replace function cardtrade.mirror_deal_event_to_chat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation_id uuid;
  v_actor_name text;
  v_body text;
begin
  select conversation_id into v_conversation_id
  from cardtrade.deals
  where id = new.deal_id;

  -- A deal without a thread yet (still unjoined) has nothing to mirror into.
  if v_conversation_id is null then
    return new;
  end if;

  if new.actor_id is not null then
    select display_name into v_actor_name
    from cardtrade.profiles
    where id = new.actor_id;
  end if;

  v_body := cardtrade.describe_deal_event(new.event, new.detail, v_actor_name);

  -- created_at is copied from the event so the thread stays in true
  -- chronological order even for backfilled rows.
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

drop trigger if exists deal_events_mirror_to_chat on cardtrade.deal_events;
create trigger deal_events_mirror_to_chat
after insert on cardtrade.deal_events
for each row execute function cardtrade.mirror_deal_event_to_chat();

-- ---------------------------------------------------------------------------
-- Backfill: threads for deals that predate the link, then their history
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select id, creator_id
    from cardtrade.deals
    where counterparty_id is not null
      and conversation_id is null
  loop
    perform cardtrade.ensure_deal_conversation(r.id, r.creator_id);
  end loop;
end
$$;

-- Idempotent: keyed on (conversation, SYSTEM, event, created_at), oldest first
-- so the thread ordering holds.
insert into cardtrade.messages (
  conversation_id, sender_id, kind, system_event, body, created_at
)
select
  d.conversation_id,
  null,
  'SYSTEM',
  e.event,
  left(
    cardtrade.describe_deal_event(
      e.event,
      e.detail,
      (select p.display_name from cardtrade.profiles p where p.id = e.actor_id)
    ),
    4000
  ),
  e.created_at
from cardtrade.deal_events e
join cardtrade.deals d on d.id = e.deal_id
where d.conversation_id is not null
  and not exists (
    select 1
    from cardtrade.messages m
    where m.conversation_id = d.conversation_id
      and m.kind = 'SYSTEM'
      and m.system_event = e.event
      and m.created_at = e.created_at
  )
order by e.created_at;
