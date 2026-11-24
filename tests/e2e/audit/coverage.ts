// tests/e2e/audit/coverage.ts
//
// THE COVERAGE_MAP (e2e-ux-audit-suite, design "Coverage_Map"): every function
// `.kiro/steering/product.md` describes, and what tests it.
//
// `productSection` must equal the product.md heading VERBATIM, because
// `checkCoverageMap` matches it against `extractProductFunctions(product.md)`. A
// renamed heading in product.md fails the `preflight` project (and the unit guard
// over this file) with `uncovered-function` until the entry here is renamed too.
//
// Task 7.17 created every entry as `not-automated` with the reason `PENDING_MIGRATION`.
// As tasks 9 to 15 migrate each area onto the Pathway DSL, its entry becomes
// `automated` with the happy and refusal Pathway ids, and probes it retires go in
// `supersededProbes` (Req 3.3). Task 9.5 wired cash sales, trades and the two
// transaction models; a part of one of those that the suite cannot reach is its own
// `not-automated` entry under the same product section, with the reason. Two entries
// are not pending: Google OAuth is out of scope by the owner's decision (Req 5.6), and
// the SES emails are a manual check, because the suite cannot read a real inbox
// (Req 5.5).
//
// Requirements: 5.1, 5.2, 5.4, 5.5, 5.6

import type { CoverageEntry } from './core/coverageMap';

/** The reason every not-yet-migrated function carries. */
export const PENDING_MIGRATION = 'pending migration (tasks 9 to 15)';

/** A product function whose Pathways have not been written yet. */
function pending(
  id: string,
  area: CoverageEntry['area'],
  fn: string,
  productSection: string,
): CoverageEntry {
  return { id, area, function: fn, productSection, kind: 'not-automated', reason: PENDING_MIGRATION };
}

export const COVERAGE_MAP: readonly CoverageEntry[] = [
  // ## Features and functionality
  pending('auth.email-password', 'auth', 'Sign up, sign in, password reset and email confirmation', 'Auth'),
  {
    id: 'auth.google-oauth',
    area: 'auth',
    function: 'Sign in with Google',
    productSection: 'Auth',
    kind: 'out-of-scope',
    reason: 'Excluded by the owner.',
  },
  pending('onboarding.wizard', 'onboarding', 'Onboarding wizard', 'Onboarding'),
  pending('profile-payouts.identity-payouts', 'profile-payouts', 'Identity check and payout setup', 'Identity and payouts'),
  pending('catalog.browse-listings', 'catalog', 'Catalog, listings and the watchlist', 'Catalog and listings'),
  pending('offers.negotiate', 'offers', 'Offers on a single listing', 'Offers'),
  {
    id: 'cash-sale.lifecycle',
    area: 'cash-sale',
    function: 'Cash sales: reserve, terms, delivery or in-person handover, inspection, payout, cancel',
    productSection: 'Cash sales',
    kind: 'automated',
    happy: [
      'cash-sale.buy-now.reserves-single',
      'cash-sale.multiple-items.line-items',
      'cash-sale.terms.fulfilment-only-change',
      'cash-sale.delivery.lifecycle',
      'cash-sale.inspection.auto-complete',
      'cash-sale.in-person.handover-24h',
      'cash-sale.cancel.in-agreement',
      'journeys.cash-sale-lifecycle',
    ],
    refusal: [
      'cash-sale.buy-now.no-card',
      'cash-sale.delivery.flagged-delivered-before-shipment',
      'cash-sale.in-person.handover-too-early',
      'cash-sale.cancel.refused-after-payment',
      'cash-sale.payment.unfinished-abandoned',
    ],
  },
  {
    id: 'cash-sale.payments',
    area: 'cash-sale',
    function: 'Paying for a cash sale by card or bank, and the fraud controls on the buy path',
    productSection: 'Cash sales',
    kind: 'automated',
    happy: [
      'cash-sale.payments.card-no-auth',
      'cash-sale.payments.card-3ds',
      'cash-sale.payments.bank-payto',
      'cash-sale.payments.bank-ideal',
      'cash-sale.payments.bank-bancontact',
      'cash-sale.payments.bank-eps',
      'cash-sale.payments.bank-p24',
    ],
    refusal: [
      'cash-sale.payments.card-3ds-failed',
      'cash-sale.payments.card-declined',
      'cash-sale.payments.card-repriced',
      'cash-sale.payments.buyer-identity-required',
      'cash-sale.payments.seller-not-payable',
      'cash-sale.payments.seller-exposure-limit',
      'cash-sale.payments.related-accounts',
      'cash-sale.payments.region-mismatch',
    ],
    // The probe read the region warning and the identity prompt on a listing page;
    // `region-mismatch` and `buyer-identity-required` assert both.
    supersededProbes: ['guards-probe'],
  },
  {
    id: 'cash-sale.tracking-registration',
    area: 'cash-sale',
    function: 'Tracking refused when it predates payment, or flagged when already delivered on entry',
    productSection: 'Cash sales',
    kind: 'not-automated',
    reason:
      'TRACKING_PREDATES_PAYMENT and the "already delivered when entered" flag (DELIVERED_AT_REGISTRATION) ' +
      "are decided inside recordCashSaleShipment from the server's own live Ship24 registration " +
      '(Ship24TrackingService.registerShipment), which no webhook fixture reaches. Automating them needs a ' +
      'sandbox tracking binding. The webhook-decided "delivered before it shipped" flag is automated in ' +
      'cash-sale.delivery.flagged-delivered-before-shipment.',
  },
  {
    id: 'trades.lifecycle',
    area: 'trades',
    function: 'Trades: negotiate, agree, cash leg, collateral, meeting changes, handover, inspection, completion',
    productSection: 'Trades',
    kind: 'automated',
    happy: [
      'trades.negotiate.counter-voids-acceptances',
      'trades.negotiate.meeting-edit-clears-other',
      'trades.agree.side-values-frozen',
      'trades.lifecycle.cash-leg-accepted',
      'trades.cash-leg.fx-disclosure',
      'trades.collateral.locks-live-and-job-completes',
      'trades.meeting.change-proposal-accepted',
      'trades.shopfront.side-valued-at-offer',
      'journeys.trade-lifecycle',
    ],
    refusal: [
      'trades.agree.refused-no-card',
      'trades.agree.refused-unverified',
      'trades.agree.refused-short-reservation',
      'trades.cash-leg.unpaid-pay-by-abandons',
      'trades.collateral.declined-hold-voids-other',
      'trades.meeting.change-refused-after-cutoff',
      'trades.shopfront.refused-as-offering-side',
      'trades.abandon.meeting-passed-unlocked',
      'trades.open.refused-region-mismatch',
    ],
    supersededProbes: ['trade', 'trade-collateral', 'trade-views', 'terms-panel', 'hold-probe'],
  },
  {
    id: 'trades.declared-value-edit',
    area: 'trades',
    function: 'Editing a trade side\'s declared value voids both acceptances',
    productSection: 'Trades',
    kind: 'not-automated',
    reason:
      'The website has no control for editing a declared value during negotiation, so no member can reach ' +
      'it. Voiding acceptances on a terms change is automated through the cash and goods changes in ' +
      'trades.negotiate.counter-voids-acceptances.',
  },
  pending('private-deals.invites', 'private-deals', 'Private deal invites', 'Private deals'),
  pending('messaging.conversations', 'messaging', 'Messages', 'Messaging'),
  pending('notifications.in-app', 'notifications', 'In-app notifications', 'Notifications and email'),
  {
    id: 'notifications.email',
    area: 'notifications',
    function: 'Notification emails sent through AWS SES',
    productSection: 'Notifications and email',
    kind: 'manual',
    reason: 'The suite cannot read a real inbox, and SES delivery is not observable from the browser.',
    manualCheck:
      'Open the sandbox inbox and check the message arrived and links to the contract: inspection deadline ' +
      'warning, return deadline warning, dispute raised, payout settled, new purchase request, trade offer ' +
      'received and item shipped.',
  },
  pending('reviews-reports.reviews', 'reviews-reports', 'Reviews after a completed deal', 'Reviews'),
  pending('reviews-reports.reports', 'reviews-reports', 'Reporting a listing or a member', 'Reports'),
  pending('scam-reports.off-platform', 'scam-reports', 'Off-platform scam reports', 'Off-platform scam reports (0154)'),
  pending('trusted-sellers.apply-review', 'trusted-sellers', 'Trusted Sellers', 'Trusted Sellers'),
  pending('references.experiences', 'references', 'References', 'References (0155, 0161–0169)'),
  pending('profile-payouts.profile-account', 'profile-payouts', 'Profile and account', 'Profile and account'),
  pending('admin.console', 'admin', 'Admin and arbitration console', 'Admin'),
  pending('marketing-errors.policy-pages', 'marketing-errors', 'Help, terms and privacy', 'Marketing and policy'),
  pending('jobs-webhooks.background-jobs', 'jobs-webhooks', 'Background jobs', 'Background jobs'),
  pending('jobs-webhooks.payments-tracking', 'jobs-webhooks', 'Payments, webhooks and tracking', 'Payments and tracking'),
  pending('guards.mobile-api', 'guards', 'Mobile write API', 'Mobile'),

  // ## Transaction models
  {
    id: 'cash-sale.model',
    area: 'cash-sale',
    function: 'Cash Sale model: the platform holds the money, the service fee, Multiple items line items',
    productSection: 'Cash Sale',
    kind: 'automated',
    happy: [
      'journeys.cash-sale-lifecycle',
      'cash-sale.payments.card-no-auth',
      'cash-sale.multiple-items.line-items',
      'cash-sale.delivery.lifecycle',
    ],
    refusal: [
      'cash-sale.payments.card-repriced',
      'cash-sale.payments.region-mismatch',
      'cash-sale.cancel.refused-after-payment',
    ],
  },
  {
    id: 'trades.model',
    area: 'trades',
    function: '2-Way Trade Escrow model: collateral holds, frozen side values, Multiple items sides, regions',
    productSection: '2-Way Trade Escrow',
    kind: 'automated',
    happy: [
      'journeys.trade-lifecycle',
      'trades.agree.side-values-frozen',
      'trades.collateral.locks-live-and-job-completes',
      'trades.shopfront.side-valued-at-offer',
    ],
    refusal: [
      'trades.shopfront.refused-as-offering-side',
      'trades.agree.refused-short-reservation',
      'trades.agree.refused-no-card',
      'trades.agree.refused-unverified',
      'trades.open.refused-region-mismatch',
    ],
  },
  pending('trade-disputes.resolution', 'trade-disputes', 'Dispute and fraud resolution', 'Dispute & Fraud Resolution'),
  pending('cash-sale-disputes.returns', 'cash-sale-disputes', 'Return-conditional refunds', 'Return-conditional refunds'),
];
