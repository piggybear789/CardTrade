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
// the Identity_Gate (Connect onboarding APPROVED with settlements enabled), which
// is provider state rather than a provider call, so there is nothing to bind.

import { MockService } from './mock/MockService';
import { isStripeConfigured } from './stripe/config';
import { createStripeService } from './stripe';
import { resolvePaymentProvider } from './providerMode';
import type { PayerService, PaymentService } from './types';

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
 * The provider contract every caller depends on: money movement plus payer
 * creation.
 *
 * The name is kept for now because it is referenced across the orchestrators and
 * actions, but the `Kyc` half is no longer a verification interface — it is just
 * `createPayer`. Renaming it is a mechanical follow-up, not a behaviour change.
 */
export type PaymentKycService = PaymentService & PayerService;

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
 * Resolve the payment/KYC service binding.
 *
 * An explicit `PAYMENTS_PROVIDER` without matching credentials fails closed —
 * never silently fake money movement when real payments were asked for.
 */
export function getPaymentService(): PaymentKycService {
  const { webhookUrl, secret } = readWebhookConfig();
  const mock = new MockService({ webhookUrl, secret });

  switch (resolvePaymentProvider()) {
    case 'stripe': {
      if (!isStripeConfigured()) {
        throw new Error(
          '[payments] PAYMENTS_PROVIDER=stripe but STRIPE_SECRET_KEY is missing. ' +
            'Set STRIPE_SECRET_KEY (sk_test_... or sk_live_...), ' +
            'or set PAYMENTS_PROVIDER=mock for local mock money.',
        );
      }
      // Real Stripe. Test keys still hit the real API and place real
      // authorisations; they simply move no real funds. Nothing is delegated to
      // the Mock any more — it is constructed only for the mock branch below.
      return createStripeService();
    }

    default:
      return mock;
  }
}
