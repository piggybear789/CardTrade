-- 0028_stripe_migration.sql
--
-- Schema cleanup for the move from Pinch Payments to Stripe.
--
-- Three of the objects below existed ONLY to work around Pinch constraints that
-- Stripe does not have, and one new column records a Stripe constraint that
-- Pinch did not have.
--
-- Names are schema-qualified because this migration is applied over the
-- Management API, where `cardtrade` is not on the search_path by default.

-- ---------------------------------------------------------------------------
-- 1. Authorisation expiry (NEW constraint under Stripe)
-- ---------------------------------------------------------------------------
--
-- Pinch had no authorize/capture/void primitives, so `placeHold` was a real
-- charge and a "hold" never expired — the money had already moved. Stripe places
-- a genuine authorisation, which the card network expires after about 7 days,
-- after which Stripe releases the funds on its own and both `voidHold` and
-- `partialCapture` start failing.
--
-- `expires_at` records the provider's `capture_before` so the UI can surface the
-- deadline and a future job can re-authorise before it lapses.

alter table cardtrade.pre_auth_holds
  add column if not exists expires_at timestamptz;

comment on column cardtrade.pre_auth_holds.expires_at is
  'When the provider authorisation lapses (Stripe capture_before). Null for '
  'providers whose holds do not expire, e.g. the deterministic MockService. '
  'After this instant the provider releases the funds itself and the hold '
  'cannot be voided or captured.';

-- Correct the provider-agnostic meaning of hold_ref; 0001 described it as a
-- "Pinch/Mock hold id" and is already applied, so it is annotated rather than
-- edited. Under Stripe this is the PaymentIntent id (`pi_...`).
comment on column cardtrade.pre_auth_holds.hold_ref is
  'Provider hold reference. Stripe: the PaymentIntent id (pi_...).';

-- ---------------------------------------------------------------------------
-- 2. Per-merchant payer mapping (Pinch-only workaround)
-- ---------------------------------------------------------------------------
--
-- A Pinch Payer belonged to the merchant it was created under, so a Buyer paying
-- a Seller's sub-merchant needed a SEPARATE payer record on that sub-merchant,
-- and `payer_refs` mapped (profile, merchant) -> payer_id.
--
-- A Stripe Customer belongs to the platform and can pay any connected account, so
-- one Customer per Profile (`profiles.payer_id`) is sufficient and this mapping
-- has no equivalent. No application code reads it, and it holds no rows.

drop table if exists cardtrade.payer_refs;

-- ---------------------------------------------------------------------------
-- 3. Reusable tokenisation credential (Pinch-only workaround)
-- ---------------------------------------------------------------------------
--
-- `payment_token` stored a reusable Pinch CaptureJS token so a payer could be
-- created on a NEW sub-merchant with an inline source, without re-tokenising when
-- a Seller onboarded after the Buyer's card was captured. It depended on
-- multi-use token reuse being enabled on the parent merchant, and it meant
-- holding a chargeable credential in our own database.
--
-- Stripe PaymentMethods are durable and attached to the platform Customer, so the
-- vaulted `payment_source_id` (pm_...) is the only reference needed and no
-- credential is stored.
--
-- The stored tokens are Pinch-issued and unusable with Stripe, so dropping the
-- column retires dead credentials rather than losing anything of value.

alter table cardtrade.profiles
  drop column if exists payment_token;

comment on column cardtrade.profiles.payment_source_id is
  'Provider-vaulted payment instrument reference. Stripe: PaymentMethod id '
  '(pm_...). Not a credential: it cannot be used to charge without our secret key.';

comment on column cardtrade.profiles.payer_id is
  'Provider payer reference. Stripe: Customer id (cus_...), platform-scoped, '
  'usable to pay any connected account.';

-- ---------------------------------------------------------------------------
-- 4. Seller identity disclosure
-- ---------------------------------------------------------------------------
--
-- Government registration numbers (ABN/ACN) were a Pinch compliance requirement:
-- it modelled the payee as a registered business entity. Sellers are now
-- individuals, and Stripe does not return tax IDs through the API at all, so the
-- disclosure is the provider-VERIFIED legal name instead.
--
-- The columns are deliberately KEPT rather than dropped:
--   * `cash_sales.seller_registration_number` is part of an immutable per-sale
--     snapshot, and historical sales must keep what was actually disclosed;
--   * it is also a parameter of the `0008_cash_sale_contract.sql` RPC.
-- New rows simply leave them null.

comment on column cardtrade.profiles.merchant_registration_number is
  'DEPRECATED. Government business registration (ABN/ACN) collected by the '
  'former Pinch integration. Null for all Stripe-onboarded sellers: Stripe does '
  'not return tax IDs. Retained for historical rows only — do not read it for '
  'new disclosures, use merchant_legal_entity_name.';

comment on column cardtrade.profiles.merchant_legal_entity_name is
  'The payee''s provider-VERIFIED legal name, checked against a government '
  'document. The buyer-safe disclosure (Req 4.8-4.12). Written only from the '
  'provider''s own report, never from seller-supplied input.';

-- ---------------------------------------------------------------------------
-- 5. Correct stale provider names in live column comments
-- ---------------------------------------------------------------------------
--
-- Earlier migrations are applied and must not be edited, but several of their
-- `comment on column` strings still name the old provider and are visible in the
-- database. Restated here so the schema documents itself accurately.

comment on column cardtrade.profiles.merchant_ref is
  'Connected account id (Stripe: acct_...). Null until payout onboarding starts.';

comment on column cardtrade.cash_sales.status is
  'Cash-sale lifecycle. ESCROW_HELD means internal payment protection held by '
  'the platform, not regulated escrow.';

-- NOTE: the applied table is `deal_payments`. Migration 0027 refers to it as
-- `deal_cash_payments` in prose, which is not the name that was created.
comment on column cardtrade.deal_payments.payment_ref is
  'Provider payment id returned by placeHold when cash was charged on lock. '
  'Stripe: a PaymentIntent id (pi_...).';

comment on column cardtrade.deal_payments.transfer_ref is
  'Provider transfer id when cash was routed to the recipient connected account. '
  'Stripe: a Transfer id (tr_...).';

comment on column cardtrade.deal_payments.status is
  'Cash escrow status for private deals. Separate from deal_holds (collateral). '
  'HELD on confirm; SETTLED on both-complete; kept locked on dispute.';
