// domain/services/providerMode.ts
//
// Resolves whether money movement goes through real Stripe or the deterministic
// MockService.
//
// There is no separate KYC selection any more. `STRIPE_KYC_MODE` chose between a
// deterministic verification simulation and Stripe Identity; both are gone.
// The Identity_Gate is a Stripe Identity check (0069), bound through
// `IdentityService` on the same seam as payments rather than selected separately —
// so the provider binding is still the only thing to resolve here.

import { isStripeConfigured, type EnvLike } from './stripe/config';

export type { EnvLike };

/** Which binding a set of credentials selects. */
export type PaymentProvider = 'mock' | 'stripe';

/**
 * Resolve the active payment provider.
 *
 * - `PAYMENTS_PROVIDER=mock` → mock (local UI demos without credentials)
 * - `PAYMENTS_PROVIDER=stripe` → Stripe, and it must be configured; the factory
 *   fails closed rather than faking money movement
 * - unset → Stripe when configured, else mock
 */
export function resolvePaymentProvider(env: EnvLike = process.env): PaymentProvider {
  const explicit = env.PAYMENTS_PROVIDER?.trim().toLowerCase();

  if (explicit === 'mock') return 'mock';
  if (explicit === 'stripe') return 'stripe';

  return isStripeConfigured(env) ? 'stripe' : 'mock';
}

/**
 * True when payment operations should call the real Stripe API.
 *
 * Note that "live" here means "a real provider", not "real money": Stripe test
 * keys are real API calls that place real authorisations but move no real funds.
 * Use {@link isRealMoneyProvider} for the money question.
 */
export function isLivePaymentsProvider(env: EnvLike = process.env): boolean {
  return resolvePaymentProvider(env) === 'stripe' && isStripeConfigured(env);
}

/**
 * True when the active configuration can move real money — a `sk_live_` key.
 * Guard anything destructive or demo-flavoured on this rather than on
 * {@link isLivePaymentsProvider}.
 */
export function isRealMoneyProvider(env: EnvLike = process.env): boolean {
  if (resolvePaymentProvider(env) !== 'stripe') return false;
  return env.STRIPE_SECRET_KEY?.trim().startsWith('sk_live_') === true;
}

/**
 * True when the fake webhook demo panels / fire* actions may run. Never when a
 * real provider is active — those buttons inject mock-signed events that skip
 * the real charge path entirely.
 */
export function isPaymentDemoEnabled(env: EnvLike = process.env): boolean {
  if (isLivePaymentsProvider(env)) return false;

  const explicit = env.ENABLE_PAYMENT_DEMO?.trim().toLowerCase();
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;

  // UNSET MEANS ON IN DEVELOPMENT, OFF IN PRODUCTION.
  //
  // This used to be "on unless the value is exactly 'false'", which failed OPEN in the
  // one direction that matters. `isLivePaymentsProvider` is false whenever Stripe is
  // unconfigured, so a deployment that lost or mistyped `STRIPE_SECRET_KEY` became a
  // deployment where the demo actions were live — and `fireIdentityWebhook` writes
  // `identity_check_status = 'VERIFIED'` for its caller, which is the gate that unlocks
  // listing, selling and trade escrow. A missing credential should never be the thing
  // that lets every member verify themselves.
  //
  // Development keeps working with no configuration, because that is where these panels
  // are useful and where there is no real money to reach. Production requires the
  // explicit opt-in; the e2e harness sets it (see `playwright.config.ts`), since
  // `next start` runs with NODE_ENV=production.
  return env.NODE_ENV !== 'production';
}
