-- CardTrade — 0006_seller_identity_disclosure.sql
-- Buyer-safe, provider-controlled seller identity plus immutable sale evidence.
-- Sensitive compliance data remains on the server; only these approved fields
-- may be shown to a prospective buyer (Req 4.8-4.12).

alter table profiles
  add column merchant_legal_entity_name text,
  add column merchant_trading_name text,
  add column merchant_registration_number text,
  add column merchant_organisation_type text,
  add column merchant_identity_version text,
  add column merchant_identity_disclosure_consented_at timestamptz,
  add column merchant_identity_verified_at timestamptz;

alter table cash_sales
  add column seller_identity_version text,
  add column seller_legal_entity_name text,
  add column seller_trading_name text,
  add column seller_registration_number text,
  add column seller_organisation_type text,
  add column seller_identity_verified_at timestamptz,
  add column buyer_seller_identity_confirmed_at timestamptz;

-- A negotiated purchase carries the buyer's acknowledgement from the offer into
-- the eventual Cash_Sale. The current identity version is rechecked at payment.
alter table offers
  add column seller_identity_version text,
  add column buyer_seller_identity_confirmed_at timestamptz;

create index profiles_merchant_identity_version_idx
  on profiles (merchant_identity_version)
  where merchant_identity_version is not null;

comment on column profiles.merchant_identity_version is
  'Opaque version of the buyer-safe seller identity; changes invalidate stale confirmations.';
comment on column cash_sales.buyer_seller_identity_confirmed_at is
  'Server timestamp proving the buyer acknowledged the snapshotted verified seller identity.';
comment on column cash_sales.seller_registration_number is
  'Buyer-safe ABN/ACN or equivalent copied at purchase time; never bank or identity-document data.';

-- The new merchant_* columns are provider-controlled. 0005 already narrowed
-- profiles UPDATE to (display_name, contact_email); re-assert it so a User can
-- never self-attest a legal identity, registration number, or verification date.
revoke update on profiles from authenticated;
revoke update on profiles from anon;
grant update (display_name, contact_email) on profiles to authenticated;