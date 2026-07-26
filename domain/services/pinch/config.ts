// domain/services/pinch/config.ts
//
// Environment-driven configuration for the real Pinch Payments integration.
// Isolated from the client/service so credential resolution is testable and so
// nothing else in the codebase needs to know which env vars carry the keys.
//
// Credentials are read from the env names already present in `.env.local`:
//   test:  PINCH_DEV_ID  / PINCH_DEV_SECRET
//   live:  PINCH_LIVE_ID / PINCH_LIVE_SECRET
// with `PINCH_APP_ID` / `PINCH_SECRET_KEY` accepted as an explicit override for
// either environment. Secret values are never logged or returned to callers.

/** Which Pinch environment to talk to. Test is the default everywhere. */
export type PinchEnvironment = 'test' | 'live';

/**
 * How the escrow Pre_Auth_Hold contract is realised on Pinch.
 *
 * The public Pinch API has no authorize/void/partial-capture primitives, so
 * `charge-and-refund` is the only strategy the documented API supports:
 * `placeHold` charges the collateral, `voidHold` refunds it in full,
 * `partialCapture` refunds the remainder (keeping the Friction_Tax), and
 * `fullCapture` simply keeps the charge. This is a real movement of funds, not a
 * true authorization hold - see the steering note in
 * `.kiro/steering/pinch-payments.md`.
 */
export type PinchHoldStrategy = 'charge-and-refund';

/**
 * How identity verification is served while running against real Pinch
 * payments. Pinch Glassbox KYC is not part of the public REST API, so
 * `mock` keeps the deterministic KYC simulation (real Payer records are still
 * created on Pinch) and `provider` reserves the slot for the real integration.
 */
export type PinchKycMode = 'mock' | 'provider';

export interface PinchConfig {
  environment: PinchEnvironment;
  /** Base URL including the environment segment and trailing slash omitted. */
  apiBaseUrl: string;
  /** OAuth2 token endpoint. */
  authUrl: string;
  /** Application ID used as the OAuth2 `client_id`. */
  clientId: string;
  /** Application secret key used as the OAuth2 `client_secret`. */
  clientSecret: string;
  /** Value sent in the `pinch-version` header on every request. */
  apiVersion: string;
  /** Optional Managed Merchant to act on behalf of (`Current-Merchant` header). */
  merchantId?: string;
  /** `whsec_...` secret used to verify inbound `pinch-signature` headers. */
  webhookSecret?: string;
  holdStrategy: PinchHoldStrategy;
  kycMode: PinchKycMode;
  /**
   * Default `Time-Travel` value sent on TEST requests only (ISO-8601). Pinch's
   * test environment treats the request as if it arrived at that instant, which
   * triggers overnight direct-debit processing and settlement immediately.
   * Ignored in `live` and stripped before the header is built there.
   */
  timeTravel?: string;
  /**
   * Test-only dishonour code (e.g. `insufficient-funds`). Pinch triggers the
   * matching failure when the code appears, prefixed with `#`, in the payment
   * description. Used to demo the HOLDS_FAILED / transfer-failed paths.
   */
  testDishonourCode?: string;
  /**
   * Test-only: allow the app to drive a Managed Merchant compliance decision
   * itself. Pinch's test environment lets a merchant transact before approval
   * and exposes no endpoint to advance a compliance review, so the decision is
   * simulated by delivering a signed `compliance-updated` webhook. Never
   * available in `live`.
   */
  simulateCompliance: boolean;
}

/** Minimal env shape so tests can pass a plain object. */
export type EnvLike = Record<string, string | undefined>;

const AUTH_URL = 'https://auth.getpinch.com.au/connect/token';
const API_HOST = 'https://api.getpinch.com.au';
const DEFAULT_API_VERSION = '2020.1';

/** Resolve the target environment, defaulting to `test`. */
export function readPinchEnvironment(env: EnvLike = process.env): PinchEnvironment {
  return env.PINCH_ENV?.trim().toLowerCase() === 'live' ? 'live' : 'test';
}

/** The credential pair for an environment, or `null` when either half is absent. */
function readCredentials(
  env: EnvLike,
  environment: PinchEnvironment,
): { clientId: string; clientSecret: string } | null {
  const clientId =
    env.PINCH_APP_ID ?? (environment === 'live' ? env.PINCH_LIVE_ID : env.PINCH_DEV_ID);
  const clientSecret =
    env.PINCH_SECRET_KEY ??
    (environment === 'live' ? env.PINCH_LIVE_SECRET : env.PINCH_DEV_SECRET);

  if (!clientId?.trim() || !clientSecret?.trim()) return null;
  return { clientId: clientId.trim(), clientSecret: clientSecret.trim() };
}

/** True when credentials for the selected environment are present. */
export function isPinchConfigured(env: EnvLike = process.env): boolean {
  return readCredentials(env, readPinchEnvironment(env)) !== null;
}

/**
 * Build the Pinch configuration from the environment.
 *
 * @throws Error when credentials for the selected environment are missing. Call
 * {@link isPinchConfigured} first if you need to fall back instead of failing.
 */
export function readPinchConfig(env: EnvLike = process.env): PinchConfig {
  const environment = readPinchEnvironment(env);
  const credentials = readCredentials(env, environment);
  if (!credentials) {
    throw new Error(
      `Pinch ${environment} credentials are missing. Set ` +
        (environment === 'live'
          ? 'PINCH_LIVE_ID and PINCH_LIVE_SECRET'
          : 'PINCH_DEV_ID and PINCH_DEV_SECRET') +
        ' (or PINCH_APP_ID / PINCH_SECRET_KEY).',
    );
  }

  return {
    environment,
    apiBaseUrl: `${API_HOST}/${environment}`,
    authUrl: AUTH_URL,
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    apiVersion: env.PINCH_API_VERSION?.trim() || DEFAULT_API_VERSION,
    merchantId: env.PINCH_MERCHANT_ID?.trim() || undefined,
    webhookSecret: env.PINCH_WEBHOOK_SECRET?.trim() || undefined,
    holdStrategy: 'charge-and-refund',
    kycMode: env.PINCH_KYC_MODE?.trim().toLowerCase() === 'provider' ? 'provider' : 'mock',
    // Every simulation switch below is test-only by construction: `live` never
    // reads them, so a stray env var cannot alter production behaviour.
    timeTravel: environment === 'test' ? env.PINCH_TIME_TRAVEL?.trim() || undefined : undefined,
    testDishonourCode:
      environment === 'test'
        ? env.PINCH_TEST_DISHONOUR_CODE?.trim().replace(/^#/, '') || undefined
        : undefined,
    simulateCompliance:
      environment === 'test' && env.PINCH_SIMULATE_COMPLIANCE?.trim().toLowerCase() !== 'false',
  };
}

/**
 * The CaptureJS publishable key for the selected environment. Browser-safe by
 * design; every other Pinch value in this module is server-only.
 */
export function readPinchPublishableKey(env: EnvLike = process.env): string | null {
  const environment = readPinchEnvironment(env);
  const key =
    env.NEXT_PUBLIC_PINCH_PUBLISHABLE_KEY ??
    (environment === 'live' ? env.PINCH_PUBLISHABLE_KEY : env.PINCH_TEST_PUBLISHABLE_KEY);
  return key?.trim() || null;
}
