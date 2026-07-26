-- 0019_dispute_conversation.sql
--
-- Arbitration chat for disputes (eBay-style resolution center). When a Cash_Sale
-- dispute is raised, a dedicated conversation is created for both parties to
-- present their case. Accessible from the Messages inbox, tagged as a dispute
-- thread.
--
-- Pattern mirrors deal_id (0013) and trade_id (0016) on conversations.

-- 1. Add cash_sale_id scope to conversations (one dispute thread per sale).
alter table cardtrade.conversations
  add column if not exists cash_sale_id uuid references cardtrade.cash_sales(id) on delete cascade;

comment on column cardtrade.conversations.cash_sale_id is
  'Set when this thread is the arbitration/dispute chat for a Cash_Sale.';

-- Unique partial index: at most one dispute thread per sale.
create unique index if not exists conversations_cash_sale_dispute_unique
  on cardtrade.conversations (cash_sale_id) where cash_sale_id is not null;

-- 2. Add dispute_conversation_id back-reference on cash_sales.
alter table cardtrade.cash_sales
  add column if not exists dispute_conversation_id uuid
    references cardtrade.conversations(id) on delete set null;

comment on column cardtrade.cash_sales.dispute_conversation_id is
  'The arbitration conversation thread created when a dispute is raised.';

-- 3. PL/pgSQL function to create and link the dispute conversation atomically.
create or replace function cardtrade.attach_dispute_conversation(
  p_cash_sale_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = cardtrade
as $$
declare
  v_sale cardtrade.cash_sales%rowtype;
  v_a uuid;
  v_b uuid;
  v_conversation_id uuid;
begin
  -- Load the sale, verify actor is a participant, and it's actually disputed.
  select * into v_sale
  from cardtrade.cash_sales
  where id = p_cash_sale_id;

  if v_sale is null then
    raise exception 'cash_sale not found';
  end if;

  if p_actor_id <> v_sale.buyer_id and p_actor_id <> v_sale.seller_id then
    raise exception 'not a participant';
  end if;

  if v_sale.status <> 'DISPUTED' then
    raise exception 'sale is not in DISPUTED state';
  end if;

  -- Already has a dispute conversation: nothing to do.
  if v_sale.dispute_conversation_id is not null then
    return;
  end if;

  -- Order participants (same convention as all conversations).
  if v_sale.buyer_id < v_sale.seller_id then
    v_a := v_sale.buyer_id;
    v_b := v_sale.seller_id;
  else
    v_a := v_sale.seller_id;
    v_b := v_sale.buyer_id;
  end if;

  -- Create the arbitration conversation.
  insert into cardtrade.conversations (cash_sale_id, participant_a, participant_b, last_message_at)
  values (p_cash_sale_id, v_a, v_b, now())
  returning id into v_conversation_id;

  -- Link it back to the sale.
  update cardtrade.cash_sales
  set dispute_conversation_id = v_conversation_id, updated_at = now()
  where id = p_cash_sale_id;

  -- Insert a SYSTEM message explaining the arbitration thread.
  insert into cardtrade.messages (conversation_id, kind, system_event, body)
  values (
    v_conversation_id,
    'SYSTEM',
    'DISPUTE_OPENED',
    'A dispute has been raised on this transaction. Both parties can present their case here. An admin will review and make a decision.'
  );
end;
$$;

-- 4. RLS: dispute conversations follow the same participant rules as existing
-- conversations (participant_a or participant_b = auth.uid()). No new policy
-- needed since the existing conversations RLS already grants select/insert to
-- participants.
