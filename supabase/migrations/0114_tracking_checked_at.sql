-- 0114_tracking_checked_at.sql
--
-- READ-TRIGGERED CARRIER CHECKS NEED A THROTTLE, AND THIS IS IT.
--
-- Opening a contract room now asks the carrier where the parcel is, after the response
-- has been sent (`after()` in lib/tracking/refreshOnRead.ts). That is the right trigger —
-- the question is asked exactly when somebody wants the answer, and never for a contract
-- nobody is looking at — but a page view is not a rate limit. The room re-renders on
-- every realtime message, every navigation and every `router.refresh()`, so without a
-- recorded "last asked" the provider would be called several times a minute per open
-- room, per viewer.
--
-- WHY A COLUMN AND NOT AN IN-MEMORY CACHE. Serverless: there is no single process to hold
-- the map, and two concurrent visitors would each see an empty one. The claim has to be
-- atomic against the row itself — `update ... where tracking_checked_at is null or
-- tracking_checked_at < now() - interval` returns the row to exactly one caller, and that
-- is what stops both parties' visits firing the same lookup.
--
-- STAMPED EVEN WHEN THE LOOKUP FAILS. A provider that is down or rate-limiting must not
-- be retried on every subsequent page view; the next visit after the window is soon
-- enough. That is a deliberate choice in the caller, recorded here because it is the
-- reason this is "checked at" and not "delivered at".
--
-- NOT A MEMBER-WRITABLE COLUMN. Only `service_role` may write it, like every other
-- column the tracking bindings maintain: a member who could backdate it would be able to
-- force a carrier lookup at will, and one who could forward-date it would be able to
-- suppress the delivery that starts their own inspection clock.

-- ---------------------------------------------------------------------------
-- Cash sales: one outbound parcel per contract.
-- ---------------------------------------------------------------------------
alter table cardtrade.cash_sales
  add column if not exists tracking_checked_at timestamptz;

comment on column cardtrade.cash_sales.tracking_checked_at is
  'When the carrier was last asked about the outbound parcel, successful or not. '
  'Throttles the read-triggered check in lib/tracking/refreshOnRead.ts. Never a '
  'delivery record — carrier_delivered_at is the only one of those.';

-- ---------------------------------------------------------------------------
-- Trades: two parcels, so two clocks.
-- ---------------------------------------------------------------------------
--
-- Per side rather than per trade, because the two parcels are posted independently and
-- one side landing says nothing about the other. A single column would let a check on
-- the initiator's parcel suppress the counterpart's for the rest of the window.
alter table cardtrade.trades
  add column if not exists initiator_tracking_checked_at timestamptz;

alter table cardtrade.trades
  add column if not exists counterpart_tracking_checked_at timestamptz;

comment on column cardtrade.trades.initiator_tracking_checked_at is
  'When the carrier was last asked about the initiator''s parcel. Throttle only.';

comment on column cardtrade.trades.counterpart_tracking_checked_at is
  'When the carrier was last asked about the counterpart''s parcel. Throttle only.';

-- ---------------------------------------------------------------------------
-- Indexes for the sweep-shaped read.
-- ---------------------------------------------------------------------------
--
-- The claim query is "this contract, if it is due", so the primary key does the work and
-- no index is needed for the room. These exist for the LIST surfaces, which ask the same
-- question about the handful of in-transit contracts on screen, and for any future
-- operator view that wants to see what has gone stale.
create index if not exists cash_sales_tracking_due_idx
  on cardtrade.cash_sales (tracking_checked_at)
  where status = 'IN_TRANSIT' and tracking_number is not null;

create index if not exists trades_tracking_due_idx
  on cardtrade.trades (state)
  where state = 'IN_TRANSIT';

-- Column grants last, per the convention in the tech steering doc: a `grant select (col)`
-- contains the literal `select (`, which the identity-gate property test's
-- trigger-function regex matches across newlines when it appears earlier in a file.
--
-- SELECT for members so the room can read its own throttle state (it is in
-- CASH_SALE_PUBLIC_SELECT); no INSERT or UPDATE for anyone but service_role, which holds
-- table-level UPDATE already.
grant select (tracking_checked_at) on cardtrade.cash_sales to authenticated;
grant select (initiator_tracking_checked_at, counterpart_tracking_checked_at)
  on cardtrade.trades to authenticated;
