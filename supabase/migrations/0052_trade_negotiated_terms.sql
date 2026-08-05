-- 0052_trade_negotiated_terms.sql
--
-- Step 2: versioned terms and bilateral acceptance on the Trade itself, so a
-- Trade row can exist from the FIRST offer and the whole negotiation happens in
-- the contract room.
--
-- This is the same pattern `cash_sales` already uses (terms_version + a per-party
-- accepted version, with a trigger that bumps the version and clears both ticks
-- on any substantive edit). Reusing it deliberately: a counter-offer is a terms
-- revision, not a new row, which is what removes the chain of replacement
-- `trade_proposals` and lets the thread stay continuous.
--
-- Requires 0051 for the NEGOTIATING / CANCELLED enum labels.

alter table cardtrade.trades
  add column if not exists terms_version integer not null default 1,
  add column if not exists terms_updated_at timestamptz,
  add column if not exists initiator_terms_accepted_version integer,
  add column if not exists counterpart_terms_accepted_version integer,
  add column if not exists initiator_terms_accepted_at timestamptz,
  add column if not exists counterpart_terms_accepted_at timestamptz,
  -- The opening note, and each counter's note. Previously `trade_proposals.message`.
  add column if not exists offer_message text,
  -- Agreed value basis for bond sizing. Previously `trade_proposals.declared_value_cents`.
  add column if not exists declared_value_cents bigint,
  add column if not exists cancelled_by uuid references cardtrade.profiles(id),
  add column if not exists cancel_reason text,
  add column if not exists cancelled_at timestamptz;

alter table cardtrade.trades
  drop constraint if exists trades_terms_version_positive,
  add constraint trades_terms_version_positive check (terms_version > 0);

alter table cardtrade.trades
  drop constraint if exists trades_cancel_reason_length,
  add constraint trades_cancel_reason_length check (
    cancel_reason is null or char_length(cancel_reason) between 1 and 500
  );

comment on column cardtrade.trades.terms_version is
  'Monotonic version of the negotiated terms. Bumped by reset_trade_terms_acceptances on any substantive edit.';
comment on column cardtrade.trades.initiator_terms_accepted_version is
  'The terms_version this trader accepted. Equal to terms_version means they accept what is on the table now.';

-- Every existing Trade was created by accepting a proposal, so its terms were
-- already agreed by both sides. Backfill both ticks to the current version or the
-- room would show live trades as awaiting an acceptance that already happened.
update cardtrade.trades
set initiator_terms_accepted_version = terms_version,
    counterpart_terms_accepted_version = terms_version,
    initiator_terms_accepted_at = coalesce(initiator_terms_accepted_at, created_at),
    counterpart_terms_accepted_at = coalesce(counterpart_terms_accepted_at, created_at)
where initiator_terms_accepted_version is null
   or counterpart_terms_accepted_version is null;

/**
 * Bump the terms version and clear both acceptances whenever the negotiable
 * terms change, so neither party can be carried into escrow on an acceptance of
 * terms that no longer exist.
 */
create or replace function cardtrade.reset_trade_terms_acceptances()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Terms are negotiable only before collateral is sought. COLLATERAL_PENDING is
  -- tolerated WITHOUT versioning purely because the legacy
  -- `finalize_trade_acceptance` path writes the agreed terms onto the row after
  -- inserting it in that state. Tighten this to NEGOTIATING alone once the
  -- trade_proposals path is removed.
  if old.state = 'COLLATERAL_PENDING' then
    return new;
  end if;
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

drop trigger if exists trades_reset_terms_acceptances on cardtrade.trades;
create trigger trades_reset_terms_acceptances
before update of cash_amount_cents, cash_direction, declared_value_cents,
  handover_method, meeting_location, meeting_lat, meeting_lng, meeting_place_id,
  meeting_at, delivery_details, delivery_cost_cents
on cardtrade.trades
for each row execute function cardtrade.reset_trade_terms_acceptances();

-- The counterpart's "needs your answer" queue, and the initiator's outstanding
-- offers. Partial so it stays small: negotiations are short-lived relative to the
-- table.
create index if not exists trades_negotiating_counterpart_idx
  on cardtrade.trades (counterpart_id, created_at desc)
  where state = 'NEGOTIATING';
create index if not exists trades_negotiating_initiator_idx
  on cardtrade.trades (initiator_id, created_at desc)
  where state = 'NEGOTIATING';
