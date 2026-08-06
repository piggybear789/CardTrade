// domain/services/index.ts
//
// The single service factory — the seam that selects Mock or Stripe.
// Orchestrators, actions, and UI depend only on `PaymentService & KycService`,
// never on a concrete implementation.
//
// Payments: Stripe whenever a `STRIPE_SECRET_KEY` is present (see
// `providerMode.ts`), unless `PAYMENTS_PROVIDER` says otherwise.
//
// There is no longer a separate KYC binding. A previous version of this comment
// claimed KYC was "always the Mock delegate", which was already untrue whenever
// `STRIPE_KYC_MODE=identity` was set, and is now moot: identity verification is
// the Identity_Gate. NOTE: 0069 moved that gate to Stripe Identity, so there IS a
// provider call again and `IdentityService` binds it - but it is the ONLY
// verification path, not a second one running beside Connect. That is what made the
// old `KycService` wrong; see `stripe-payments.md`.

import { MockService } from './mock/MockService';
import {
  allConfiguredRegionCodes,
  DEFAULT_CONFIG_REGION,
  isStripeConfigured,
} from './stripe/config';
import { createStripeService } from './stripe';
import { resolvePaymentProvider } from './providerMode';
import {
  isTradingRegion,
  normalizeRegionCode,
  REGIONS,
  type RegionCode,
} from '../region';
import type { IdentityService, PayerService, PaymentService } from './types';

export type { PayerService, PaymentService } from './types';
export { MockService } from './mock/MockService';
export {
  isLivePaymentsProvider,
  isPaymentDemoEnabled,
  isRealMoneyProvider,
  resolvePaymentProvider,
  type PaymentProvider,
} from './providerMode';

/**
 * The provider contract every caller depends on: money movement, payer creation,
 * and identity verification.
 *
 * The `Kyc` in the name is now accurate again. It had stopped being a verification
 * interface when the old parallel KYC seam was removed, leaving only
 * `createPayer`; 0069 added {@link IdentityService}, which IS the Identity_Gate —
 * and unlike the retired seam it is the single source for that answer rather than a
 * competitor to Connect state.
 */
export type PaymentKycService = PaymentService & PayerService & IdentityService;

/** Default local endpoint the MockService POSTs signed Webhook_Events to. */
const DEFAULT_WEBHOOK_URL = 'http://localhost:3000/api/webhooks/stripe';

/**
 * Default shared secret for Mock webhook HMAC. Real Stripe deliveries use
 * `STRIPE_WEBHOOK_SECRET` instead.
 */
const DEFAULT_WEBHOOK_SECRET = 'dev-mock-webhook-secret';

function readWebhookConfig(): { webhookUrl: string; secret: string } {
  return {
    webhookUrl: process.env.WEBHOOK_URL ?? DEFAULT_WEBHOOK_URL,
    secret: process.env.WEBHOOK_SECRET ?? DEFAULT_WEBHOOK_SECRET,
  };
}

/**
 * Resolve the payment/KYC service binding for a region.
 *
 * ONE PLATFORM ACCOUNT PER REGION. Stripe refuses a transfer from a platform in
 * one region to a connected account in another (outside the US/CA/UK/EEA/CH set,
 * which excludes AU), and refuses cross-border payouts to recipient-agreement
 * accounts entirely. Because our funds flow is buyer → platform balance → seller,
 * the platform's country is in the path of even a wholly domestic sale. So the
 * region is not decoration on this call: it selects which Stripe account the money
 * moves through, and getting it wrong fails at transfer time with the buyer already
 * charged.
 *
 * An explicit `PAYMENTS_PROVIDER` without matching credentials fails closed —
 * never silently fake money movement when real payments were asked for.
 *
 * @param region ISO 3166-1 alpha-2. Defaults to the single-region deployment's
 *   region so existing callers keep working; every money path that knows its
 *   contract's region should pass it.
 */
export function getPaymentService(region?: string | null): PaymentKycService {
  const code = normalizeRegionCode(region) ?? DEFAULT_CONFIG_REGION;
  const { webhookUrl, secret } = readWebhookConfig();

  switch (resolvePaymentProvider()) {
    case 'stripe': {
      if (!isStripeConfigured(process.env, code)) {
        const suffix = code === DEFAULT_CONFIG_REGION ? '' : `_${code}`;
        throw new Error(
          `[payments] PAYMENTS_PROVIDER=stripe but STRIPE_SECRET_KEY${suffix} is missing ` +
            `for region ${code}. Each region needs its own Stripe platform account — a ` +
            'platform cannot transfer to a connected account in another region. ' +
            'Set the key, or set PAYMENTS_PROVIDER=mock for local mock money.',
        );
      }
      // Real Stripe. Test keys still hit the real API and place real
      // authorisations; they simply move no real funds.
      return createStripeService({ region: code });
    }

    default:
      // The Mock is deliberately region-agnostic: it moves no money, so it has no
      // platform account to be in the wrong country.
      return new MockService({ webhookUrl, secret });
  }
}

/**
 * The regions in which a contract may ACTUALLY be opened.
 *
 * The conjunction of product intent (`tradingEnabled` in the region registry) and
 * a configured payment binding. Both are required, and the second is why this lives
 * here rather than in the pure region module: whether a credential exists is a
 * runtime fact.
 *
 * WHY THE CONJUNCTION MATTERS. `tradingEnabled` alone would let a region be switched
 * on in code while no Stripe account exists to pay its sellers — members would be
 * badged ready to trade, list, and front cash sales, and every payout would fail.
 * That is the 0060 mistake (a state that looks complete and is not) with money
 * attached. A configured key alone is not enough either: a key can be present for a
 * region the product has not yet decided to open.
 *
 * Under `PAYMENTS_PROVIDER=mock` the binding requirement is dropped, because the
 * Mock can serve any region — otherwise local development could not exercise a
 * second region at all.
 */
export function operationalRegions(): ReadonlySet<RegionCode> {
  const intended = REGIONS.filter((region) => region.tradingEnabled).map((r) => r.code);

  if (resolvePaymentProvider() !== 'stripe') {
    return new Set(intended);
  }

  const configured = new Set(allConfiguredRegionCodes());
  return new Set(intended.filter((code) => configured.has(code)));
}

/** Whether a contract may be opened in this region right now. */
export function isOperationalRegion(region: unknown): boolean {
  const code = normalizeRegionCode(region);
  if (!code) return false;
  // Cheap short-circuit on intent before touching the environment.
  if (!isTradingRegion(code)) return false;
  return operationalRegions().has(code);
}
