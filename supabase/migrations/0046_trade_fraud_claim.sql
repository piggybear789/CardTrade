-- 0046_trade_fraud_claim.sql
--
-- Make an Objective_Fraud determination an OPERATOR decision (Req 8.1, revised).
--
-- THE HOLE THIS CLOSES. `reportFraud` was gated on `requireParticipant` and nothing
-- else, and `reportObjectiveFraud` then treated the caller as the victim
-- unconditionally. So either trader in a 2-way escrow could, on their own:
--
--   * move the Trade to FRAUD_RESOLVED, which is terminal
--   * full-capture the counterparty's 100%-of-FMV collateral
--   * have those funds transferred to themselves
--   * have their OWN authorisation voided at zero cost
--
-- No evidence, no review, no chance for the accused to answer, and no check that the
-- claimant was not the defaulting party. It was reachable from the trade UI. In
-- effect, whoever clicked first took the other's money.
--
-- THE MODEL, mirroring what Cash_Sale disputes now do: a participant RAISES, an
-- operator DECIDES. The existing state machine already supports this exactly —
-- INSPECTION --CONDITION_DISPUTE--> DISPUTED --FRAUD_CONFIRMED--> FRAUD_RESOLVED —
-- so no transition table change is needed. What was missing was the pause in the
-- middle, and a record of who is alleging what.
--
-- A fraud CLAIM is deliberately separate from `fraud_victim_id`. The claim is what a
-- trader asserts; `fraud_victim_id` is what an operator determined. Conflating them
-- is precisely how the caller ended up being trusted as the victim.

alter table cardtrade.trades
  -- Who alleges fraud. NOT the determined victim: an operator may find against them.
  add column if not exists fraud_claimed_by uuid references cardtrade.profiles(id),
  add column if not exists fraud_claimed_against uuid references cardtrade.profiles(id),
  add column if not exists fraud_claim_reason text,
  add column if not exists fraud_claimed_at timestamptz;

comment on column cardtrade.trades.fraud_claimed_by is
  'The trader ALLEGING objective fraud. Distinct from fraud_victim_id, which is '
  'the operator''s determination — a claimant may be found against.';

comment on column cardtrade.trades.fraud_claim_reason is
  'The claimant''s own account of what happened. Shown to the operator and to the '
  'accused; never treated as established fact.';

-- Operators triage disputed trades oldest-first, same as disputed sales.
create index if not exists trades_disputed_idx
  on cardtrade.trades (disputed_at)
  where state = 'DISPUTED';

-- Record a fraud claim on a trade the claimant is party to.
--
-- Guarded in SQL so the participant check and the write are atomic, and so the
-- claim cannot be recorded against a trade that has already been decided. Only a
-- DISPUTED or INSPECTION trade accepts a claim; a FRAUD_RESOLVED or COMPLETED one
-- is finished.
--
-- Idempotent: a second claim by the same trader does not overwrite the first
-- timestamp, so "who spoke first" stays accurate.
create or replace function cardtrade.record_trade_fraud_claim(
  p_trade_id uuid,
  p_claimant_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path to 'cardtrade', 'pg_temp'
as $function$
declare
  v_trade cardtrade.trades;
  v_accused uuid;
begin
  select * into v_trade from cardtrade.trades where id = p_trade_id;
  if v_trade.id is null then
    return false;
  end if;

  -- Participation, checked here as well as in the action layer.
  if p_claimant_id not in (v_trade.initiator_id, v_trade.counterpart_id) then
    return false;
  end if;

  if v_trade.state not in ('INSPECTION', 'DISPUTED') then
    return false;
  end if;

  v_accused := case
    when p_claimant_id = v_trade.initiator_id then v_trade.counterpart_id
    else v_trade.initiator_id
  end;

  update cardtrade.trades
  set fraud_claimed_by = coalesce(fraud_claimed_by, p_claimant_id),
      fraud_claimed_against = coalesce(fraud_claimed_against, v_accused),
      fraud_claim_reason = coalesce(fraud_claim_reason, p_reason),
      fraud_claimed_at = coalesce(fraud_claimed_at, now()),
      updated_at = now()
  where id = p_trade_id;

  return true;
end;
$function$;

comment on function cardtrade.record_trade_fraud_claim is
  'Records a participant''s allegation of objective fraud on a trade in INSPECTION '
  'or DISPUTED. Records the claim only — capturing collateral is an operator '
  'decision made separately. Idempotent: the first claim stands.';
