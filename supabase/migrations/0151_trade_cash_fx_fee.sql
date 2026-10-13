-- 0151_trade_cash_fx_fee.sql
--
-- The trade cash leg pays the Currency_Conversion fee, as a cash-sale buyer does (0136).
--
-- A EUR (or GBP, CAD, ...) cash leg on the US platform is converted twice: when the
-- payer is charged, and when the receiver is paid from a locked FX quote. The platform
-- does not absorb that. The PAYER pays `currencyConversionFeeFor(amount, currency)` on
-- top of the agreed cash, and the receiver gets exactly the agreed amount.
--
-- `fx_fee_minor` records the fee charged at collection, so a later change to the rate
-- never re-prices a leg already paid. Like the cash-sale fee it is not refunded: the
-- conversion happened whether the trade completed or not.

alter table cardtrade.trade_cash_settlements
  add column if not exists fx_fee_minor bigint not null default 0
    check (fx_fee_minor >= 0);

comment on column cardtrade.trade_cash_settlements.fx_fee_minor is
  'Currency_Conversion fee charged to the payer on top of amount_minor, at collection. Not refunded.';
