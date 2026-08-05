-- 0055_drop_deals_and_trade_proposals.sql
--
-- Withdraw private deals and the trade-proposal step. Both modelled a
-- negotiation that the Trade lifecycle now owns natively (Req 12): a Trade is
-- created at NEGOTIATING by the first offer, countered by revising its versioned
-- terms, and enters escrow when both sides accept the same version.
--
-- VERIFIED EMPTY OF REAL MONEY BEFORE DROPPING. Every ACTIVE `deal_holds` row and
-- HELD `deal_payments` row carried a synthetic seed reference of the form
-- `deal:<uuid>:<uuid>` / `deal-cash:<uuid>` with a `...5eed...` id — never a
-- Stripe `pi_...` PaymentIntent — so no member authorisation was abandoned by
-- this drop. The single non-seed deal
-- (c66ac082-8095-49e5-9bde-be7fa6a79c0b, "Blastoise for Venusaur + cash",
-- CONFIRMATION, share token `demo-deal-token-kitsunearia`) had no holds and no
-- payments. The seed rows remain archived in `supabase/seeds/demo_lifecycle.sql`.
--
-- Had a real `pi_...` hold existed, the correct order would have been to void it
-- through the provider FIRST — an uncaptured authorisation left behind still
-- lapses on its own in about seven days, but the platform would have lost the
-- reference needed to release it deliberately.

-- Arbitration rows for a case kind that can no longer exist would otherwise
-- surface as unopenable cases in the staff queue.
delete from cardtrade.arbitration_assignments where case_kind = 'DEAL';
delete from cardtrade.arbitration_notes where case_kind = 'DEAL';

-- Conversations survive; only their deal back-reference goes.
alter table cardtrade.conversations drop column if exists deal_id;

drop table if exists cardtrade.deal_events cascade;
drop table if exists cardtrade.deal_payments cascade;
drop table if exists cardtrade.deal_holds cascade;
drop table if exists cardtrade.deals cascade;

drop table if exists cardtrade.trade_proposal_items cascade;
drop table if exists cardtrade.trade_proposals cascade;

-- Functions orphaned by the drops.
drop function if exists cardtrade.ensure_deal_conversation(uuid, uuid) cascade;
drop function if exists cardtrade.reset_deal_confirmations() cascade;
drop function if exists cardtrade.reset_deal_photo_confirmations() cascade;
drop function if exists cardtrade.guard_deal_contribution_ownership() cascade;
drop function if exists cardtrade.finalize_trade_acceptance(
  uuid, uuid, uuid, uuid, uuid, uuid[], uuid, bigint,
  cardtrade.trade_cash_direction, cardtrade.handover_method, text,
  double precision, double precision, text, timestamptz, text, bigint
) cascade;

-- Deal-only enums. `hold_status` is deliberately NOT dropped: `pre_auth_holds`
-- shares it, and dropping it would take trade collateral with it.
drop type if exists cardtrade.deal_state cascade;
drop type if exists cardtrade.deal_role cascade;
drop type if exists cardtrade.deal_dispute_outcome cascade;
drop type if exists cardtrade.deal_payment_status cascade;
drop type if exists cardtrade.trade_proposal_status cascade;

-- With the legacy acceptance path gone, terms are negotiable ONLY while
-- NEGOTIATING. 0052 tolerated COLLATERAL_PENDING purely so
-- `finalize_trade_acceptance` could write agreed terms onto a row it had just
-- inserted in that state; that function no longer exists.
create or replace function cardtrade.reset_trade_terms_acceptances()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.state <> 'NEGOTIATING' then
    raise exception 'Trade terms are locked once collateral is in play';
  end if;

  new.terms_version := old.terms_version + 1;
  new.version := old.version + 1;
  new.terms_updated_at := now();
  new.initiator_terms_accepted_version := null;
  new.counterpart_terms_accepted_version := null;
  new.initiator_terms_accepted_at := null;
  new.counterpart_terms_accepted_at := null;
  return new;
end;
$$;
