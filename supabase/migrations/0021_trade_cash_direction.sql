-- CardTrade — 0021_trade_cash_direction.sql
-- Allow either side of a 2-Way Trade to pay its optional cash component.
-- `PROPOSER_PAYS` is the legacy/default direction; `COUNTERPART_PAYS` records a
-- request for cash from the Counterpart. Cash remains non-negative cents.

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'trade_cash_direction' and n.nspname = 'cardtrade'
  ) then
    create type cardtrade.trade_cash_direction as enum (
      'PROPOSER_PAYS',
      'COUNTERPART_PAYS'
    );
  end if;
end;
$$;

alter table cardtrade.trade_proposals
  add column if not exists cash_direction cardtrade.trade_cash_direction
    not null default 'PROPOSER_PAYS';

alter table cardtrade.trades
  add column if not exists cash_direction cardtrade.trade_cash_direction
    not null default 'PROPOSER_PAYS';

comment on column cardtrade.trade_proposals.cash_direction is
  'Which offer participant pays cash: PROPOSER_PAYS adds cash; COUNTERPART_PAYS requests cash.';
comment on column cardtrade.trades.cash_direction is
  'Which trade participant pays the recorded cash_amount_cents; copied from the accepted proposal.';

-- The signature changes to persist direction atomically with the agreed bundle.
drop function if exists cardtrade.finalize_trade_acceptance(
  uuid, uuid, uuid, uuid, uuid, uuid[], uuid, bigint
);

create function cardtrade.finalize_trade_acceptance(
  p_proposal_id uuid,
  p_trade_id uuid,
  p_actor_id uuid,
  p_initiator_id uuid,
  p_initiator_item_id uuid,
  p_initiator_extra_item_ids uuid[],
  p_counterpart_item_id uuid,
  p_cash_amount_cents bigint,
  p_cash_direction cardtrade.trade_cash_direction
)
returns cardtrade.trade_proposals
language plpgsql
set search_path = ''
as $$
declare
  v_proposal cardtrade.trade_proposals%rowtype;
  v_item_id uuid;
begin
  select * into v_proposal from cardtrade.trade_proposals
  where id = p_proposal_id for update;

  if not found then raise exception 'proposal-not-found'; end if;
  if v_proposal.status <> 'PENDING' then raise exception 'not-pending'; end if;
  if v_proposal.counterpart_id is distinct from p_actor_id then
    raise exception 'not-permitted';
  end if;
  if p_cash_amount_cents is distinct from v_proposal.cash_amount_cents
    or p_cash_direction is distinct from v_proposal.cash_direction then
    raise exception 'terms-mismatch';
  end if;

  insert into cardtrade.trade_items (trade_id, trader_id, item_id)
  values (p_trade_id, p_initiator_id, p_initiator_item_id);
  if p_initiator_extra_item_ids is not null then
    foreach v_item_id in array p_initiator_extra_item_ids loop
      insert into cardtrade.trade_items (trade_id, trader_id, item_id)
      values (p_trade_id, p_initiator_id, v_item_id);
    end loop;
  end if;
  insert into cardtrade.trade_items (trade_id, trader_id, item_id)
  values (p_trade_id, p_actor_id, p_counterpart_item_id);

  update cardtrade.trades
  set cash_amount_cents = p_cash_amount_cents,
      cash_direction = p_cash_direction
  where id = p_trade_id;

  update cardtrade.trade_proposals
  set status = 'ACCEPTED', trade_id = p_trade_id, responded_at = now()
  where id = p_proposal_id returning * into v_proposal;
  return v_proposal;
end;
$$;

revoke all on function cardtrade.finalize_trade_acceptance(
  uuid, uuid, uuid, uuid, uuid, uuid[], uuid, bigint, cardtrade.trade_cash_direction
) from public, anon, authenticated;

grant execute on function cardtrade.finalize_trade_acceptance(
  uuid, uuid, uuid, uuid, uuid, uuid[], uuid, bigint, cardtrade.trade_cash_direction
) to service_role;