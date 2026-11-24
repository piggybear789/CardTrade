// tests/e2e/audit/backend/stripe.ts
//
// The audit harness's Stripe client: TEST MODE ONLY, refused before any API call.
//
// Requirements:
//   1.3, 26.5  a key that is not a Stripe TEST secret key is refused, naming the
//              variable and never the value, before a client exists
//   2.7        every object the harness creates carries the run stamp
//              (`cardtrade_sandbox: 'true'`, `cardtrade_e2e_run: <id>`), the same two
//              keys the app writes on the sandbox, so cleanup finds both alike
//
// WHY THE REFUSAL HAPPENS HERE AND NOT ONLY IN PREFLIGHT. Preflight aborts a run with a
// live key in the environment, but a helper is also called from `debug/` probes and
// one-off scripts that never ran preflight. So the client itself refuses: there is no
// way to obtain a Stripe instance from this module with anything but an `sk_test_`
// key. `classifyStripeKey` (the preflight's own classifier) must call it `test`, AND it
// must be a SECRET key: a `pk_test_` cannot make server calls, and an `rk_test_` may
// lack the permissions a Pathway needs, which would fail mid-flow instead of here.
//
// Keys are read per PLATFORM, exactly like `credentialRegionFor` + `readRegionalEnv`
// in `domain/services/stripe/config.ts`: AU reads `STRIPE_SECRET_KEY_AU`, falling back
// to the unsuffixed `STRIPE_SECRET_KEY`; US reads `STRIPE_SECRET_KEY_US` and never
// falls back, because a US Pathway on the AU account would look right and fail late.

import Stripe from 'stripe';

import { classifyStripeKey } from '../core/preflight';
import { envValue } from '../../support/db';
import { readE2eRunId } from '../../../../domain/services/stripe/config';
import {
  E2E_RUN_METADATA_KEY,
  SANDBOX_METADATA_KEY,
  withRunStamp,
} from '../../../../domain/services/stripe/metadata';

/** A Stripe TEST platform account the suite drives. */
export type TestPlatform = 'AU' | 'US';

/** Every platform the suite may touch, for loops such as cleanup or fixture lookup. */
export const TEST_PLATFORMS: readonly TestPlatform[] = ['AU', 'US'];

export { E2E_RUN_METADATA_KEY, SANDBOX_METADATA_KEY };

/** Thrown when a key is missing or is not a Stripe test secret key. Never holds a value. */
export class StripeKeyRefusedError extends Error {
  constructor(
    readonly variable: string,
    readonly reason: 'missing' | 'live' | 'not-test-secret',
  ) {
    super(
      reason === 'missing'
        ? `refusing Stripe: ${variable} is not set`
        : reason === 'live'
          ? `refusing Stripe: ${variable} holds a LIVE key; the audit runs on test keys only`
          : `refusing Stripe: ${variable} is not a Stripe test secret key (sk_test_)`,
    );
    this.name = 'StripeKeyRefusedError';
  }
}

/**
 * Throws unless `value` is a Stripe TEST SECRET key. The error names `variable` and
 * never repeats the value. Pure, so it is unit-testable without any environment.
 */
export function assertTestSecretKey(variable: string, value: string | undefined): asserts value is string {
  const key = value?.trim();
  if (!key) throw new StripeKeyRefusedError(variable, 'missing');
  const kind = classifyStripeKey(key);
  if (kind === 'live') throw new StripeKeyRefusedError(variable, 'live');
  if (kind !== 'test' || !key.startsWith('sk_test_')) {
    throw new StripeKeyRefusedError(variable, 'not-test-secret');
  }
}

/** The variable holding a platform's secret key, and its value (never logged). */
function platformKey(platform: TestPlatform): { variable: string; value: string | undefined } {
  const suffixed = `STRIPE_SECRET_KEY_${platform}`;
  const fromSuffixed = envValue(suffixed)?.trim();
  if (fromSuffixed) return { variable: suffixed, value: fromSuffixed };
  // The unsuffixed key is the AU (default config region) binding and serves nothing else.
  if (platform === 'AU') return { variable: 'STRIPE_SECRET_KEY', value: envValue('STRIPE_SECRET_KEY') };
  return { variable: suffixed, value: undefined };
}

const clients = new Map<TestPlatform, Stripe>();

/**
 * A Stripe client for a TEST platform account. The key is checked before the client
 * is constructed, so a refused key never reaches the SDK, let alone the API.
 */
export function testStripe(platform: TestPlatform = 'AU'): Stripe {
  const cached = clients.get(platform);
  if (cached) return cached;
  const { variable, value } = platformKey(platform);
  assertTestSecretKey(variable, value);
  const apiVersion = envValue('STRIPE_API_VERSION')?.trim();
  const client = new Stripe(value, {
    ...(apiVersion ? { apiVersion: apiVersion as Stripe.LatestApiVersion } : {}),
    maxNetworkRetries: 2,
    appInfo: { name: 'NoDitto e2e audit' },
  });
  clients.set(platform, client);
  return client;
}

/**
 * The run id the harness stamps on Stripe objects.
 *
 * Resolved through the app's own `readE2eRunId`, so it is accepted on the same terms:
 * only while the schema is `cardtrade_dev`, and only in the same narrow shape. Throws
 * rather than returning undefined, because an unstamped object is one cleanup cannot
 * find.
 */
export function stripeRunId(): string {
  const runId = readE2eRunId({
    NEXT_PUBLIC_SUPABASE_SCHEMA: envValue('NEXT_PUBLIC_SUPABASE_SCHEMA'),
    E2E_RUN_ID: envValue('E2E_RUN_ID'),
  });
  if (!runId) {
    throw new Error(
      'refusing Stripe: E2E_RUN_ID is unset or invalid, or the schema is not cardtrade_dev, so created objects could not be stamped for cleanup',
    );
  }
  return runId;
}

/**
 * `metadata` with the run stamp added. Use it on EVERY object the harness creates
 * (Customers, PaymentMethods attached for a persona, PaymentIntents, accounts). The
 * stamp keys are the app's own (`withRunStamp`), so harness-made and app-made objects
 * from one run are found by one search.
 */
export function stampedMetadata(
  metadata: Record<string, string> = {},
  runId: string = stripeRunId(),
): Record<string, string> {
  return withRunStamp(metadata, runId);
}

/**
 * A Stripe Search clause matching objects one run made, for `customers.search`,
 * `paymentIntents.search` and friends. The id is restricted by `readE2eRunId`'s
 * pattern, so it needs no escaping beyond the quotes.
 */
export function runSearchQuery(runId: string = stripeRunId()): string {
  return `metadata['${SANDBOX_METADATA_KEY}']:'true' AND metadata['${E2E_RUN_METADATA_KEY}']:'${runId}'`;
}
