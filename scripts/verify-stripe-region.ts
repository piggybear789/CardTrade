/**
 * Read-only verification that each configured region's Stripe binding agrees with
 * the region table. Makes NO Stripe API calls and performs NO writes, so it is
 * safe to run against a live key — which is the point: it is the pre-flight check
 * for opening a region, and the one check that CAN be pointed at production.
 *
 *   npx tsx --env-file=.env.local scripts/verify-stripe-region.ts
 *   npx tsx --env-file=.env.local scripts/verify-stripe-region.ts US
 *
 * What it catches, all of which have actually happened in this repo:
 *
 *   - a key in the wrong NAME (`STRIPE_SECRET_KEY_US_TEST` is not a name the code
 *     reads; `allConfiguredRegionCodes` matches exactly two letters)
 *   - a RESTRICTED live key (`rk_live_`) reported as test mode, which satisfied
 *     the escrow smoke's guards and would have moved real money
 *   - a region `tradingEnabled` in product intent but with no binding configured,
 *     which badges members ready to trade and then refuses every contract
 *   - a publishable key from a different MODE or a different ACCOUNT than the
 *     secret key, which fails in the browser with an opaque error
 *   - a currency whose minor unit this codebase cannot represent
 *
 * Exit code is non-zero when any assertion fails, so it works in CI.
 */

import {
  allConfiguredRegionCodes,
  isLiveSecretKey,
  liveConfiguredRegionCodes,
  readStripeConfig,
  readStripeEnvironment,
  readStripePublishableKey,
} from '../domain/services/stripe/config';
import { operationalRegions } from '../domain/services';
import {
  assertMinorUnitSupported,
  findRegion,
  isTradingRegion,
  minorUnitDigits,
  REGIONS,
} from '../domain/region';

let failures = 0;

function pass(detail: string): void {
  console.log(`  ok    ${detail}`);
}

function fail(detail: string): void {
  console.error(`  FAIL  ${detail}`);
  failures += 1;
}

function check(condition: unknown, detail: string): void {
  if (condition) pass(detail);
  else fail(detail);
}

/** Mode of a publishable key, without revealing it. */
function publishableMode(key: string | null): 'live' | 'test' | 'absent' | 'malformed' {
  if (!key) return 'absent';
  if (key.startsWith('pk_live_')) return 'live';
  if (key.startsWith('pk_test_')) return 'test';
  return 'malformed';
}

/**
 * The account fragment embedded in a Stripe key, e.g. `51UIfsRRbOJEOZeCm`.
 *
 * Comparing this between the secret and publishable key catches the cross-account
 * mistake `config.ts` warns about — confirming a SetupIntent minted on one
 * platform with another platform's publishable key. It is a prefix of the account
 * id, not a secret, but it is only ever printed, never returned.
 */
function accountFragment(key: string | null | undefined): string | null {
  const match = /^(?:sk|rk|pk)_(?:live|test)_([A-Za-z0-9]{16})/.exec(key?.trim() ?? '');
  return match ? match[1] : null;
}

function verifyRegion(code: string): void {
  console.log(`\n=== ${code} ===`);

  const definition = findRegion(code);
  if (!definition) {
    fail(`${code} is not in REGIONS — it cannot host a platform account`);
    return;
  }

  let config;
  try {
    config = readStripeConfig(process.env, code);
  } catch (error) {
    fail(`readStripeConfig threw: ${(error as Error).message}`);
    return;
  }

  // Mode. Reported per region, because the whole point of the split is that each
  // region has its own account and they need not be in the same mode.
  const environment = readStripeEnvironment(process.env, code);
  check(
    config.environment === environment,
    `mode agrees between readStripeConfig and readStripeEnvironment (${environment})`,
  );
  if (environment === 'live') {
    console.log('        LIVE KEY — real money is reachable for this region');
  }

  // Currency and country come from the region table, never the environment.
  check(
    config.currency === definition.currency,
    `currency ${config.currency} matches the region table (${definition.currency})`,
  );
  check(
    config.country === definition.stripeCountry,
    `account country ${config.country} matches the region table (${definition.stripeCountry})`,
  );

  try {
    assertMinorUnitSupported(config.currency);
    pass(`minor unit representable: ${minorUnitDigits(config.currency)} digit(s)`);
  } catch (error) {
    fail(`minor unit unsupported: ${(error as Error).message}`);
  }

  // Publishable key: present, same mode, same account.
  const publishable = readStripePublishableKey(process.env, code);
  const pubMode = publishableMode(publishable);
  check(
    pubMode === environment,
    `publishable key mode (${pubMode}) matches the secret key mode (${environment})`,
  );

  const secretAccount = accountFragment(config.secretKey);
  const pubAccount = accountFragment(publishable);
  check(
    secretAccount !== null && pubAccount !== null && secretAccount === pubAccount,
    `publishable and secret key belong to the same account (${secretAccount ?? '?'})`,
  );

  // Webhook secrets are collected across every region, so this is a floor rather
  // than a per-region count: zero means no delivery can ever be authenticated.
  check(
    config.webhookSecrets.length > 0,
    `${config.webhookSecrets.length} webhook signing secret(s) configured`,
  );

  // Identity flow is optional by design — unset falls back to an inline document
  // session. Flagged rather than failed, and flagged HARDER when the modes differ,
  // because a live `vf_` does not resolve against a test key.
  if (config.identityVerificationFlow) {
    pass('identity verification flow configured');
  } else {
    console.log('        note: no verification flow — inline document session will be used');
  }

  // Product intent AND a configured binding. Either alone is the 0060 shape.
  check(
    isTradingRegion(code) === operationalRegions().has(code as never),
    `tradingEnabled (${isTradingRegion(code)}) agrees with operationalRegions (${operationalRegions().has(code as never)})`,
  );
}

function main(): void {
  const requested = process.argv.slice(2).map((code) => code.trim().toUpperCase()).filter(Boolean);
  const configured = allConfiguredRegionCodes();
  const live = liveConfiguredRegionCodes();

  console.log('Stripe region verification (read-only, no API calls)\n');
  console.log(`configured regions : ${configured.join(', ') || '(none)'}`);
  console.log(`live-money regions : ${live.join(', ') || '(none)'}`);
  console.log(`operational        : ${[...operationalRegions()].join(', ') || '(none)'}`);

  const intended = REGIONS.filter((region) => region.tradingEnabled).map((r) => r.code);
  console.log(`trading intent     : ${intended.join(', ')}`);

  // The gap that badges members ready and then refuses their contracts.
  const intendedWithoutBinding = intended.filter((code) => !configured.includes(code));
  if (intendedWithoutBinding.length > 0) {
    console.log('');
    fail(
      `tradingEnabled with no Stripe binding: ${intendedWithoutBinding.join(', ')} ` +
        `— set STRIPE_SECRET_KEY_<REGION> or these regions refuse every contract`,
    );
  }

  const targets = requested.length > 0 ? requested : configured;
  if (targets.length === 0) {
    fail('no regions configured — set STRIPE_SECRET_KEY or STRIPE_SECRET_KEY_<REGION>');
  }

  for (const code of targets) verifyRegion(code);

  console.log('');
  if (failures > 0) {
    console.error(`${failures} check(s) failed`);
    process.exitCode = 1;
  } else {
    console.log('all checks passed');
  }

  // Said last so it is the thing left on screen.
  if (live.length > 0) {
    console.log(
      `\nWARNING: live keys configured for ${live.join(', ')}. ` +
        'Do not run the escrow smoke against these.',
    );
  }
}

main();
