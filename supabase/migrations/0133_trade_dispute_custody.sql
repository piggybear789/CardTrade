-- 0133_trade_dispute_custody.sql
--
-- Trade disputes stop destroying the collateral (ESC-01, ESC-07, ESC-10), handover
-- terms lock once collateral is near (ESC-04), and the authorisation budget moves
-- to the 114-hour Visa merchant-initiated window (ESC-17a).
--
-- 1. Nothing is captured when a dispute is RAISED any more. A staff outcome moves
--    the money, and a custody backstop captures a live hold into the platform
--    balance shortly before it would lapse. The columns below record that custody,
--    the outcome, and the fraud claim.
-- 2. `collateral_disbursements`: every movement OUT of a captured hold (refund,
--    payout to a wronged trader, platform share) gets a row with a persisted nonce,
--    a release instant and a status, so retries are idempotent and custody can
--    count it.
-- 3. `trade_handover_changes`: from COLLATERAL_PENDING a handover edit is a
--    proposal the other trader accepts, never a silent write.
-- 4. `trades_lock_handover`: the database backstop. Handover columns cannot change
--    once collateral is locked, or inside the placement lead before the meeting.
-- 5. `restore_trade_items_if_unclaimed`: the only safe way to put a trade's cards
--    back on sale. Never un-sells an item and never releases one another live
--    contract holds.
-- 6. Pinned clock functions for the margin and the placement lead, compared with
--    the TypeScript constants by tests/unit/tradeClockAgreement.test.ts.
-- 7. Live holds carrying the old seven-day planning expiry are FLAGGED for the
--    hourly re-estimate (R4-M5). This migration does not rewrite expires_at: the
--    `:17` job reads the provider deadline back first.
-- 8. `describe_trade_event` redefined from the full 0107 body, plus the new codes.
--
-- Grants are at the END of the file, after every function body.

-- ---------------------------------------------------------------------------
-- 1. Custody, outcome and claim columns
-- ---------------------------------------------------------------------------

alter table cardtrade.pre_auth_holds
  -- Set when the custody backstop (or a pending fraud finding) full-captured this
  -- hold into the platform balance. Distinguishes a custody capture, whose money is
  -- still owed to someone, from a finished fraud capture.
  add column if not exists custody_captured_at timestamptz,
  -- Dedup for the 24-hour pre-warning both traders get before custody.
  add column if not exists custody_warned_at timestamptz,
  -- The expiry is a planning estimate, not the provider's capture_before. The hourly
  -- re-estimate reads the real deadline back and clears this.
  add column if not exists expires_at_estimated boolean not null default false;

-- The fraud CLAIM columns (fraud_claimed_by, fraud_claimed_against,
-- fraud_claim_reason, fraud_claimed_at) already exist from 0046 and are reused by
-- the new FRAUD_CLAIMED event; they are not added again here.
alter table cardtrade.trades
  add column if not exists dispute_outcome text
    check (dispute_outcome in ('UNFOUNDED', 'CONDITION', 'FRAUD', 'NO_EXCHANGE')),
  -- Which holds the backstop may take. 'ALL' by default: capturing only the accused
  -- would let whoever files first decide whose collateral survives. Only staff can
  -- narrow it.
  add column if not exists custody_scope text not null default 'ALL'
    check (custody_scope in ('ALL', 'ACCUSED_ONLY')),
  add column if not exists custody_accused_id uuid references cardtrade.profiles(id),
  -- Staff attestation that the goods changed hands on a trade that never reached
  -- INSPECTION. Required before UNFOUNDED or CONDITION can release a cash leg.
  add column if not exists dispute_goods_exchanged_attested_by uuid
    references cardtrade.profiles(id),
  add column if not exists dispute_goods_exchanged_attested_at timestamptz;

alter table cardtrade.profiles
  -- Disputes this member raised that staff found UNFOUNDED. A triage signal, never a
  -- priority weight.
  add column if not exists unfounded_dispute_count integer not null default 0;

-- ---------------------------------------------------------------------------
-- 2. collateral_disbursements
-- ---------------------------------------------------------------------------

create table if not exists cardtrade.collateral_disbursements (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references cardtrade.trades(id) on delete restrict,
  -- The captured hold the money comes out of (pre_auth_holds.hold_ref).
  hold_ref text not null,
  kind text not null check (kind in ('REFUND', 'PAYOUT', 'PLATFORM_RETAINED')),
  -- Who receives it. Null for PLATFORM_RETAINED.
  payee_id uuid references cardtrade.profiles(id),
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null,
  -- Persisted idempotency key, reused verbatim on every retry.
  nonce text not null unique,
  status cardtrade.cash_sale_payout_status not null default 'PENDING',
  provider_ref text,
  -- When the release policy allows it to move. Null means "next drain".
  release_at timestamptz,
  -- Why it is held: CHARGE_DISPUTE, FRAUD_WARNING or STAFF.
  hold_reason text,
  attempts integer not null default 0,
  last_error text,
  -- Set once the payee was told a payout could not be made, so it is said once.
  failure_notified_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists collateral_disbursements_trade_idx
  on cardtrade.collateral_disbursements (trade_id);
create index if not exists collateral_disbursements_due_idx
  on cardtrade.collateral_disbursements (status, release_at);

alter table cardtrade.collateral_disbursements enable row level security;

drop policy if exists collateral_disbursements_participant_select
  on cardtrade.collateral_disbursements;
create policy collateral_disbursements_participant_select
  on cardtrade.collateral_disbursements for select to authenticated
  using (
    exists (
      select 1
      from cardtrade.trades t
      where t.id = collateral_disbursements.trade_id
        and (select auth.uid()) in (t.initiator_id, t.counterpart_id)
    )
    or (select cardtrade.is_staff())
  );

comment on table cardtrade.collateral_disbursements is
  'Every movement out of a captured trade hold: refund, payout to a wronged trader, '
  'or the platform share. Written by the service role only; drained by the hourly '
  'payouts job through releasePolicy.';

-- ---------------------------------------------------------------------------
-- 3. trade_handover_changes
-- ---------------------------------------------------------------------------

create table if not exists cardtrade.trade_handover_changes (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references cardtrade.trades(id) on delete cascade,
  proposed_by uuid not null references cardtrade.profiles(id),
  -- The proposed HandoverTermsColumns, validated at proposal and again at accept.
  terms jsonb not null,
  created_at timestamptz not null default now(),
  -- The placement cutoff of the meeting current at proposal time.
  expires_at timestamptz not null,
  decided_at timestamptz,
  decided_by uuid references cardtrade.profiles(id),
  decision text check (decision in ('ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN')),
  constraint trade_handover_changes_decided_check check (
    (decided_at is null and decision is null)
    or (decided_at is not null and decision is not null)
  )
);

-- At most one undecided proposal per trade.
create unique index if not exists trade_handover_changes_one_open
  on cardtrade.trade_handover_changes (trade_id)
  where decided_at is null;

alter table cardtrade.trade_handover_changes enable row level security;

drop policy if exists trade_handover_changes_participant_select
  on cardtrade.trade_handover_changes;
create policy trade_handover_changes_participant_select
  on cardtrade.trade_handover_changes for select to authenticated
  using (
    exists (
      select 1
      from cardtrade.trades t
      where t.id = trade_handover_changes.trade_id
        and (select auth.uid()) in (t.initiator_id, t.counterpart_id)
    )
    or (select cardtrade.is_staff())
  );

comment on table cardtrade.trade_handover_changes is
  'Handover change proposals on a COLLATERAL_PENDING trade. One undecided row per '
  'trade. Written by the service role only.';

-- ---------------------------------------------------------------------------
-- 6. Pinned clock functions
-- ---------------------------------------------------------------------------

-- Slack between the close of the inspection window and the death of the
-- collateral: 114 - 24 - 72. Kept in step with COLLATERAL_MARGIN_HOURS in
-- domain/fulfilment/inspection.ts by tests/unit/tradeClockAgreement.test.ts.
create or replace function cardtrade.collateral_margin_hours()
returns integer
language sql
immutable
set search_path to 'cardtrade', 'pg_temp'
as $function$ select 18 $function$;

-- How long before the meeting collateral is placed. Kept in step with
-- BOND_PLACEMENT_LEAD_HOURS by the same test.
create or replace function cardtrade.bond_placement_lead_hours()
returns integer
language sql
immutable
set search_path to 'cardtrade', 'pg_temp'
as $function$ select 24 $function$;

-- ---------------------------------------------------------------------------
-- 7. Flag live holds that carry the old seven-day planning expiry (R4-M5)
-- ---------------------------------------------------------------------------

-- Only FLAGS. A row whose expires_at sits within ten minutes of created_at plus
-- seven days was most likely written from the planning fallback rather than from
-- a provider capture_before. Rewriting it here could move a live authorisation's
-- expiry into the past, where the :27 lapse job would mark it EXPIRED before the
-- custody sweep could try it. The :17 job reads the provider deadline back for
-- each flagged row instead, and clears the flag.
update cardtrade.pre_auth_holds
set expires_at_estimated = true
where status = 'ACTIVE'
  and expires_at is not null
  and abs(extract(epoch from (expires_at - created_at)) - 604800) < 600;

-- ---------------------------------------------------------------------------
-- 5. restore_trade_items_if_unclaimed
-- ---------------------------------------------------------------------------

-- Put back on sale ONLY the cards this trade still holds and nothing else claims.
-- A SOLD card stays SOLD, a card held by any live cash sale (returns included)
-- stays RESERVED, and a card reserved by another live trade stays RESERVED. The
-- unfiltered restore this replaces could put a sold or otherwise-reserved card
-- back in the catalog: a staff-triggered double sale. Returns the restored ids so
-- only their owners are told the listing is live again.
create or replace function cardtrade.restore_trade_items_if_unclaimed(p_trade_id uuid)
returns setof uuid
language sql
security definer
set search_path = ''
as $function$
  update cardtrade.items i
     set status = 'AVAILABLE'
   where i.id in (
           select ti.item_id
             from cardtrade.trade_items ti
            where ti.trade_id = p_trade_id
         )
     and i.status = 'RESERVED'
     and i.listing_kind = 'SINGLE'
     and not exists (
           select 1
             from cardtrade.cash_sales cs
            where cs.item_id = i.id
              and cs.status not in ('CANCELLED', 'FAILED', 'REFUNDED', 'COMPLETED')
         )
     and not exists (
           select 1
             from cardtrade.trade_items ti2
             join cardtrade.trades t2 on t2.id = ti2.trade_id
            where ti2.item_id = i.id
              and t2.id <> p_trade_id
              and t2.state in (
                'COLLATERAL_PENDING', 'COLLATERAL_LOCKED', 'IN_TRANSIT',
                'INSPECTION', 'DISPUTED'
              )
         )
  returning i.id;
$function$;

comment on function cardtrade.restore_trade_items_if_unclaimed(uuid) is
  'Returns a trade''s reserved SINGLE items to AVAILABLE only where no live cash '
  'sale or other live trade claims them. Never un-sells. Service role only.';

-- ---------------------------------------------------------------------------
-- 4. trades_lock_handover
-- ---------------------------------------------------------------------------

-- The database backstop for ESC-04. The actions refuse first; this makes the
-- refusal hold for every writer, including the admin client, which bypasses RLS.
--
-- UPDATE OF fires on the SET list rather than on a real change, so the function
-- returns at once unless a handover column actually differs.
create or replace function cardtrade.trades_lock_handover()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.handover_method is not distinct from old.handover_method
     and new.meeting_at is not distinct from old.meeting_at
     and new.meeting_location is not distinct from old.meeting_location
     and new.meeting_place_id is not distinct from old.meeting_place_id
     and new.meeting_lat is not distinct from old.meeting_lat
     and new.meeting_lng is not distinct from old.meeting_lng
     and new.delivery_details is not distinct from old.delivery_details
     and new.delivery_cost_cents is not distinct from old.delivery_cost_cents then
    return new;
  end if;

  if old.state not in ('NEGOTIATING', 'COLLATERAL_PENDING') then
    raise exception 'handover-locked'
      using errcode = 'P0001',
            detail = 'Handover terms cannot change once collateral is locked.';
  end if;

  if old.state = 'COLLATERAL_PENDING'
     and old.meeting_at is not null
     and now() >= old.meeting_at
       - make_interval(hours => cardtrade.bond_placement_lead_hours()) then
    raise exception 'handover-locked'
      using errcode = 'P0001',
            detail = 'Handover terms cannot change inside the collateral placement window.';
  end if;

  return new;
end;
$function$;

drop trigger if exists trades_lock_handover on cardtrade.trades;
create trigger trades_lock_handover
  before update of handover_method, meeting_at, meeting_location, meeting_place_id,
    meeting_lat, meeting_lng, delivery_details, delivery_cost_cents
  on cardtrade.trades
  for each row execute function cardtrade.trades_lock_handover();

-- ---------------------------------------------------------------------------
-- 8. describe_trade_event, from the full 0107 body
-- ---------------------------------------------------------------------------

create or replace function cardtrade.describe_trade_event(
  p_event text,
  p_to_state text,
  p_actor_name text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_who text := coalesce(nullif(btrim(p_actor_name), ''), 'A participant');
begin
  return case p_event
    -- Live vocabulary, `domain/state-machine/types.ts`.
    when 'TERMS_AGREED' then 'Both traders agreed the same terms. Collateral is next.'
    when 'OFFER_DECLINED' then v_who || ' declined the offer, so the trade did not open.'
    when 'HOLDS_CONFIRMED' then 'Collateral is in place — the trade is locked in.'
    when 'HOLDS_FAILED' then 'Collateral could not be arranged. The trade was cancelled.'
    when 'BOTH_SHIPPED' then 'Both sides have shipped.'
    when 'BOTH_RECEIVED' then 'Both sides have been received.'
    when 'BOTH_HANDOVER_CONFIRMED' then
      'Both traders confirmed the handover. Inspection has started.'
    when 'HANDOVER_FAILED' then
      v_who || ' reported that the exchange did not happen. The trade is frozen for review.'
    when 'BOTH_ACCEPTED' then 'Both sides accepted — this trade is complete.'
    when 'INSPECTION_EXPIRED' then
      'The inspection window closed with no objection, so the trade completed.'
    when 'CONDITION_DISPUTE' then v_who || ' raised a condition dispute.'
    when 'DISPUTE_RESOLVED' then 'The dispute was resolved.'
    when 'FRAUD_CONFIRMED' then 'This trade was closed as fraud.'

    -- 0133: events with no branch until now, and the new escrow vocabulary.
    when 'HANDOVER_ASSUMED' then
      'The meeting time passed, so the inspection window is open. Raise a problem now if anything is wrong.'
    when 'FRAUD_CLAIMED' then
      v_who || ' reported fraud on this trade. Support will review it, and nothing has been charged.'
    when 'COLLATERAL_ABANDONED' then
      'The trade was cancelled because it couldn''t be locked before the meeting. Any temporary card holds were released, and anything paid is being refunded.'
    when 'DISPUTE_UNWOUND' then
      'Support cancelled the trade because the exchange didn''t happen.'
    when 'COLLATERAL_TAKEN_INTO_CUSTODY' then
      'Support is holding the trade collateral while the case is reviewed.'

    -- Audit codes written by the scheduled SQL passes.
    when 'COLLATERAL_EXPIRED' then
      'A temporary card hold on this trade expired and the card issuer released it.'
    when 'SHIPPING_OVERDUE' then
      'The dispatch deadline passed and at least one side has not been posted.'

    -- Per-trader codes from 0016 and older rooms.
    when 'RECORD_SHIPMENT' then v_who || ' shipped their side.'
    when 'RECORD_RECEIPT' then v_who || ' received their side.'
    when 'RECORD_ACCEPTANCE' then v_who || ' accepted what they received.'

    -- Short codes carried by older rows and the demo seed. These are what the
    -- arrow shorthand was rendering.
    when 'TERMS_ACCEPTED' then v_who || ' accepted the terms.'
    when 'SHIPPED' then v_who || ' shipped their side.'
    when 'RECEIVED' then v_who || ' received their side.'
    when 'ACCEPTED' then v_who || ' accepted what they received.'

    else
      -- The destination state is the one thing an unnamed event can still state
      -- truthfully, so the fallback reports that rather than printing the code.
      case
        when coalesce(nullif(btrim(p_to_state), ''), '') = '' then
          v_who || ' updated this trade.'
        else
          v_who || ' moved this trade to ' ||
          replace(lower(p_to_state), '_', ' ') || '.'
      end
  end;
end;
$$;

comment on function cardtrade.describe_trade_event(text, text, text) is
  'Human-readable chat line for one trade_state_transitions row. 0133: the full 0107 '
  'body plus HANDOVER_ASSUMED, FRAUD_CLAIMED, COLLATERAL_ABANDONED, DISPUTE_UNWOUND, '
  'COLLATERAL_TAKEN_INTO_CUSTODY, COLLATERAL_EXPIRED and SHIPPING_OVERDUE. Replacing '
  'this function must reproduce every branch.';

-- Re-render the lines that came from the fallback for the codes this migration
-- newly names, and only those.
update cardtrade.messages m
set body = left(
  cardtrade.describe_trade_event(t.event, t.to_state::text, p.display_name),
  4000
)
from cardtrade.trade_state_transitions t
join cardtrade.trades tr on tr.id = t.trade_id
left join cardtrade.profiles p on p.id = t.requested_by
where m.conversation_id = tr.conversation_id
  and m.kind = 'SYSTEM'
  and m.system_event = t.event
  and m.created_at = t.created_at
  and t.event in ('HANDOVER_ASSUMED', 'COLLATERAL_EXPIRED', 'SHIPPING_OVERDUE');

-- ---------------------------------------------------------------------------
-- Grants (end of file)
-- ---------------------------------------------------------------------------

revoke all on cardtrade.collateral_disbursements from anon, authenticated;
grant select on cardtrade.collateral_disbursements to authenticated;
grant all on cardtrade.collateral_disbursements to service_role;

revoke all on cardtrade.trade_handover_changes from anon, authenticated;
grant select on cardtrade.trade_handover_changes to authenticated;
grant all on cardtrade.trade_handover_changes to service_role;

revoke all on function cardtrade.restore_trade_items_if_unclaimed(uuid)
  from public, anon, authenticated;
grant execute on function cardtrade.restore_trade_items_if_unclaimed(uuid) to service_role;

revoke all on function cardtrade.trades_lock_handover()
  from public, anon, authenticated;

revoke all on function cardtrade.collateral_margin_hours()
  from public, anon, authenticated;
grant execute on function cardtrade.collateral_margin_hours() to service_role;

revoke all on function cardtrade.bond_placement_lead_hours()
  from public, anon, authenticated;
grant execute on function cardtrade.bond_placement_lead_hours() to service_role;
