-- 0136_us_platform_cross_border_regions.sql
--
-- Opens the UK, the EEA (except Hungary), Canada and Switzerland as trading regions,
-- all served by the US Stripe platform (`acct_1UIfsRRbOJEOZeCm`), and records what a
-- currency conversion cost on each cash sale.
--
-- WHY ONE PLATFORM CAN SERVE THEM. Stripe lets a platform in the US, UK, EEA, CA or CH
-- transfer to connected accounts in any of those. Verified in test mode on 2026-10-13:
-- a DE seller on the US platform onboarded (with a merchant card_payments configuration,
-- which cross-border recipients require) and received a USD transfer as EUR. Members
-- across those regions may trade with each other; Australia keeps its own platform and
-- trades only with itself (`checkRegionCompatibility`).
--
-- HUNGARY STAYS CLOSED. Stripe treats HUF as two-decimal for charges but requires payout
-- amounts divisible by 100, which the integer money model does not enforce yet.
--
-- WHY A MIGRATION AND NOT JUST THE TYPESCRIPT FLAG: see 0122. Two triggers read
-- `trading_enabled` — 0070 refuses a profile region whose flag is false, 0118 refuses a
-- waitlist row for a region whose flag is true — so the database must agree with the
-- registry or members are offered a region and then blocked from picking it.
--
-- THIS DOES NOT MAKE THEM LIVE BY ITSELF. `operationalRegions()` also requires the
-- region's PLATFORM key, `STRIPE_SECRET_KEY_US`, which opens the whole group at once.
--
-- Pinned by `tests/unit/regionCurrencyAgreement.test.ts`, which parses the exact
-- single-line UPDATE shape below. Keep one statement per line.

-- ---------------------------------------------------------------------------
-- 1. The flags
-- ---------------------------------------------------------------------------

update cardtrade.regions set trading_enabled = true where code = 'AT';
update cardtrade.regions set trading_enabled = true where code = 'BE';
update cardtrade.regions set trading_enabled = true where code = 'BG';
update cardtrade.regions set trading_enabled = true where code = 'CA';
update cardtrade.regions set trading_enabled = true where code = 'CH';
update cardtrade.regions set trading_enabled = true where code = 'CY';
update cardtrade.regions set trading_enabled = true where code = 'CZ';
update cardtrade.regions set trading_enabled = true where code = 'DE';
update cardtrade.regions set trading_enabled = true where code = 'DK';
update cardtrade.regions set trading_enabled = true where code = 'EE';
update cardtrade.regions set trading_enabled = true where code = 'ES';
update cardtrade.regions set trading_enabled = true where code = 'FI';
update cardtrade.regions set trading_enabled = true where code = 'FR';
update cardtrade.regions set trading_enabled = true where code = 'GB';
update cardtrade.regions set trading_enabled = true where code = 'GR';
update cardtrade.regions set trading_enabled = true where code = 'HR';
update cardtrade.regions set trading_enabled = true where code = 'IE';
update cardtrade.regions set trading_enabled = true where code = 'IT';
update cardtrade.regions set trading_enabled = true where code = 'LI';
update cardtrade.regions set trading_enabled = true where code = 'LT';
update cardtrade.regions set trading_enabled = true where code = 'LU';
update cardtrade.regions set trading_enabled = true where code = 'LV';
update cardtrade.regions set trading_enabled = true where code = 'MT';
update cardtrade.regions set trading_enabled = true where code = 'NL';
update cardtrade.regions set trading_enabled = true where code = 'NO';
update cardtrade.regions set trading_enabled = true where code = 'PL';
update cardtrade.regions set trading_enabled = true where code = 'PT';
update cardtrade.regions set trading_enabled = true where code = 'RO';
update cardtrade.regions set trading_enabled = true where code = 'SE';
update cardtrade.regions set trading_enabled = true where code = 'SI';
update cardtrade.regions set trading_enabled = true where code = 'SK';

-- ---------------------------------------------------------------------------
-- 2. Waitlist rows for regions that are now open (same reasoning as 0122)
-- ---------------------------------------------------------------------------

delete from cardtrade.region_waitlist
 where region_code in (
   'AT','BE','BG','CA','CH','CY','CZ','DE','DK','EE','ES','FI','FR','GB','GR','HR',
   'IE','IT','LI','LT','LU','LV','MT','NL','NO','PL','PT','RO','SE','SI','SK'
 );

-- ---------------------------------------------------------------------------
-- 3. Currency conversion on a cash sale
-- ---------------------------------------------------------------------------
--
-- `fx_fee_cents`: the Currency_Conversion fee the BUYER paid on top of `amount_cents`
-- when the contract's currency is not its platform's settlement currency (a EUR sale on
-- the US platform). The buyer absorbs the conversion so the seller is paid exactly the
-- agreed amount (`domain/fees/fxFee.ts`). Deliberately NOT folded into `amount_cents`:
-- that column's CHECK and five RPCs define it as price + fee + shipping, and the
-- conversion fee is a provider cost passed through, not part of the deal.
--
-- `settlement_amount_cents` / `settlement_currency`: what the platform balance actually
-- received for the charge, from Stripe's balance transaction. Custody reconciliation
-- needs it, because a EUR obligation cannot be compared with a USD balance.

alter table cardtrade.cash_sales
  add column if not exists fx_fee_cents integer not null default 0,
  add column if not exists settlement_amount_cents integer,
  add column if not exists settlement_currency text;

alter table cardtrade.cash_sales
  drop constraint if exists cash_sales_fx_fee_nonnegative,
  add constraint cash_sales_fx_fee_nonnegative check (fx_fee_cents >= 0),
  drop constraint if exists cash_sales_settlement_amount_nonnegative,
  add constraint cash_sales_settlement_amount_nonnegative
    check (settlement_amount_cents is null or settlement_amount_cents >= 0);

comment on column cardtrade.cash_sales.fx_fee_cents is
  'Currency_Conversion fee the buyer paid on top of amount_cents (0136). Not refunded.';
comment on column cardtrade.cash_sales.settlement_amount_cents is
  'What the platform balance received for the buyer charge, in settlement_currency (0136).';

-- The conversion fee is part of what the buyer was charged, so both parties may see it.
--
-- NOTE ON THE SETTLEMENT COLUMNS. `authenticated` holds TABLE-level SELECT on
-- cash_sales (0008), which a column grant cannot narrow, so a party to the sale can read
-- `settlement_amount_cents` / `settlement_currency` through RLS too. They are the USD
-- figure the buyer's own payment converted to, not anyone else's data, so this is
-- accepted rather than restructuring the table's grants. `CASH_SALE_PUBLIC_SELECT` does
-- not select them, so no member surface shows them.
grant select (fx_fee_cents) on cardtrade.cash_sales to authenticated;
