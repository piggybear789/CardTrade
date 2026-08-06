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

import { findRegion } from '../../region';

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
  /**
   * The region this platform account serves, ISO 3166-1 alpha-2 uppercase.
   *
   * Present so a service instance can say which platform it is, which matters for
   * the payouts console: with several platform accounts there is one balance per
   * region and an unlabelled figure is unreadable.
   */
  region: string;
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
  /**
   * Default country for a connected account, ISO 3166-1 alpha-2 lowercase (0065).
   *
   * A FALLBACK, not the answer. `createManagedMerchant` prefers the Member's own
   * `profiles.region_code`, because a marketplace with more than one region cannot
   * have one account country. This covers a caller that supplies none — a script,
   * a seeded row, or a Member whose region predates the column.
   */
  country: string;
  holdStrategy: StripeHoldStrategy;
  /**
   * Dashboard-configured Stripe Identity verification flow id (`vf_...`), optional.
   *
   * PREFERRED WHEN SET, because it keeps the check's options — selfie, ID number,
   * live capture, accepted document types — in ONE place that is changeable without
   * a deploy. Duplicating them in code here would be a second definition of what
   * "verified" requires, and this codebase has been bitten by that twice.
   *
   * When unset, `createIdentityCheck` builds an equivalent session inline so a
   * developer with only an API key can still exercise the flow.
   */
  identityVerificationFlow?: string;

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
const DEFAULT_COUNTRY = 'au';
const DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * ONE STRIPE PLATFORM ACCOUNT PER REGION, AND WHY.
 *
 * Stripe permits cross-border transfers on the payments balance only between the
 * US, Canada, UK, EEA and Switzerland; elsewhere the platform and the connected
 * account must be in the same region, and an attempt across an unsupported border
 * returns an error. Cross-border payouts additionally require the platform itself
 * to be in the US, UK, EEA, CA or CH — AU is not eligible — and are refused for
 * connected accounts under a recipient service agreement, which is precisely what
 * `createManagedMerchant` opens.
 *
 * Our funds flow is buyer → PLATFORM balance → seller. So the platform's country
 * sits in the middle of even a wholly domestic sale, and no amount of product-level
 * "intra-region only" makes one account able to pay sellers in two countries.
 *
 * Credentials are therefore suffixed per region: `STRIPE_SECRET_KEY_GB`,
 * `STRIPE_WEBHOOK_SECRET_GB`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_GB`, and so on.
 * The UNSUFFIXED names remain the binding for {@link DEFAULT_CONFIG_REGION}, so the
 * existing single-region deployment keeps working untouched.
 */
export const DEFAULT_CONFIG_REGION = 'AU';

/**
 * Read an env var for a region, falling back to the unsuffixed name for the
 * default region only.
 *
 * The fallback is deliberately NOT applied to other regions. Letting GB silently
 * inherit the AU key would point UK sellers at an Australian platform account —
 * the exact misconfiguration this whole split exists to prevent — and it would fail
 * at transfer time, after a buyer had been charged.
 */
function readRegionalEnv(
  env: EnvLike,
  name: string,
  region: string,
): string | undefined {
  const code = region.trim().toUpperCase();
  const suffixed = env[`${name}_${code}`]?.trim();
  if (suffixed) return suffixed;
  if (code === DEFAULT_CONFIG_REGION) return env[name]?.trim() || undefined;
  return undefined;
}

/** Read and trim the secret key for a region, or `null` when absent/blank. */
function readSecretKey(env: EnvLike, region: string = DEFAULT_CONFIG_REGION): string | null {
  return readRegionalEnv(env, 'STRIPE_SECRET_KEY', region) ?? null;
}

/**
 * Every configured webhook signing secret, across EVERY region, de-duplicated.
 *
 * Deliberately not scoped to one region. Verification tries each secret in turn and
 * a delivery is authentic if any configured endpoint signed it, so the webhook
 * route does not need to know which region an event came from before it can
 * establish that the event is real — which is the right order, because the routing
 * metadata inside the payload cannot be trusted until the signature is.
 *
 * Each name may hold several secrets separated by commas or whitespace, so a
 * platform + Connect pair needs no extra variable. Values that do not look like a
 * signing secret are dropped rather than silently treated as one.
 */
export function readWebhookSecrets(
  env: EnvLike = process.env,
  regions: readonly string[] = allConfiguredRegionCodes(env),
): string[] {
  const names = ['STRIPE_WEBHOOK_SECRET', 'STRIPE_CONNECT_WEBHOOK_SECRET'];
  const candidates: (string | undefined)[] = [];

  for (const name of names) {
    // Unsuffixed first — it is the default region's secret and also what a local
    // `stripe listen` writes.
    candidates.push(env[name]);
    for (const region of regions) {
      candidates.push(env[`${name}_${region.trim().toUpperCase()}`]);
    }
  }

  const raw = candidates
    .filter((value): value is string => Boolean(value?.trim()))
    .flatMap((value) => value.split(/[\s,]+/))
    // Tolerate two secrets pasted with no separator, e.g. `whsec_aaa...whsec_bbb...`.
    .flatMap((value) => value.split(/(?=whsec_)/g))
    .map((value) => value.trim())
    .filter((value) => /^whsec_[A-Za-z0-9]{16,}$/.test(value));

  return [...new Set(raw)];
}

/**
 * Every region for which a Stripe secret key is configured.
 *
 * Discovered by scanning the environment for `STRIPE_SECRET_KEY_XX` rather than
 * from a list that has to be kept in step, so adding a region really is a matter of
 * setting its variables. The default region is included when the unsuffixed key is
 * present.
 *
 * This is the runtime half of "is this region live". `domain/region/regions.ts`
 * holds the product intent; a region needs BOTH.
 */
export function allConfiguredRegionCodes(env: EnvLike = process.env): string[] {
  const found = new Set<string>();

  if (env.STRIPE_SECRET_KEY?.trim()) found.add(DEFAULT_CONFIG_REGION);

  for (const key of Object.keys(env)) {
    const match = /^STRIPE_SECRET_KEY_([A-Z]{2})$/.exec(key);
    if (match && env[key]?.trim()) found.add(match[1]);
  }

  return [...found].sort();
}

/**
 * Derive the mode from the key prefix. Anything that is not explicitly a live
 * key is treated as test, so a malformed value fails safe rather than moving
 * real money.
 */
export function readStripeEnvironment(
  env: EnvLike = process.env,
  region: string = DEFAULT_CONFIG_REGION,
): StripeEnvironment {
  return readSecretKey(env, region)?.startsWith('sk_live_') ? 'live' : 'test';
}

/** True when a Stripe secret key is present for the given region. */
export function isStripeConfigured(
  env: EnvLike = process.env,
  region: string = DEFAULT_CONFIG_REGION,
): boolean {
  return readSecretKey(env, region) !== null;
}

/**
 * Build the Stripe configuration for a region from the environment.
 *
 * `currency` and `country` come from the REGION TABLE, not from the environment,
 * with the env vars kept only as an override for the default region. A per-region
 * env var for either would be a second place the mapping AU→aud lives, and the one
 * place it lives is `domain/region/regions.ts`.
 *
 * @param env    the environment to read
 * @param region ISO 3166-1 alpha-2; defaults to {@link DEFAULT_CONFIG_REGION}
 * @throws Error when no secret key is configured for that region. Call
 * {@link isStripeConfigured} first if you need to fall back instead of failing.
 */
export function readStripeConfig(
  env: EnvLike = process.env,
  region: string = DEFAULT_CONFIG_REGION,
): StripeConfig {
  const code = region.trim().toUpperCase();
  const secretKey = readSecretKey(env, code);
  if (!secretKey) {
    const suffix = code === DEFAULT_CONFIG_REGION ? '' : `_${code}`;
    throw new Error(
      `Stripe credentials are missing for region ${code}. Set STRIPE_SECRET_KEY${suffix} ` +
        '(sk_test_... or sk_live_...). Each region needs its OWN platform account: ' +
        'Stripe refuses transfers from a platform to a connected account in another ' +
        'region. For local mock money, set PAYMENTS_PROVIDER=mock.',
    );
  }

  const tolerance = Number.parseInt(env.STRIPE_WEBHOOK_TOLERANCE_SECONDS?.trim() ?? '', 10);
  const definition = findRegion(code);

  return {
    environment: secretKey.startsWith('sk_live_') ? 'live' : 'test',
    secretKey,
    apiVersion: env.STRIPE_API_VERSION?.trim() || undefined,
    webhookSecrets: readWebhookSecrets(env),
    publishableKey: readStripePublishableKey(env, code) ?? undefined,
    region: code,
    currency:
      definition?.currency ??
      env.STRIPE_CURRENCY?.trim().toLowerCase() ??
      DEFAULT_CURRENCY,
    country:
      definition?.stripeCountry ??
      env.STRIPE_ACCOUNT_COUNTRY?.trim().toLowerCase() ??
      DEFAULT_COUNTRY,
    holdStrategy: 'manual-capture',
    // Regional, for the same reason as the secret key: a verification flow belongs
    // to one Stripe account, so a GB platform cannot use the AU account's flow.
    identityVerificationFlow: readRegionalEnv(
      env,
      'STRIPE_IDENTITY_VERIFICATION_FLOW',
      code,
    ),

    payoutMode: env.PAYOUT_MODE?.trim().toLowerCase() === 'direct' ? 'direct' : 'platform',
    webhookToleranceSeconds: Number.isFinite(tolerance) && tolerance > 0
      ? tolerance
      : DEFAULT_TOLERANCE_SECONDS,
  };
}

/**
 * The Stripe.js publishable key for a region. Browser-safe by design; every other
 * value in this module is server-only.
 *
 * Region-scoped because each platform account has its own publishable key, and
 * confirming a SetupIntent minted on the AU platform with the GB publishable key
 * fails in the browser with an opaque error.
 */
export function readStripePublishableKey(
  env: EnvLike = process.env,
  region: string = DEFAULT_CONFIG_REGION,
): string | null {
  return readRegionalEnv(env, 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', region) ?? null;
}
