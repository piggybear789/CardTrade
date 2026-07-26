-- CardTrade — 0017_atomic_trade_acceptance.sql
-- Fixes a real correctness gap flagged in the demo-contract-ux audit (Task 1.3):
-- `acceptTradeProposal` (lib/actions/tradeProposals.ts) creates the Trade via
-- `proposeTrade`, then — as THREE SEPARATE service-role calls — inserts every
-- `trade_items` row, updates `trades.cash_amount_cents`, and marks the proposal
-- ACCEPTED. A failure between any of those steps left a Trade that existed but
-- was missing part of its bundle/cash terms, with the proposal still PENDING
-- (so it could even be accepted a second time).
--
-- `finalize_trade_acceptance` makes the ACCEPT-TIME bookkeeping atomic: bundle
-- rows, the cash amount, and the PENDING -> ACCEPTED transition all commit
-- together or not at all, in one Postgres function invocation (a single RPC
-- call is one implicit transaction). It re-validates the proposal is still
-- PENDING and owned by the expected counterpart, so a retried or concurrent
-- call cannot double-apply.
--
-- This does not (and cannot) make Pre_Auth_Hold placement part of the same
-- transaction — that is a real HTTP call to the payment provider and must stay
-- outside the database. `lib/actions/tradeProposals.ts` compensates instead: if
-- this RPC fails after the Trade and holds already exist, it voids any holds
-- placed and restores the paired Items to AVAILABLE, leaving the Trade in its
-- existing "cancelled-in-place" shape (COLLATERAL_PENDING, holds VOIDED, items
-- AVAILABLE) rather than a silently broken accepted trade.

create or replace function cardtrade.finalize_trade_acceptance(
  p_proposal_id uuid,
  p_trade_id uuid,
  p_actor_id uuid,
  p_initiator_id uuid,
  p_initiator_item_id uuid,
  p_initiator_extra_item_ids uuid[],
  p_counterpart_item_id uuid,
  p_cash_amount_cents bigint
)
returns cardtrade.trade_proposals
language plpgsql
set search_path = ''
as $$
declare
  v_proposal cardtrade.trade_proposals%rowtype;
  v_item_id uuid;
begin
  -- Re-validate under a row lock: only a PENDING proposal, and only the
  -- Counterpart who was authorized to accept it, may finalize.
  select * into v_proposal
  from cardtrade.trade_proposals
  where id = p_proposal_id
  for update;

  if not found then
    raise exception 'proposal-not-found';
  end if;
  if v_proposal.status <> 'PENDING' then
    raise exception 'not-pending';
  end if;
  if v_proposal.counterpart_id is distinct from p_actor_id then
    raise exception 'not-permitted';
  end if;

  -- The trade_items bundle: the initiator's primary Item plus any extras, then
  -- the counterpart's Item — mirroring the shape `acceptTradeProposal` inserted
  -- across separate calls before this migration.
  insert into cardtrade.trade_items (trade_id, trader_id, item_id)
  values (p_trade_id, p_initiator_id, p_initiator_item_id);

  if p_initiator_extra_item_ids is not null then
    foreach v_item_id in array p_initiator_extra_item_ids
    loop
      insert into cardtrade.trade_items (trade_id, trader_id, item_id)
      values (p_trade_id, p_initiator_id, v_item_id);
    end loop;
  end if;

  insert into cardtrade.trade_items (trade_id, trader_id, item_id)
  values (p_trade_id, p_actor_id, p_counterpart_item_id);

  if p_cash_amount_cents > 0 then
    update cardtrade.trades
    set cash_amount_cents = p_cash_amount_cents
    where id = p_trade_id;
  end if;

  update cardtrade.trade_proposals
  set status = 'ACCEPTED',
      trade_id = p_trade_id,
      responded_at = now()
  where id = p_proposal_id
  returning * into v_proposal;

  return v_proposal;
end;
$$;

revoke all on function cardtrade.finalize_trade_acceptance(
  uuid, uuid, uuid, uuid, uuid, uuid[], uuid, bigint
) from public, anon, authenticated;
grant execute on function cardtrade.finalize_trade_acceptance(
  uuid, uuid, uuid, uuid, uuid, uuid[], uuid, bigint
) to service_role;
