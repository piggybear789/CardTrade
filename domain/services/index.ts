// domain/services/index.ts
//
// The single service factory — the seam that selects Mock vs real Pinch.
// Orchestrators, actions, and UI depend only on `PaymentService & KycService`.
//
// Payments: real Pinch whenever credentials are present (see `providerMode.ts`),
// unless `PAYMENTS_PROVIDER=mock`. KYC: always the Mock delegate under Pinch
// (`PINCH_KYC_MODE=mock`) because Glassbox has no public REST API.

import { MockService } from './mock/MockService';
import { createPinchService, isPinchConfigured } from './pinch';
import { isLivePaymentsProvider } from './providerMode';
import type { KycService, PaymentService } from './types';

export type { KycService, PaymentService } from './types';
export { MockService } from './mock/MockService';
export { isLivePaymentsProvider, isPaymentDemoEnabled } from './providerMode';

/**
 * The combined payment + KYC contract that every caller depends on.
 */
export type PaymentKycService = PaymentService & KycService;

/**
 * Default local endpoint the MockService POSTs signed Webhook_Events to.
 */
const DEFAULT_WEBHOOK_URL = 'http://localhost:3000/api/webhooks/pinch';

/**
 * Default shared secret for Mock webhook HMAC. Production Pinch uses
 * `PINCH_WEBHOOK_SECRET` instead.
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
 * Real Pinch (test or live) when {@link isLivePaymentsProvider} is true. KYC
 * verification stays on the Mock delegate. Explicit `PAYMENTS_PROVIDER=pinch`
 * without credentials fails closed — never silently fake money movement.
 */
export function getPaymentService(): PaymentKycService {
  const { webhookUrl, secret } = readWebhookConfig();
  const mock = new MockService({ webhookUrl, secret });

  const explicit = process.env.PAYMENTS_PROVIDER?.trim().toLowerCase();

  if (explicit === 'pinch' && !isPinchConfigured()) {
    throw new Error(
      '[payments] PAYMENTS_PROVIDER=pinch but Pinch credentials are missing. ' +
        'Set PINCH_DEV_ID/PINCH_DEV_SECRET (test) or PINCH_LIVE_ID/PINCH_LIVE_SECRET (live), ' +
        'or PINCH_APP_ID/PINCH_SECRET_KEY. For local mock money, set PAYMENTS_PROVIDER=mock.',
    );
  }

  if (isLivePaymentsProvider()) {
    // Real money path (test mode still hits api.getpinch.com.au/test/). Mock is
    // KYC-only — Glassbox is not on the public REST surface.
    return createPinchService(mock);
  }

  return mock;
}
