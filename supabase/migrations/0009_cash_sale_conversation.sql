-- CardTrade — 0009_cash_sale_conversation.sql
-- Every purchase contract needs its participant-only chat (Req 4.2). Contracts
-- created before the conversation link existed are attached on demand, and the
-- helper is idempotent so concurrent participants converge on one thread.

create or replace function cardtrade.attach_cash_sale_conversation(
  p_cash_sale_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_sale cardtrade.cash_sales%rowtype;
  v_conversation_id uuid;
  v_a uuid;
  v_b uuid;
begin
  select * into v_sale
  from cardtrade.cash_sales
  where id = p_cash_sale_id
  for update;

  if not found then
    return null;
  end if;
  -- Only the two parties to the contract may open or read its chat.
  if p_actor_id is distinct from v_sale.buyer_id
     and p_actor_id is distinct from v_sale.seller_id then
    return null;
  end if;
  if v_sale.conversation_id is not null then
    return v_sale.conversation_id;
  end if;

  if v_sale.buyer_id::text < v_sale.seller_id::text then
    v_a := v_sale.buyer_id;
    v_b := v_sale.seller_id;
  else
    v_a := v_sale.seller_id;
    v_b := v_sale.buyer_id;
  end if;

  select id into v_conversation_id
  from cardtrade.conversations
  where item_id = v_sale.item_id
    and participant_a = v_a
    and participant_b = v_b
  limit 1;

  if v_conversation_id is null then
    begin
      insert into cardtrade.conversations (item_id, participant_a, participant_b)
      values (v_sale.item_id, v_a, v_b)
      returning id into v_conversation_id;
    exception when unique_violation then
      select id into v_conversation_id
      from cardtrade.conversations
      where item_id = v_sale.item_id
        and participant_a = v_a
        and participant_b = v_b
      limit 1;
    end;
  end if;

  update cardtrade.cash_sales
  set conversation_id = v_conversation_id
  where id = p_cash_sale_id;

  return v_conversation_id;
end;
$$;

revoke all on function cardtrade.attach_cash_sale_conversation(uuid, uuid) from public, anon, authenticated;
grant execute on function cardtrade.attach_cash_sale_conversation(uuid, uuid) to service_role;

-- Backfill contracts that predate the conversation link.
do $$
declare
  r record;
begin
  for r in
    select id, buyer_id from cardtrade.cash_sales where conversation_id is null
  loop
    perform cardtrade.attach_cash_sale_conversation(r.id, r.buyer_id);
  end loop;
end
$$;
