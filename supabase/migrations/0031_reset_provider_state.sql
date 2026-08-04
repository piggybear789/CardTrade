-- 0031_reset_provider_state.sql
--
-- One-off data reset after the move from Pinch Payments to Stripe.
--
-- Recorded as a migration so the change is reviewable and reproducible on any
-- other environment, even though it is data rather than schema. Safe to re-run:
-- every statement is idempotent.
--
-- THE PROBLEM THIS FIXES. Every provider reference in the database pointed at
-- the old provider and was silently wrong under Stripe:
--
--   * 35 profiles were `merchant_status = APPROVED` with
--     `merchant_settlements_enabled = true`, against Pinch `mch_...` refs that do
--     not exist in Stripe. `canReceiveFunds()` therefore returned TRUE for
--     sellers with no connected account at all, so a Cash_Sale could be
--     initiated and could never settle.
--   * 39 profiles carried Pinch/mock payer ids in `payer_id`, which Stripe would
--     reject as Customer references.
--   * 33 profiles were `kyc_status = VERIFIED` on the strength of a simulated
--     check, which real identity verification has not performed.
--
-- Transactional history is also cleared, because it referenced holds, payments
-- and transfers at a provider that is no longer wired up.
--
-- KEPT DELIBERATELY: `profiles` (they are bound to `auth.users`; deleting them
-- would break sign-in) and `items` (the demo catalogue).

begin;

-- Transactional + social history, deleted child-first to respect NO ACTION FKs.
delete from cardtrade.webhook_logs;
delete from cardtrade.trade_proposal_items;
delete from cardtrade.trade_proposals;
delete from cardtrade.cash_sale_events;
delete from cardtrade.cash_sales;
delete from cardtrade.offers;
delete from cardtrade.deal_payments;
delete from cardtrade.deal_holds;
delete from cardtrade.deal_events;
delete from cardtrade.deals;
delete from cardtrade.pre_auth_holds;
delete from cardtrade.trade_items;
delete from cardtrade.trade_state_transitions;
delete from cardtrade.trades;
delete from cardtrade.messages;
delete from cardtrade.conversations;
delete from cardtrade.notifications;
delete from cardtrade.reports;
delete from cardtrade.reviews;
delete from cardtrade.watchlist;

-- Nothing is reserved or sold any more.
update cardtrade.items set status = 'AVAILABLE' where status <> 'AVAILABLE';

-- Retire every dead provider reference and reset both gates to their defaults.
-- `rating`/`rating_count` are cached aggregates over the deleted reviews.
update cardtrade.profiles set
  payer_id                                  = null,
  payment_source_id                         = null,
  payment_method_label                      = null,
  payment_token_type                        = null,
  identity_session_id                       = null,
  kyc_status                                = 'UNVERIFIED',
  kyc_reason                                = null,
  merchant_ref                              = null,
  merchant_status                           = 'NONE',
  merchant_compliance_status                = null,
  merchant_live_enabled                     = false,
  merchant_transactions_enabled             = false,
  merchant_settlements_enabled              = false,
  merchant_submitted_at                     = null,
  merchant_decision_at                      = null,
  merchant_notes                            = null,
  merchant_legal_entity_name                = null,
  merchant_trading_name                     = null,
  merchant_registration_number              = null,
  merchant_organisation_type                = null,
  merchant_identity_version                 = null,
  merchant_identity_disclosure_consented_at = null,
  merchant_identity_verified_at             = null,
  rating                                    = null,
  rating_count                              = 0;

commit;
