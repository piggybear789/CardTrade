// domain/services/stripe/config.ts
//
// Environment-driven configuration for the real Stripe integration. Isolated
// from the client/service so credential resolution is testable and so nothing
// else in the codebase needs to know which env vars carry the keys.
//
// Unlike Pinch, the environment is not a separate setting: a Stripe secret key
// is self-describing (`sk_test_...` vs `sk_live_...`), so there is no way for the
// mode and the credentials to disagree. Secret values are never logged or
// returned to callers.

/** Which Stripe mode the configured key targets. Derived, never declared. */
export type StripeEnvironment = 'test' | 'live';

/**
 * How the escrow Pre_Auth_Hold contract is realised on Stripe.
 *
 * `manual-capture` is a genuine card authorisation: `placeHold` confirms a
 * PaymentIntent with `capture_method: 'manual'` so no funds move, `voidHold`
 * cancels it, `partialCapture` captures the Friction_Tax and Stripe releases the
 * remainder automatically, and `fullCapture` captures the whole authorisation.
 *
 * This is the substantive difference from Pinch, whose public API has no
 * authorize/void/partial-capture primitives and forced a charge-and-refund
 * simulation in which the collateral genuinely left the trader's account.
 */
export type StripeHoldStrategy = 'manual-capture';

// `StripeKycMode` and the `STRIPE_KYC_MODE` switch used to live here, selecting
// between a deterministic KYC simulation and Stripe Identity VerificationSessions.
// Both are gone: identity verification is the Identity_Gate, which is Connect
// onboarding state reported on `account.updated`, so there is no mode to choose.

/**
 * How Cash_Sale proceeds are settled.
 *
 * `platform` collects into the platform balance only. `direct` additionally
 * transfers the proceeds to the Seller's connected account, retaining the flat
 * Platform_Fee (Req 4.7). Mirrors the existing `PAYOUT_MODE` switch.
 */
export type StripePayoutMode = 'platform' | 'direct';

export interface StripeConfig {
  environment: StripeEnvironment;
  /** `sk_test_...` / `sk_live_...`. Server-only. */
  secretKey: string;
  /**
   * Pinned Stripe API version. Pinning matters for the same reason
   * `pinch-version` did: omitting it opts into future breaking changes.
   * Left undefined to accept the SDK's bundled default, which is pinned by the
   * exact `stripe` package version in `package.json`.
   */
  apiVersion?: string;
  /**
   * `whsec_...` secrets accepted when verifying an inbound `stripe-signature`.
   *
   * A LIST because a platform needs more than one endpoint: our PaymentIntents
   * are created on the platform, so `payment_intent.*` / `charge.*` / `identity.*`
   * are platform events, while `account.updated` for a connected account is a
   * Connect event. Stripe issues a separate signing secret per endpoint, and
   * `stripe listen` mints a third for local forwarding.
   *
   * Verification tries each in turn, so a delivery is authentic if ANY configured
   * endpoint signed it. Order is irrelevant.
   */
  webhookSecrets: string[];
  /**
   * Browser-safe Stripe.js key, needed server-side only so
   * `beginInstrumentSetup` can hand it to the client alongside the setup secret
   * in one round trip.
   */
  publishableKey?: string;
  /** Presentment currency. AUD everywhere; integer cents end to end. */
  currency: string;
  holdStrategy: StripeHoldStrategy;

  payoutMode: StripePayoutMode;
  /**
   * Rejected-signature tolerance in seconds for webhook replay protection.
   * Stripe's default is 300s (5 minutes), matching the Pinch pipeline.
   */
  webhookToleranceSeconds: number;
}

/** Minimal env shape so tests can pass a plain object. */
export type EnvLike = Record<string, string | undefined>;

const DEFAULT_CURRENCY = 'aud';
const DEFAULT_TOLERANCE_SECONDS = 300;

/** Read and trim the secret key, or `null` when absent/blank. */
function readSecretKey(env: EnvLike): string | null {
  const key = env.STRIPE_SECRET_KEY?.trim();
  return key ? key : null;
}

/**
 * Every configured webhook signing secret, de-duplicated.
 *
 * `STRIPE_WEBHOOK_SECRET` may hold several, separated by commas or whitespace, so
 * a platform + Connect pair can be supplied without a second variable. Values
 * that do not look like a signing secret are dropped rather than silently
 * treated as one.
 */
export function readWebhookSecrets(env: EnvLike = process.env): string[] {
  const raw = [env.STRIPE_WEBHOOK_SECRET, env.STRIPE_CONNECT_WEBHOOK_SECRET]
    .filter((value): value is string => Boolean(value?.trim()))
    .flatMap((value) => value.split(/[\s,]+/))
    // Tolerate two secrets pasted with no separator, e.g. `whsec_aaa...whsec_bbb...`.
    .flatMap((value) => value.split(/(?=whsec_)/g))
    .map((value) => value.trim())
    .filter((value) => /^whsec_[A-Za-z0-9]{16,}$/.test(value));

  return [...new Set(raw)];
}

/**
 * Derive the mode from the key prefix. Anything that is not explicitly a live
 * key is treated as test, so a malformed value fails safe rather than moving
 * real money.
 */
export function readStripeEnvironment(env: EnvLike = process.env): StripeEnvironment {
  return readSecretKey(env)?.startsWith('sk_live_') ? 'live' : 'test';
}

/** True when a Stripe secret key is present. */
export function isStripeConfigured(env: EnvLike = process.env): boolean {
  return readSecretKey(env) !== null;
}

/**
 * Build the Stripe configuration from the environment.
 *
 * @throws Error when `STRIPE_SECRET_KEY` is missing. Call
 * {@link isStripeConfigured} first if you need to fall back instead of failing.
 */
export function readStripeConfig(env: EnvLike = process.env): StripeConfig {
  const secretKey = readSecretKey(env);
  if (!secretKey) {
    throw new Error(
      'Stripe credentials are missing. Set STRIPE_SECRET_KEY (sk_test_... or sk_live_...). ' +
        'For local mock money, set PAYMENTS_PROVIDER=mock.',
    );
  }

  const tolerance = Number.parseInt(env.STRIPE_WEBHOOK_TOLERANCE_SECONDS?.trim() ?? '', 10);

  return {
    environment: secretKey.startsWith('sk_live_') ? 'live' : 'test',
    secretKey,
    apiVersion: env.STRIPE_API_VERSION?.trim() || undefined,
    webhookSecrets: readWebhookSecrets(env),
    publishableKey: readStripePublishableKey(env) ?? undefined,
    currency: env.STRIPE_CURRENCY?.trim().toLowerCase() || DEFAULT_CURRENCY,
    holdStrategy: 'manual-capture',

    payoutMode: env.PAYOUT_MODE?.trim().toLowerCase() === 'direct' ? 'direct' : 'platform',
    webhookToleranceSeconds: Number.isFinite(tolerance) && tolerance > 0
      ? tolerance
      : DEFAULT_TOLERANCE_SECONDS,
  };
}

/**
 * The Stripe.js publishable key. Browser-safe by design; every other value in
 * this module is server-only.
 */
export function readStripePublishableKey(env: EnvLike = process.env): string | null {
  return env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() || null;
}
