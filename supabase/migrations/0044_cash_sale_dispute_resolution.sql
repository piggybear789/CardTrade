-- 0044_cash_sale_dispute_resolution.sql
--
-- Give a disputed Cash_Sale a way out.
--
-- THE PROBLEM. `disputeCashSale` moved a sale to DISPUTED and stopped. Nothing in
-- the codebase resolved it: there was no refund primitive on the payment seam, no
-- resolution action, and no operator control. The `REFUNDED` status existed in the
-- enum and the badge component rendered it, but nothing ever set it. So a disputed
-- sale parked the Buyer's money in the platform balance permanently — while
-- `HandoverFailedDialog` told the Buyer in plain text that they would be refunded.
--
-- THREE OUTCOMES, all operator-decided. There is no automated arbiter, and the
-- platform is merchant of record, so a human decides and the decision is recorded:
--
--   REFUND_BUYER    full refund; the sale ends REFUNDED and the item returns to the
--                   catalog so the Seller can relist it
--   PARTIAL_REFUND  the Buyer keeps the item at a reduced price; the sale COMPLETES
--                   and the Seller is released the remainder. This is the cash-sale
--                   analogue of the trade Friction_Tax
--   RELEASE_SELLER  dispute not upheld; the sale COMPLETES and the Seller is
--                   released in full
--
-- WHY THE REFUND NEEDS ITS OWN NONCE. A refund spends money the platform is
-- holding on someone's behalf. If a resolution is retried after an ambiguous
-- provider timeout, replaying the same nonce makes the provider deduplicate;
-- generating a fresh one would refund the Buyer twice out of platform funds. The
-- nonce is therefore assigned ONCE, persisted, and reused verbatim — the same rule
-- `seller_payout_nonce` follows for releases.
--
-- The payout status enum is reused rather than duplicated: NOT_DUE / PENDING /
-- SETTLED / FAILED describes a refund exactly as well as a release.

alter table cardtrade.cash_sales
  -- Which outcome an operator chose. Null until a dispute is resolved.
  add column if not exists dispute_resolution text
    check (dispute_resolution in ('REFUND_BUYER', 'PARTIAL_REFUND', 'RELEASE_SELLER')),
  add column if not exists dispute_resolved_at timestamptz,
  add column if not exists dispute_resolved_by uuid references cardtrade.profiles(id),
  -- How much was returned to the Buyer. Zero for RELEASE_SELLER.
  add column if not exists refund_cents bigint not null default 0
    check (refund_cents >= 0),
  add column if not exists refund_status cardtrade.cash_sale_payout_status
    not null default 'NOT_DUE',
  add column if not exists refund_ref text,
  add column if not exists refund_nonce text,
  add column if not exists refund_error text,
  add column if not exists refund_attempts integer not null default 0;

comment on column cardtrade.cash_sales.dispute_resolution is
  'Operator decision on a DISPUTED sale: REFUND_BUYER (full refund, sale ends '
  'REFUNDED), PARTIAL_REFUND (buyer keeps the item at a reduced price, remainder '
  'released to the seller), or RELEASE_SELLER (dispute not upheld).';

comment on column cardtrade.cash_sales.refund_nonce is
  'Idempotency key for the refund, assigned once and reused verbatim on every '
  'retry. Regenerating it would refund the buyer twice out of platform funds.';

comment on column cardtrade.cash_sales.refund_cents is
  'Amount returned to the buyer, in integer AUD cents. Subtracted from the '
  'seller release, so seller net is amount - platform_fee - refund.';

-- A resolution is only meaningful once, so the nonce is assigned by a guarded
-- function rather than by the caller. Mirrors `mark_cash_sale_payout_due`: only a
-- NOT_DUE refund transitions, so a repeat call is a harmless no-op that returns
-- the current state.
create or replace function cardtrade.mark_cash_sale_refund_due(
  p_cash_sale_id uuid,
  p_amount_cents bigint
)
returns cardtrade.cash_sale_payout_status
language plpgsql
security definer
set search_path to 'cardtrade', 'pg_temp'
as $function$
declare
  v_status cardtrade.cash_sale_payout_status;
begin
  update cardtrade.cash_sales
  set refund_status = 'PENDING',
      refund_cents = p_amount_cents,
      refund_nonce = coalesce(refund_nonce, 'refund:' || id::text),
      updated_at = now()
  where id = p_cash_sale_id
    and status = 'DISPUTED'
    and refund_status = 'NOT_DUE'
  returning refund_status into v_status;

  if v_status is null then
    select refund_status into v_status
    from cardtrade.cash_sales where id = p_cash_sale_id;
  end if;

  return v_status;
end;
$function$;

comment on function cardtrade.mark_cash_sale_refund_due is
  'Queues a refund on a DISPUTED Cash_Sale, assigning a stable idempotency nonce. '
  'Safe to call repeatedly; only a NOT_DUE refund transitions.';

-- Operators triage disputed sales oldest-first, so index the open ones.
create index if not exists cash_sales_disputed_idx
  on cardtrade.cash_sales (disputed_at)
  where status = 'DISPUTED';
