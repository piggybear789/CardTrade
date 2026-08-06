-- 0065_regional_marketplace.sql
--
-- Regional marketplace: one deployment, listings scoped to a jurisdiction, deals
-- completed inside one. Adds the two columns that fact needs.
--
-- WHY THE ITEM COLUMN DID NOT ALREADY EXIST. 0022 gave every listing a required
-- pin (`location_label`, `location_place_id`, `location_lat`, `location_lng`,
-- `location_precision`) but no country. The Places integration HAS resolved the
-- country all along — `lib/location/googleMaps.ts` reads it into
-- `PlaceValue.countryCode`, and `lib/location/types.ts` documents it as being
-- carried "so the catalog can scope by country without re-geocoding a stored
-- label" — but `normalizeItemLocation` dropped it on the way to the database. The
-- value was fetched and discarded. Reverse-geocoding stored labels later would be
-- both slower and lossy, so the column is added and the discard removed together.
--
-- TWO REGION FACTS, DELIBERATELY SEPARATE.
--
--   * `items.location_country_code` — where the GOODS are. Drives the browse
--     filter. Derived from the seller's chosen place, so it moves per listing.
--   * `profiles.region_code` — where the MEMBER trades. Drives the contract
--     guards and must agree with their Stripe Connect account country.
--
-- They are not redundant. A member can post a listing while travelling, and the
-- listing's country is a property of the parcel's origin, not of who owns it.
-- Collapsing them into one column would mean a member's trading jurisdiction
-- silently changing because they picked a suburb across a border.
--
-- Neither column is NOT NULL. Every existing row predates the concept, and
-- backfilling a jurisdiction from a lat/lng inside a migration would be a guess
-- recorded as a fact. Nulls are handled explicitly: `searchCatalog` treats a null
-- listing country as "unscoped, always visible", and `checkRegionCompatibility`
-- refuses a contract when either side's region is unknown.

-- ---------------------------------------------------------------------------
-- Items — the jurisdiction the listing is in
-- ---------------------------------------------------------------------------
alter table cardtrade.items
  add column if not exists location_country_code text;

alter table cardtrade.items
  drop constraint if exists items_location_country_code_check;

-- Matches the shape already enforced on `cash_sale_delivery_details.country_code`
-- and `trade_delivery_details.country_code` (0050, 0057), so all three agree on
-- what a country code looks like.
alter table cardtrade.items
  add constraint items_location_country_code_check
  check (
    location_country_code is null
    or location_country_code ~ '^[A-Z]{2}$'
  );

comment on column cardtrade.items.location_country_code is
  'ISO 3166-1 alpha-2 of the listing pin, uppercase. Null for listings created '
  'before 0065 and for the free-text place fallback, which resolves no country. '
  'Scopes the catalog; NOT the seller''s trading region (see profiles.region_code).';

-- The catalog filters on country alongside status/hidden/closed_at on every
-- browse request, so the predicate needs an index. Partial: a listing that is
-- hidden or has no country is never returned by a region-scoped query.
create index if not exists items_region_catalog_idx
  on cardtrade.items (location_country_code, status, created_at desc)
  where hidden = false and location_country_code is not null;

-- ---------------------------------------------------------------------------
-- Profiles — the jurisdiction the member trades in
-- ---------------------------------------------------------------------------
alter table cardtrade.profiles
  add column if not exists region_code text;

alter table cardtrade.profiles
  drop constraint if exists profiles_region_code_check;

alter table cardtrade.profiles
  add constraint profiles_region_code_check
  check (
    region_code is null
    or region_code ~ '^[A-Z]{2}$'
  );

comment on column cardtrade.profiles.region_code is
  'ISO 3166-1 alpha-2 jurisdiction the member transacts in. Set at onboarding and '
  'must agree with their Stripe Connect account country, because a transfer to an '
  'account registered elsewhere fails. Read by the contract guards via '
  'checkRegionCompatibility. NEVER set from an IP address: a VPN or a holiday '
  'would hand a member a region they cannot settle in, discovered only at payout.';

-- ---------------------------------------------------------------------------
-- public_profiles — expose the region, and nothing else new
-- ---------------------------------------------------------------------------
--
-- The contract guards run service-role and read `profiles` directly, so they do
-- not need this. It is here because the BUY surfaces need to tell a member why a
-- listing cannot be bought BEFORE they commit to it, and those run on the
-- cookie-bound client where `profiles` is owner-only by RLS. Without it the
-- refusal could only arrive after the attempt.
--
-- A region is not sensitive: it is already implied by every listing the member has
-- published.
--
-- Dropped and recreated because a view is `select`-defined and there is no
-- add-column-to-view. Carried over from 0061 UNCHANGED: the `is_verified`
-- expression stays in its exact plain form (the denormalisation-agreement property
-- in tests/property/identityGate.test.ts reads it back out of the newest migration
-- that defines it and evaluates it against `satisfiesIdentityGate` — it fails
-- loudly on an expression it cannot interpret); `identity_first_name` stays a
-- gate-conditioned `split_part` of the provider-reported legal name; and this is
-- still NOT a security_invoker view, so it must remain SELECT-only or writes
-- through it would bypass the owner-only RLS on `profiles` (the 0032 fix).
--
-- `region_code` is appended rather than inserted mid-list so column ORDER is
-- unchanged for anything selecting positionally.
drop view if exists cardtrade.public_profiles;

create view cardtrade.public_profiles as
select
  id,
  display_name,
  rating,
  rating_count,
  -- The Identity_Gate. Approval alone is not enough: transfers must actually be
  -- enabled, because that is the only signal that Stripe finished with this member.
  (merchant_status = 'APPROVED'::cardtrade.merchant_status
   and merchant_settlements_enabled) as is_verified,
  -- Provider-reported GIVEN name only, and only once the gate is satisfied. The full
  -- legal name is a commitment-point disclosure and never belongs in a public view.
  case
    when merchant_status = 'APPROVED'::cardtrade.merchant_status
         and merchant_settlements_enabled
         and merchant_legal_entity_name is not null
      then split_part(btrim(merchant_legal_entity_name), ' ', 1)
    else null
  end as identity_first_name,
  -- New in 0065. Lets a buy surface explain that a listing is out of region BEFORE
  -- the member commits, on the cookie-bound client where `profiles` is owner-only.
  region_code
from cardtrade.profiles;

-- Read-only for both roles. No write grants, per the 0032 security fix.
grant select on cardtrade.public_profiles to anon, authenticated;

comment on view cardtrade.public_profiles is
  'Catalog-safe public projection of a Profile. `is_verified` is the single '
  'Identity_Gate: Connect onboarding APPROVED with settlements enabled, i.e. the '
  'provider-hosted flow actually completed. 0060 briefly reduced this to APPROVED '
  'alone, which made a freshly created empty account shell read as verified; 0061 '
  'restored the second conjunct. It still does not assert a government-document or '
  'selfie check, which Connect can defer. `region_code` (0065) is the member''s '
  'trading jurisdiction. Never add legal name, date of birth, document numbers, '
  'address or contact details.';
