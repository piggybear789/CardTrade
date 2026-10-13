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

import {
  allConfiguredRegionCodes,
  isStripeConfigured,
  liveConfiguredRegionCodes,
  type EnvLike,
} from './stripe/config';
import { isProductionEnv } from '../env/isProduction';

export type { EnvLike };

/**
 * Which binding a set of credentials selects.
 *
 * `unconfigured` (ESC-16): production with no usable provider. The factory THROWS for
 * it rather than handing back the mock, because a deployment that lost its Stripe key
 * used to settle every payment against simulated money and report success.
 */
export type PaymentProvider = 'mock' | 'stripe' | 'unconfigured';

/** Thrown by `getPaymentService` when no provider may run (ESC-16). */
export class PaymentsUnconfiguredError extends Error {
  constructor() {
    super(
      '[payments] No payment provider is configured for production. Set STRIPE_SECRET_KEY, ' +
        'or — only for a deliberate demo deployment — PAYMENTS_PROVIDER=mock together with ' +
        'ALLOW_MOCK_PAYMENTS_IN_PRODUCTION=true.',
    );
    this.name = 'PaymentsUnconfiguredError';
  }
}

/**
 * Resolve the active payment provider.
 *
 * - `PAYMENTS_PROVIDER=stripe` → Stripe; the factory fails closed per region when that
 *   region's key is missing.
 * - `PAYMENTS_PROVIDER=mock` → mock in development. In PRODUCTION only with
 *   `ALLOW_MOCK_PAYMENTS_IN_PRODUCTION=true` too; otherwise `unconfigured`.
 * - unset → Stripe when any region is configured; else mock in development and
 *   `unconfigured` in production (ESC-16: the old silent fallback to fake money).
 */
export function resolvePaymentProvider(env: EnvLike = process.env): PaymentProvider {
  const explicit = env.PAYMENTS_PROVIDER?.trim().toLowerCase();
  const production = isProductionEnv(env);
  const mockAllowed = !production || env.ALLOW_MOCK_PAYMENTS_IN_PRODUCTION?.trim().toLowerCase() === 'true';

  if (explicit === 'stripe') return 'stripe';
  if (explicit === 'mock') return mockAllowed ? 'mock' : 'unconfigured';

  if (isStripeConfigured(env) || allConfiguredRegionCodes(env).length > 0) return 'stripe';
  return production ? 'unconfigured' : 'mock';
}

/**
 * True when payment operations should call the real Stripe API.
 *
 * Note that "live" here means "a real provider", not "real money": Stripe test
 * keys are real API calls that place real authorisations but move no real funds.
 * Use {@link isRealMoneyProvider} for the money question.
 *
 * Asks about EVERY region (ESC-16), not only the AU key.
 */
export function isLivePaymentsProvider(env: EnvLike = process.env): boolean {
  return resolvePaymentProvider(env) === 'stripe' && allConfiguredRegionCodes(env).length > 0;
}

/**
 * Whether a MOCK-signed webhook may be accepted at all (ESC-16).
 *
 * Only while the mock is the active provider AND a `WEBHOOK_SECRET` is set. There is
 * no default secret any more: the old one was in the repository, so anyone could sign
 * a delivery whenever the mock path was reachable.
 */
export function acceptsMockWebhooks(env: EnvLike = process.env): boolean {
  return resolvePaymentProvider(env) === 'mock' && Boolean(env.WEBHOOK_SECRET?.trim());
}

/**
 * True when the active configuration can move real money — a live key in ANY
 * configured region. Guard anything destructive or demo-flavoured on this rather
 * than on {@link isLivePaymentsProvider}.
 *
 * ASKS ABOUT EVERY REGION, NOT JUST THE DEFAULT. This read `env.STRIPE_SECRET_KEY`
 * directly, which is the AU binding alone (`DEFAULT_CONFIG_REGION`). Once a second
 * region existed, an AU test key beside a US LIVE key answered "no real money is
 * reachable" — so a demo panel or a smoke script guarded on this would have run
 * against a live platform account with a real card. Real money is reachable if ANY
 * region can reach it.
 *
 * See {@link isLiveSecretKey} for why the prefix test is not `sk_live_` alone.
 */
export function isRealMoneyProvider(env: EnvLike = process.env): boolean {
  if (resolvePaymentProvider(env) !== 'stripe') return false;
  return liveConfiguredRegionCodes(env).length > 0;
}

/**
 * True when the fake webhook demo panels / fire* actions may run. Never when a
 * real provider is active — those buttons inject mock-signed events that skip
 * the real charge path entirely.
 */
export function isPaymentDemoEnabled(env: EnvLike = process.env): boolean {
  // Only ever against the mock (ESC-16): never with a real provider, and never on an
  // `unconfigured` production deployment.
  if (resolvePaymentProvider(env) !== 'mock') return false;

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
