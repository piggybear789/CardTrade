-- 0067_backfill_pre_regional_profiles.sql
--
-- Give every Profile that predates 0065 a trading region.
--
-- WHY THIS IS NEEDED AND NOT OPTIONAL. `checkRegionCompatibility` refuses an
-- UNKNOWN region deliberately — "we do not know where either party is" is not a
-- basis for taking someone's money, so a null region is not permissive. The
-- consequence is that after 0065 every existing member is unable to open a
-- Cash_Sale or a trade negotiation at all, because both sides evaluate to
-- UNKNOWN_REGION. 0065 could not do this itself: a schema migration that also
-- invents a jurisdiction for existing rows records a guess as a fact, so the
-- backfill is separated out and justified per group below.
--
-- WHY AU IS A FACT AND NOT A GUESS, for the group that matters.
-- A Profile with a `merchant_ref` has a Stripe Connect account, and until 0065
-- `createManagedMerchant` passed a HARDCODED `identity: { country: 'au' }`. Every
-- connected account that exists is therefore registered in Australia, and Stripe
-- fixes an account's country at creation — it cannot be changed. So for these rows
-- AU is not an assumption about where the member lives, it is a readback of the
-- only country their payouts can ever settle in. Recording anything else would put
-- `profiles.region_code` in disagreement with the provider, which is precisely the
-- state `setTradingRegion` refuses to create.
--
-- WHY AU FOR THE REST, stated as the weaker claim it is.
-- A Profile with no connected account has no provider fact to read back. AU is
-- applied because it is the only `tradingEnabled` region (see
-- `domain/region/regions.ts`), so it is the only value that lets them transact at
-- all, and because they completed onboarding before the region step existed and
-- will never otherwise be asked. If they are in fact elsewhere, the outcome is that
-- they can transact in AU rather than not at all, and support can move them —
-- `setTradingRegion` only locks a region once a `merchant_ref` exists.
--
-- IDEMPOTENT AND NON-DESTRUCTIVE. `where region_code is null` only, so a member who
-- has already chosen through onboarding is never overwritten, and re-running this
-- does nothing.

update cardtrade.profiles
   set region_code = 'AU',
       updated_at = now()
 where region_code is null;

-- Listings keep their null `location_country_code`.
--
-- Deliberate, and NOT the same decision. A listing's country is the country of the
-- goods, derivable only from its stored pin — and reverse-geocoding a lat/lng inside
-- a migration would be both a guess and a network call. `searchCatalog` and
-- `getCatalogFacets` therefore treat a null listing country as unscoped and always
-- visible, which is why the marketplace does not go dark for anyone on the day 0065
-- ships. Those listings acquire a country the next time they are edited, and the
-- `.or(...)` predicate can tighten to a bare `.eq()` once none are left.
