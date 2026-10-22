-- 0159_cash_sale_card_pricing_tiers.sql
--
-- A card payment is priced by where the card was issued (domain/fees/processingFee.ts).
-- Stripe charges the settlement merchant's domestic rate for a card from its own card
-- zone, a middle rate across the UK-EEA line, and its international rate for anything
-- else, so the Service_Fee carries the same three tiers. The claim that starts payment
-- stores which one priced it, in the column 0158 added for the rail:
--
--   CARD                a card issued inside the contract's domestic card zone (and
--                       NULL, as before, for a card claim that re-priced nothing)
--   CARD_UK_EEA         a UK card paying an EEA seller, or an EEA card paying a UK seller
--   CARD_INTERNATIONAL  a card issued anywhere else
--
-- The two tiers are not choices: the buyer picks card, and `acceptCashSaleTerms` reads
-- the saved card's issuing country from Stripe and prices the claim for it. Storing the
-- tier keeps `amount_cents - platform_fee_cents` (the seller's net) describing what was
-- actually charged, and lets a later card attempt on a different card re-price instead
-- of reusing a fee priced for the wrong one.
--
-- No trigger change, for the reasons 0158 gives. No grant change: members already read
-- this column through its 0158 column grant.

alter table cardtrade.cash_sales
  drop constraint if exists cash_sales_payment_method_kind_check;

alter table cardtrade.cash_sales
  add constraint cash_sales_payment_method_kind_check
    check (payment_method_kind in (
      'CARD', 'CARD_UK_EEA', 'CARD_INTERNATIONAL',
      'US_BANK', 'IDEAL', 'BANCONTACT', 'EPS', 'P24', 'PAYTO'
    ));

comment on column cardtrade.cash_sales.payment_method_kind is
  'How the buyer chose to pay at the last payment claim, and for card which tier priced it (0159): the rail or tier platform_fee_cents and amount_cents are priced for. NULL is a domestic card. Written only by the service role (claimPayment).';

notify pgrst, 'reload schema';
