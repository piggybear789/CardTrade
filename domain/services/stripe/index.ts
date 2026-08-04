// domain/services/stripe/index.ts
//
// Public surface of the real Stripe integration. Only `domain/services/index.ts`
// (the service factory) and the Webhook_Handler import from here; nothing else
// in the codebase may depend on Stripe types.

import Stripe from 'stripe';

import { readStripeConfig, type StripeConfig } from './config';
import { StripeService } from './StripeService';

export {
  isStripeConfigured,
  readStripeConfig,
  readStripeEnvironment,
  readStripePublishableKey,
  readWebhookSecrets,
  type EnvLike,
  type StripeConfig,
  type StripeEnvironment,
  type StripeHoldStrategy,

  type StripePayoutMode,
} from './config';
export { StripeService, type StripeServiceOptions } from './StripeService';
export {
  decodeMetadata,
  encodeMetadata,
  metadataFor,
  parseRef,
  type CardTradeMetadata,
  type StripePaymentKind,
} from './metadata';
export {
  DEFAULT_TOLERANCE_SECONDS,
  STRIPE_SIGNATURE_HEADER,
  translateStripeEvent,
  verifyStripeSignature,
} from './webhook';

/**
 * Build a configured Stripe SDK client.
 *
 * Shared by the service factory and the webhook route, which needs a client for
 * signature verification but not a whole service.
 */
export function createStripeClient(config: StripeConfig = readStripeConfig()): Stripe {
  return new Stripe(config.secretKey, {
    ...(config.apiVersion ? { apiVersion: config.apiVersion as Stripe.LatestApiVersion } : {}),
    // Surfaces CardTrade in Stripe's request logs, which makes support
    // conversations about a specific call far easier.
    appInfo: { name: 'NoDitto', url: 'https://noditto.app' },
    // The SDK retries idempotently on network errors; every write in
    // StripeService carries an explicit idempotency key, so retries are safe.
    maxNetworkRetries: 2,
  });
}

/**
 * Build a `StripeService` from the environment.
 *
 * Takes no KYC delegate: identity verification is the Identity_Gate, which is
 * Connect onboarding state rather than a provider call, so there is nothing left
 * to delegate.
 *
 * @throws Error when `STRIPE_SECRET_KEY` is missing.
 */
export function createStripeService(): StripeService {
  const config = readStripeConfig();
  return new StripeService({
    client: createStripeClient(config),
    config,
  });
}
