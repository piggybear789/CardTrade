-- 0038_cash_sale_seller_payout.sql
--
-- Adds the RELEASE leg of Cash_Sale escrow (Req 4.3).
--
-- THE BUG THIS FIXES. Collection already happened upfront: the second party to
-- accept terms triggered `requestTransfer`, debiting the Buyer. But nothing ever
-- paid the Seller. `acceptCashSaleInspection` and `confirmCashSaleHandover` moved
-- the sale to COMPLETED and the Item to SOLD without moving any money, and there
-- was no second transfer anywhere in the cash-sale path. So:
--
--   * PAYOUT_MODE=platform (the default) — the Buyer was charged, the funds sat
--     in the platform balance, and the Seller was NEVER PAID.
--   * PAYOUT_MODE=direct — the collection call passed merchantRef, so Stripe
--     forwarded to the Seller at AGREEMENT time, before shipping or inspection.
--     There was no escrow at all.
--
-- Both are now replaced by: always collect to the platform balance, then release
-- explicitly on completion via `payoutToMerchant`.

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'cardtrade' and t.typname = 'cash_sale_payout_status') then
    create type cardtrade.cash_sale_payout_status as enum (
      -- Completion has not been reached, so no release is due yet.
      'NOT_DUE',
      -- Completion reached; the release is owed but not yet settled.
      'PENDING',
      -- Net proceeds have landed in the Seller's connected account.
      'SETTLED',
      -- The provider rejected the release. Needs operator attention: the
      -- platform is holding money that belongs to the Seller.
      'FAILED'
    );
  end if;
end
$$;

alter table cardtrade.cash_sales
  add column if not exists seller_payout_status
    cardtrade.cash_sale_payout_status not null default 'NOT_DUE',
  -- Provider transfer id (`tr_...`) once released.
  add column if not exists seller_payout_ref text,
  /*
   * Idempotency key for the release, generated ONCE when the payout first falls
   * due and reused verbatim on every retry. Without a persisted key a retry
   * after an ambiguous timeout would pay the Seller twice out of platform funds.
   */
  add column if not exists seller_payout_nonce text,
  add column if not exists seller_payout_due_at timestamptz,
  add column if not exists seller_payout_at timestamptz,
  add column if not exists seller_payout_attempts integer not null default 0,
  add column if not exists seller_payout_error text;

comment on column cardtrade.cash_sales.seller_payout_status is
  'Release leg of escrow (Req 4.3). NOT_DUE until completion. FAILED means the '
  'platform is holding funds owed to the Seller and an operator must intervene.';

comment on column cardtrade.cash_sales.seller_payout_nonce is
  'Persisted idempotency key for the release. Generated once when the payout '
  'falls due; retries MUST reuse it so an ambiguous timeout cannot double-pay.';

-- The operator/worker queue: releases that are owed and not yet settled.
create index if not exists cash_sales_payout_pending_idx
  on cardtrade.cash_sales (seller_payout_due_at)
  where seller_payout_status in ('PENDING', 'FAILED');

-- ---------------------------------------------------------------------------
-- Mark the release as due
-- ---------------------------------------------------------------------------

-- Called both from the orchestrator on interactive completion and from the
-- auto-complete cron, so a Cash_Sale that completes on a timer still queues its
-- release rather than silently stranding the funds.
create or replace function cardtrade.mark_cash_sale_payout_due(p_cash_sale_id uuid)
returns cardtrade.cash_sale_payout_status
language plpgsql
security definer
set search_path to 'cardtrade', 'pg_temp'
as $function$
declare
  v_status cardtrade.cash_sale_payout_status;
begin
  update cardtrade.cash_sales
  set seller_payout_status = 'PENDING',
      seller_payout_due_at = coalesce(seller_payout_due_at, now()),
      -- Generated once and then left alone; see the column comment.
      seller_payout_nonce = coalesce(seller_payout_nonce, 'payout:' || id::text),
      updated_at = now()
  where id = p_cash_sale_id
    and status = 'COMPLETED'
    and seller_payout_status = 'NOT_DUE'
  returning seller_payout_status into v_status;

  if v_status is null then
    select seller_payout_status into v_status
    from cardtrade.cash_sales where id = p_cash_sale_id;
  end if;

  return v_status;
end;
$function$;

comment on function cardtrade.mark_cash_sale_payout_due is
  'Queues the Seller release for a COMPLETED Cash_Sale, assigning a stable '
  'idempotency nonce. Safe to call repeatedly; only NOT_DUE transitions.';

-- ---------------------------------------------------------------------------
-- Teach the auto-complete pass to queue the release
-- ---------------------------------------------------------------------------

-- Rewritten from 0029: identical completion logic, plus the payout queueing that
-- was missing. A sale auto-completed on a timer previously left the Buyer's money
-- in the platform balance with nothing scheduled to release it.
create or replace function cardtrade.auto_complete_due_cash_sales()
returns integer
language plpgsql
security definer
set search_path to 'cardtrade', 'pg_temp'
as $function$
declare
  v_completed integer := 0;
  r record;
begin
  for r in
    select id, item_id from cardtrade.cash_sales
    where status = 'INSPECTION'
      and inspection_deadline_at is not null
      and inspection_deadline_at <= now()
    for update skip locked
  loop
    update cardtrade.cash_sales
    set status = 'COMPLETED', completed_at = now(), auto_completed = true, updated_at = now()
    where id = r.id and status = 'INSPECTION';

    update cardtrade.items set status = 'SOLD', updated_at = now()
    where id = r.item_id and status = 'RESERVED';

    insert into cardtrade.cash_sale_events (cash_sale_id, actor_id, event, from_status, to_status, detail)
    values (r.id, null, 'AUTO_COMPLETED', 'INSPECTION', 'COMPLETED',
      'Inspection window of ' || cardtrade.cash_sale_inspection_days() || ' days expired after carrier-confirmed delivery.');

    -- The money still has to reach the Seller.
    perform cardtrade.mark_cash_sale_payout_due(r.id);

    v_completed := v_completed + 1;
  end loop;

  return v_completed;
end;
$function$;
