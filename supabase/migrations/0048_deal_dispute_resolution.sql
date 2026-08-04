-- 0048_deal_dispute_resolution.sql
--
-- Give a disputed private deal a way out.
--
-- THE DEAD END THIS CLOSES. `raiseDealDispute` moved a binding deal from
-- ESCROW_LOCKED to DISPUTED and stopped there. Nothing in the codebase read
-- DISPUTED afterwards: no participant action, no admin action, no job. The cash
-- authorisation stayed HELD and both collateral holds stayed ACTIVE, forever. The
-- deal room told the parties "collateral stays held while the dispute is reviewed",
-- and `deal_payment_status` carried a REFUNDED value that nothing could ever write.
--
-- Worse than a missing feature: card authorisations lapse in about seven days, so
-- the escrow guarantee quietly evaporated instead of resolving. Whoever was in the
-- wrong got their collateral back by waiting.
--
-- WHY NO NEW deal_state. A resolved dispute is terminal, and the two terminal
-- meanings already exist: COMPLETED (the exchange stood) and CANCELLED (it was
-- unwound). `dispute_outcome` is what distinguishes "cancelled before it became
-- binding" from "unwound by an arbitrator", so a third state would encode the same
-- fact twice — the exact shape of the kyc_status/merchant_status problem.
--
-- WHY NO REFUND NONCE, unlike cash sales. A disputed deal's cash is still an
-- uncaptured authorisation: settlement only happens at COMPLETED. Returning it is
-- `paymentIntents.cancel` or a partial `capture` — a state transition on one known
-- PaymentIntent, not a new money movement — so there is nothing for an idempotency
-- key to protect. A cash sale is collected up front, which is why THAT refund needs
-- a persisted nonce and this one does not.

-- ---------------------------------------------------------------------------
-- A deal is now an arbitration case kind
-- ---------------------------------------------------------------------------

-- Deals were absent from the arbitration workspace, which is why the dead end went
-- unnoticed: there was no queue a disputed deal could appear in.
alter type cardtrade.arbitration_case_kind add value if not exists 'DEAL';

-- ---------------------------------------------------------------------------
-- How an arbitrator resolved it
-- ---------------------------------------------------------------------------

do $$ begin
  create type cardtrade.deal_dispute_outcome as enum (
    -- The exchange did not stand. The cash authorisation is released in full and
    -- both collateral holds are voided. Nobody is charged anything.
    'REFUND_PAYER',
    -- The parties keep the goods on adjusted terms: part of the cash is captured
    -- for the recipient and the remainder released to the payer.
    'SPLIT',
    -- The dispute was not upheld. The cash is captured in full for the recipient
    -- and the deal completes as if both parties had marked it done.
    'RELEASE_RECIPIENT'
  );
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Dispute + resolution on the deal
-- ---------------------------------------------------------------------------

alter table cardtrade.deals
  add column if not exists disputed_at timestamptz,
  add column if not exists dispute_raised_by uuid references cardtrade.profiles(id),
  add column if not exists dispute_reason text,
  add column if not exists dispute_outcome cardtrade.deal_dispute_outcome,
  add column if not exists dispute_resolved_by uuid references cardtrade.profiles(id),
  add column if not exists dispute_resolved_at timestamptz,
  add column if not exists dispute_resolution_note text;

comment on column cardtrade.deals.disputed_at is
  'When a party raised a dispute. Drives arbitration queue age and SLA.';
comment on column cardtrade.deals.dispute_reason is
  'The claimant''s own words. An allegation, never treated as an established fact.';
comment on column cardtrade.deals.dispute_outcome is
  'Non-null only once an arbitrator decided. Distinguishes an arbitrated unwind from a pre-binding cancellation, both of which land in CANCELLED.';
comment on column cardtrade.deals.dispute_resolved_by is
  'The staff member who decided. Written from the session, never from a payload.';

-- The queue reads open disputes; partial so it stays small as deals accumulate.
create index if not exists deals_open_dispute_idx
  on cardtrade.deals (disputed_at)
  where state = 'DISPUTED';

-- ---------------------------------------------------------------------------
-- What actually moved on the cash leg
-- ---------------------------------------------------------------------------

alter table cardtrade.deal_payments
  add column if not exists captured_cents bigint not null default 0,
  add column if not exists refund_cents bigint not null default 0,
  add column if not exists refund_error text;

comment on column cardtrade.deal_payments.captured_cents is
  'Of amount_cents, how much was actually taken from the payer. Zero while HELD: a hold is an authorisation, not a collection.';
comment on column cardtrade.deal_payments.refund_cents is
  'How much of the authorisation was released back to the payer. On SPLIT this is the uncaptured remainder, which the provider releases itself.';
comment on column cardtrade.deal_payments.refund_error is
  'Why the provider refused to release or capture. Set with status FAILED so an arbitrator can retry rather than guess.';

-- captured + refunded can never exceed what was authorised.
do $$ begin
  alter table cardtrade.deal_payments
    add constraint deal_payments_settlement_within_hold
    check (captured_cents >= 0 and refund_cents >= 0
           and captured_cents + refund_cents <= amount_cents);
exception
  when duplicate_object then null;
end $$;

-- Already-settled rows predate `captured_cents`. In platform mode settlement was a
-- fullCapture of the whole authorisation, so backfill the figure rather than leaving
-- historic rows claiming nothing was ever taken.
update cardtrade.deal_payments
   set captured_cents = amount_cents
 where status = 'SETTLED'
   and captured_cents = 0;

-- ---------------------------------------------------------------------------
-- Reconcile deals already stuck in DISPUTED
-- ---------------------------------------------------------------------------

-- `raiseDealDispute` only ever wrote a deal_event, so the new columns would be null
-- for any deal already disputed and those cases would sort as "age unknown" at the
-- bottom of the queue — the oldest grievances buried deepest.
update cardtrade.deals d
   set disputed_at = e.created_at,
       dispute_raised_by = e.actor_id,
       dispute_reason = e.detail
  from (
    select distinct on (deal_id) deal_id, created_at, actor_id, detail
      from cardtrade.deal_events
     where event = 'DISPUTE_RAISED'
     order by deal_id, created_at desc
  ) e
 where d.id = e.deal_id
   and d.state = 'DISPUTED'
   and d.disputed_at is null;
