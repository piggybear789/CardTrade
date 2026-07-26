-- CardTrade — 0016_trade_conversation.sql
-- Gives accepted 2-way Trades the same participant-only contract chat that
-- Cash_Sales (0009 + 0012) and private Deals (0013) already have, per the
-- demo-contract-ux spec (Req 1, Task 5.1). Both Trade participants are known
-- from creation — unlike a Deal, there is no "awaiting join" state — so the
-- resolve-or-create RPC only needs to check the actor is one of the two
-- traders and dedupe on trade_id.

-- ---------------------------------------------------------------------------
-- Linkage: conversations.trade_id (scope) + trades.conversation_id (thread)
-- ---------------------------------------------------------------------------

alter table cardtrade.conversations
  add column if not exists trade_id uuid;

alter table cardtrade.conversations
  drop constraint if exists conversations_trade_id_fkey;
alter table cardtrade.conversations
  add constraint conversations_trade_id_fkey
    foreign key (trade_id) references cardtrade.trades (id) on delete cascade;

comment on column cardtrade.conversations.trade_id is
  'The trade this thread belongs to; null for item/direct/deal conversations.';

-- Exactly one thread per trade, so both participants opening the room at the
-- same moment converge instead of creating two threads.
create unique index if not exists conversations_trade_unique
  on cardtrade.conversations (trade_id)
  where trade_id is not null;

alter table cardtrade.trades
  add column if not exists conversation_id uuid;

alter table cardtrade.trades
  drop constraint if exists trades_conversation_id_fkey;
alter table cardtrade.trades
  add constraint trades_conversation_id_fkey
    foreign key (conversation_id) references cardtrade.conversations (id)
    on delete set null;

comment on column cardtrade.trades.conversation_id is
  'The participant-only chat thread for this trade (see ensure_trade_conversation).';

create index if not exists trades_conversation_idx
  on cardtrade.trades (conversation_id)
  where conversation_id is not null;

-- ---------------------------------------------------------------------------
-- ensure_trade_conversation — resolve-or-create the thread, idempotently
-- ---------------------------------------------------------------------------

/**
 * Open (or return) the chat thread for a trade. Mirrors
 * `ensure_deal_conversation`: re-checks the actor is one of the two traders,
 * dedupes on `trade_id`, and links the thread in one transaction.
 *
 * Returns null when the trade does not exist or the actor is not a party to it.
 */
create or replace function cardtrade.ensure_trade_conversation(
  p_trade_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_trade cardtrade.trades%rowtype;
  v_conversation_id uuid;
  v_a uuid;
  v_b uuid;
begin
  select * into v_trade
  from cardtrade.trades
  where id = p_trade_id
  for update;

  if not found then
    return null;
  end if;

  if p_actor_id is distinct from v_trade.initiator_id
     and p_actor_id is distinct from v_trade.counterpart_id then
    return null;
  end if;

  if v_trade.conversation_id is not null then
    return v_trade.conversation_id;
  end if;

  if v_trade.initiator_id::text < v_trade.counterpart_id::text then
    v_a := v_trade.initiator_id;
    v_b := v_trade.counterpart_id;
  else
    v_a := v_trade.counterpart_id;
    v_b := v_trade.initiator_id;
  end if;

  select id into v_conversation_id
  from cardtrade.conversations
  where trade_id = p_trade_id
  limit 1;

  if v_conversation_id is null then
    begin
      insert into cardtrade.conversations (trade_id, item_id, participant_a, participant_b)
      values (p_trade_id, null, v_a, v_b)
      returning id into v_conversation_id;
    exception when unique_violation then
      select id into v_conversation_id
      from cardtrade.conversations
      where trade_id = p_trade_id
      limit 1;
    end;
  end if;

  update cardtrade.trades
  set conversation_id = v_conversation_id
  where id = p_trade_id;

  return v_conversation_id;
end;
$$;

revoke all on function cardtrade.ensure_trade_conversation(uuid, uuid) from public, anon, authenticated;
grant execute on function cardtrade.ensure_trade_conversation(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Trade history mirrored into the thread (the 0012/0013 pattern, for trades)
-- ---------------------------------------------------------------------------

/**
 * Human-readable chat line for one trade_state_transitions event. Keeps the
 * wording in one place so the contract's action history and the chat thread
 * never drift apart.
 */
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
    when 'HOLDS_CONFIRMED' then 'Collateral is in place — the trade is locked in.'
    when 'HOLDS_FAILED' then 'Collateral could not be arranged. The trade was cancelled.'
    when 'RECORD_SHIPMENT' then v_who || ' shipped their side.'
    when 'BOTH_SHIPPED' then 'Both sides have shipped.'
    when 'RECORD_RECEIPT' then v_who || ' received their side.'
    when 'BOTH_RECEIVED' then 'Both sides have been received.'
    when 'RECORD_ACCEPTANCE' then v_who || ' accepted what they received.'
    when 'BOTH_ACCEPTED' then 'Both sides accepted — this trade is complete.'
    when 'CONDITION_DISPUTE' then v_who || ' raised a condition dispute.'
    when 'DISPUTE_RESOLVED' then 'The dispute was resolved.'
    when 'FRAUD_CONFIRMED' then 'This trade was closed as fraud.'
    else lower(replace(p_event, '_', ' ')) || ' -> ' || lower(replace(coalesce(p_to_state, ''), '_', ' '))
  end;
end;
$$;

/**
 * Mirror every `trade_state_transitions` row into the trade's chat as a stored
 * SYSTEM message, once a thread exists. SECURITY DEFINER because transitions
 * are written by the service-role orchestrator, not the end user, and the
 * derived SYSTEM row is the database's, not theirs.
 */
create or replace function cardtrade.mirror_trade_event_to_chat()
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
  from cardtrade.trades
  where id = new.trade_id;

  if v_conversation_id is null then
    return new;
  end if;

  if new.requested_by is not null then
    select display_name into v_actor_name
    from cardtrade.profiles
    where id = new.requested_by;
  end if;

  v_body := cardtrade.describe_trade_event(new.event, new.to_state::text, v_actor_name);

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

drop trigger if exists trade_transitions_mirror_to_chat on cardtrade.trade_state_transitions;
create trigger trade_transitions_mirror_to_chat
after insert on cardtrade.trade_state_transitions
for each row execute function cardtrade.mirror_trade_event_to_chat();

-- ---------------------------------------------------------------------------
-- Backfill: open a thread for every existing accepted Trade
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select id, initiator_id
    from cardtrade.trades
    where conversation_id is null
  loop
    perform cardtrade.ensure_trade_conversation(r.id, r.initiator_id);
  end loop;
end
$$;
