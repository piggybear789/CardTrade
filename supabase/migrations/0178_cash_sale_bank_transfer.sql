-- 0178_cash_sale_bank_transfer.sql
--
-- Bank transfers for cash sales (Stripe `customer_balance`, the BANK_TRANSFER rail in
-- domain/payments/paymentMethods.ts). A US buyer SENDS the money from their own bank to
-- a virtual account Stripe issues them, so it cannot be pulled back. USD only: Stripe
-- does not support `on_behalf_of` for bank transfers, and every other currency is
-- charged on behalf of the seller.
--
-- The only schema change is the vocabulary: `payment_method_kind` learns the new
-- value. The sale waits in PAYMENT_PENDING while the transfer is on its way (up to
-- BANK_TRANSFER_WAIT_HOURS), which the existing columns already describe.

alter table cardtrade.cash_sales
  drop constraint if exists cash_sales_payment_method_kind_check;

alter table cardtrade.cash_sales
  add constraint cash_sales_payment_method_kind_check
  check (payment_method_kind in (
    'CARD', 'CARD_UK_EEA', 'CARD_INTERNATIONAL',
    'US_BANK', 'IDEAL', 'BANCONTACT', 'EPS', 'P24', 'PAYTO',
    'BANK_TRANSFER'
  ));

notify pgrst, 'reload schema';
