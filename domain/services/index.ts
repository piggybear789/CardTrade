// domain/services/index.ts
//
// The single service factory - the seam that lets the real Pinch integration
// slot in later without any caller referencing a concrete implementation. The
// rest of the system depends only on `PaymentService & KycService`; only this
// module decides which concrete binding is used.
//
// This phase always returns the deterministic MockService. A future phase adds
// a `PinchService` (talking to the real Pinch Payments REST API + Pinch Glassbox
// KYC) and binds it here when `PAYMENTS_PROVIDER === 'pinch'`. Swapping the
// provider therefore touches only this file - never the orchestrators, the
// state machine, the server actions, or the UI.

import { MockService } from './mock/MockService';
import { createPinchService, isPinchConfigured } from './pinch';
import type { KycService, PaymentService } from './types';

export type { KycService, PaymentService } from './types';
export { MockService } from './mock/MockService';

/**
 * The combined payment + KYC contract that every caller depends on. Both the
 * MockService (this phase) and the future PinchService satisfy it.
 */
export type PaymentKycService = PaymentService & KycService;

/**
 * Default local endpoint the MockService POSTs signed Webhook_Events to. Points
 * at the Webhook_Handler route (`app/api/webhooks/pinch/route.ts`). Overridable
 * via the `WEBHOOK_URL` env var so the same code works across dev/preview.
 */
const DEFAULT_WEBHOOK_URL = 'http://localhost:3000/api/webhooks/pinch';

/**
 * Default shared secret used to sign webhook bodies when `WEBHOOK_SECRET` is not
 * set. The signature path is real (HMAC-SHA256), but the secret is local to the
 * MVP; production supplies a real secret via env. Kept obviously non-secret so a
 * missing env var is easy to spot rather than silently "working".
 */
const DEFAULT_WEBHOOK_SECRET = 'dev-mock-webhook-secret';

/**
 * Read webhook wiring from the environment with sensible local defaults. The
 * MockService needs both to sign and deliver simulated Webhook_Events; the real
 * PinchService would read its own credentials here instead.
 */
function readWebhookConfig(): { webhookUrl: string; secret: string } {
  return {
    webhookUrl: process.env.WEBHOOK_URL ?? DEFAULT_WEBHOOK_URL,
    secret: process.env.WEBHOOK_SECRET ?? DEFAULT_WEBHOOK_SECRET,
  };
}

/**
 * Resolve the payment/KYC service binding.
 *
 * This phase always returns a MockService. The `PAYMENTS_PROVIDER === 'pinch'`
 * branch is the seam for the future real integration.
 *
 * @returns a value satisfying both `PaymentService` and `KycService`.
 */
export function getPaymentService(): PaymentKycService {
  const { webhookUrl, secret } = readWebhookConfig();
  const mock = new MockService({ webhookUrl, secret });

  if (process.env.PAYMENTS_PROVIDER === 'pinch') {
    // Real Pinch Payments REST API. The Mock is passed in as the KYC delegate
    // because Pinch Glassbox KYC has no public REST contract yet: Payer records
    // are created on real Pinch, while the verification run stays deterministic
    // (see `PINCH_KYC_MODE` in `domain/services/pinch/config.ts`).
    //
    // Missing/incomplete credentials fall back to the Mock rather than leaving
    // the app with no working service binding; the warning names the env vars.
    if (isPinchConfigured()) {
      return createPinchService(mock);
    }
    console.warn(
      '[payments] PAYMENTS_PROVIDER=pinch but Pinch credentials are missing ' +
        '(PINCH_DEV_ID/PINCH_DEV_SECRET for test, PINCH_LIVE_ID/PINCH_LIVE_SECRET for live). ' +
        'Falling back to the MockService.',
    );
  }

  return mock;
}
