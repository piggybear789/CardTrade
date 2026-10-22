-- 0158_cash_sale_payment_method.sql
--
-- How a cash-sale buyer paid (domain/payments/paymentMethods.ts). Card stays the
-- default; a buyer whose bank runs one may instead pay with Instant Bank Payments (US),
-- iDEAL, Bancontact, EPS, Przelewy24 or PayTo. Each rail carries its own Service_Fee, so
-- the claim that starts payment writes the chosen rail together with the fee and the
-- total priced for it (`claimPayment`), and `amount_cents - platform_fee_cents` (the
-- seller's net) always describes the rail actually charged.
--
-- NULL means card: every row written before this migration, and every card claim on a
-- contract still priced for card, which writes nothing new.
--
-- No trigger change. `cash_sales_reset_acceptances` (0050) does not watch
-- `platform_fee_cents`, `amount_cents` or this column, and since 0099 payment is the
-- commitment, so re-pricing at the claim voids nothing.
--
-- Direct debits (BECS, SEPA, Bacs, ACH) are deliberately absent from the CHECK: their
-- payer can reverse them long after the seller is paid, with no evidence process.

alter table cardtrade.cash_sales
  add column if not exists payment_method_kind text
    check (payment_method_kind in ('CARD', 'US_BANK', 'IDEAL', 'BANCONTACT', 'EPS', 'P24', 'PAYTO'));

comment on column cardtrade.cash_sales.payment_method_kind is
  'How the buyer chose to pay at the last payment claim; the rail platform_fee_cents and amount_cents are priced for. NULL is card. Written only by the service role (claimPayment).';

-- Members read cash_sales through column grants. The contract room reads this through
-- CASH_SALE_PUBLIC_SELECT to price the Pay options and to resume a bank approval.
grant select (payment_method_kind) on cardtrade.cash_sales to authenticated;
