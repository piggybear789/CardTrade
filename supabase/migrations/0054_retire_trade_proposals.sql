-- 0054_retire_trade_proposals.sql
--
-- Step 4: convert every live PENDING proposal into a NEGOTIATING Trade, so an
-- offer has one representation instead of two.
--
-- The `trade_proposals` table is NOT dropped here. Code still reads it (the
-- inbox, `acceptTradeProposal`, `counterTradeProposal`), and dropping a table out
-- from under live readers turns a clean cutover into an outage. The drop is a
-- later migration, once those call sites are gone.
--
-- Requires 0053 for `open_trade_negotiation`.

do $$
declare
  p cardtrade.trade_proposals%rowtype;
  v_trade cardtrade.trades%rowtype;
  v_extra uuid[];
begin
  for p in
    select * from cardtrade.trade_proposals where status = 'PENDING'
  loop
    -- Skip anything no longer convertible: the targeted Item has since been
    -- reserved or sold, or the proposer already has a live negotiation on the
    -- same listing (the one-live-offer rule from 0053 would reject it).
    if not exists (
      select 1 from cardtrade.items
      where id = p.counterpart_item_id and owner_id = p.counterpart_id and status = 'AVAILABLE'
    ) or exists (
      select 1 from cardtrade.trades
      where initiator_id = p.proposer_id
        and counterpart_item_id = p.counterpart_item_id
        and state = 'NEGOTIATING'
    ) then
      update cardtrade.trade_proposals
      set status = 'SUPERSEDED', responded_at = now() where id = p.id;
      continue;
    end if;

    select coalesce(array_agg(item_id), '{}')::uuid[] into v_extra
    from cardtrade.trade_proposal_items
    where proposal_id = p.id and item_id <> p.proposer_item_id;

    select * into v_trade from cardtrade.open_trade_negotiation(
      p.proposer_id, p.counterpart_id, p.proposer_item_id, p.counterpart_item_id,
      nullif(v_extra, '{}'::uuid[]), null,
      coalesce(p.cash_amount_cents, 0),
      coalesce(p.cash_direction, 'PROPOSER_PAYS'),
      p.declared_value_cents, p.handover_method, p.meeting_location,
      p.meeting_lat, p.meeting_lng, p.meeting_place_id, p.meeting_at,
      p.delivery_details, p.delivery_cost_cents, p.message
    );

    -- `trade_proposals_decision_consistent` permits a trade_id only on ACCEPTED,
    -- so the conversion is recorded by the existence of the new NEGOTIATING Trade
    -- rather than by a back-reference from a table that is about to be removed.
    update cardtrade.trade_proposals
    set status = 'SUPERSEDED', responded_at = now()
    where id = p.id;
  end loop;
end $$;
