-- CardTrade — 0023_trade_delivery_terms.sql
--
-- Face-to-face / postage handover terms on trade proposals and live trades,
-- mirroring the deals column set. Copied atomically on accept via
-- finalize_trade_acceptance.

-- ---------------------------------------------------------------------------
-- trade_proposals — agreed at offer time
-- ---------------------------------------------------------------------------
alter table cardtrade.trade_proposals
  add column if not exists handover_method cardtrade.handover_method,
  add column if not exists meeting_location text,
  add column if not exists meeting_lat double precision,
  add column if not exists meeting_lng double precision,
  add column if not exists meeting_place_id text,
  add column if not exists meeting_at timestamptz,
  add column if not exists delivery_details text,
  add column if not exists delivery_cost_cents bigint;

alter table cardtrade.trade_proposals
  drop constraint if exists trade_proposals_meeting_coords_check;

alter table cardtrade.trade_proposals
  add constraint trade_proposals_meeting_coords_check
  check (
    (meeting_lat is null and meeting_lng is null)
    or (
      meeting_lat is not null
      and meeting_lng is not null
      and meeting_lat between -90 and 90
      and meeting_lng between -180 and 180
    )
  );

comment on column cardtrade.trade_proposals.handover_method is
  'IN_PERSON or DELIVERY; null on legacy proposals created before delivery terms.';
comment on column cardtrade.trade_proposals.meeting_location is
  'Agreed in-person meeting place label.';
comment on column cardtrade.trade_proposals.delivery_cost_cents is
  'Postage in integer AUD cents; 0 means free delivery.';
comment on column cardtrade.trade_proposals.delivery_details is
  'Human-readable delivery summary (price line plus optional notes).';

-- ---------------------------------------------------------------------------
-- trades — copied from the accepted proposal; editable until first ship
-- ---------------------------------------------------------------------------
alter table cardtrade.trades
  add column if not exists handover_method cardtrade.handover_method,
  add column if not exists meeting_location text,
  add column if not exists meeting_lat double precision,
  add column if not exists meeting_lng double precision,
  add column if not exists meeting_place_id text,
  add column if not exists meeting_at timestamptz,
  add column if not exists delivery_details text,
  add column if not exists delivery_cost_cents bigint;

alter table cardtrade.trades
  drop constraint if exists trades_meeting_coords_check;

alter table cardtrade.trades
  add constraint trades_meeting_coords_check
  check (
    (meeting_lat is null and meeting_lng is null)
    or (
      meeting_lat is not null
      and meeting_lng is not null
      and meeting_lat between -90 and 90
      and meeting_lng between -180 and 180
    )
  );

comment on column cardtrade.trades.handover_method is
  'IN_PERSON or DELIVERY; copied from the accepted proposal.';
comment on column cardtrade.trades.meeting_location is
  'Agreed in-person meeting place label.';
comment on column cardtrade.trades.delivery_cost_cents is
  'Postage in integer AUD cents; 0 means free delivery.';
comment on column cardtrade.trades.delivery_details is
  'Human-readable delivery summary (price line plus optional notes).';

-- ---------------------------------------------------------------------------
-- finalize_trade_acceptance — also copy handover terms
-- ---------------------------------------------------------------------------
drop function if exists cardtrade.finalize_trade_acceptance(
  uuid, uuid, uuid, uuid, uuid, uuid[], uuid, bigint, cardtrade.trade_cash_direction
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
  p_cash_direction cardtrade.trade_cash_direction,
  p_handover_method cardtrade.handover_method default null,
  p_meeting_location text default null,
  p_meeting_lat double precision default null,
  p_meeting_lng double precision default null,
  p_meeting_place_id text default null,
  p_meeting_at timestamptz default null,
  p_delivery_details text default null,
  p_delivery_cost_cents bigint default null
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
  if p_handover_method is distinct from v_proposal.handover_method
    or p_meeting_location is distinct from v_proposal.meeting_location
    or p_meeting_lat is distinct from v_proposal.meeting_lat
    or p_meeting_lng is distinct from v_proposal.meeting_lng
    or p_meeting_place_id is distinct from v_proposal.meeting_place_id
    or p_meeting_at is distinct from v_proposal.meeting_at
    or p_delivery_details is distinct from v_proposal.delivery_details
    or p_delivery_cost_cents is distinct from v_proposal.delivery_cost_cents then
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
      cash_direction = p_cash_direction,
      handover_method = p_handover_method,
      meeting_location = p_meeting_location,
      meeting_lat = p_meeting_lat,
      meeting_lng = p_meeting_lng,
      meeting_place_id = p_meeting_place_id,
      meeting_at = p_meeting_at,
      delivery_details = p_delivery_details,
      delivery_cost_cents = p_delivery_cost_cents
  where id = p_trade_id;

  update cardtrade.trade_proposals
  set status = 'ACCEPTED', trade_id = p_trade_id, responded_at = now()
  where id = p_proposal_id returning * into v_proposal;
  return v_proposal;
end;
$$;

revoke all on function cardtrade.finalize_trade_acceptance(
  uuid, uuid, uuid, uuid, uuid, uuid[], uuid, bigint, cardtrade.trade_cash_direction,
  cardtrade.handover_method, text, double precision, double precision, text, timestamptz, text, bigint
) from public, anon, authenticated;

grant execute on function cardtrade.finalize_trade_acceptance(
  uuid, uuid, uuid, uuid, uuid, uuid[], uuid, bigint, cardtrade.trade_cash_direction,
  cardtrade.handover_method, text, double precision, double precision, text, timestamptz, text, bigint
) to service_role;
