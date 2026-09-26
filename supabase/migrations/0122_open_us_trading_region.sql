-- 0122_open_us_trading_region.sql
--
-- Opens the United States as a trading region.
--
-- WHY A MIGRATION AND NOT JUST THE TYPESCRIPT FLAG. `cardtrade.regions.trading_enabled`
-- is not a mirror kept for tidiness — two triggers read it and refuse writes on it, so
-- the TypeScript flag alone would leave the database contradicting the app:
--
--   * `cardtrade.enforce_trading_region_rules` (0070) refuses a `profiles.region_code`
--     update to a region whose flag is false. Without this migration a US member could
--     be offered the region by the UI and then blocked by the database when they picked
--     it — the 0060 shape of mistake, arriving one layer lower than usual.
--   * `cardtrade.enforce_region_waitlist_rules` (0118) refuses a waitlist row for a
--     region whose flag is true, which is the behaviour we now want for US.
--
-- The entity behind this is "NoDitto Company", Stripe platform `acct_1UIfsRRbOJEOZeCm`,
-- country US, presentment USD. Its two webhook endpoints are registered and Connect is
-- enabled on it.
--
-- THIS MIGRATION DOES NOT MAKE US LIVE, AND THAT SEPARATION IS DELIBERATE. `trading_enabled`
-- is product intent on both sides of the seam. The runtime answer is `operationalRegions()`,
-- which intersects intent with `allConfiguredRegionCodes()` — a scan for `STRIPE_SECRET_KEY_US`.
-- Until that variable is set, US is absent from the onboarding region step and refused by
-- every contract guard regardless of what this table says. Setting the key is the switch.
--
-- Pinned by `tests/unit/regionCurrencyAgreement.test.ts`, which reads the flag from the
-- 0068 seed and then applies the per-region changes made by later migrations, this one
-- included. It parses the exact statement shape below, so keep the single-line form.

-- ---------------------------------------------------------------------------
-- 1. The flag
-- ---------------------------------------------------------------------------

update cardtrade.regions set trading_enabled = true where code = 'US';

-- ---------------------------------------------------------------------------
-- 2. Waitlist rows for a region that is now open
-- ---------------------------------------------------------------------------

-- 0118 records that a waitlist row for an open region is "state that means nothing —
-- the member should have chosen it as their trading region", and that a meaningless row
-- is what gets misread as demand later. Its trigger enforces that on INSERT only, so
-- rows written while US was closed would survive and inflate the operator's "who is
-- waiting for US" read of a region that is no longer waiting for anything.
--
-- Zero rows in production at the time of writing, so this is a no-op there; it is here
-- so a branch, a seeded environment or a restored backup cannot carry the contradiction
-- forward. Deleting rather than retaining is the same call 0118 made: the product has no
-- "your region opened" flow for these rows to feed, so there is nothing to keep them for.

delete from cardtrade.region_waitlist where region_code = 'US';
