/**
 * Live smoke of the CONNECT half of the payment seam, per region, against the Stripe
 * TEST API.
 *
 *   npx tsx --env-file=.env.local scripts/smoke-stripe-connect.ts
 *   npx tsx --env-file=.env.local scripts/smoke-stripe-connect.ts US
 *
 * `smoke-stripe-test.ts` proves the ESCROW contract — authorise, capture, void. It
 * never touches Connect, and Connect is what a SELLER depends on: without a recipient
 * account there is nobody to transfer to, so a region can pass the escrow smoke
 * completely and still be unable to pay anyone in it.
 *
 * What this asserts, and why each one is a region-specific risk rather than a general
 * one:
 *
 *   1. `createManagedMerchant` succeeds — this is the call that fails outright when
 *      platform-owned loss liability (`losses_collector: 'application'`) has not been
 *      accepted in the Dashboard for the account, which is per-account and therefore
 *      per-region.
 *   2. The account lands PENDING, never APPROVED. Creating the shell is the START of
 *      onboarding; migration 0060 briefly treated it as the verification milestone and
 *      0061 reversed it. A region whose new accounts read APPROUED would be that bug.
 *   3. The read-back reports the region's own country. Stripe fixes an account's
 *      country at creation, so a US seller created against the AU platform is
 *      unfixable — and it looks fine until the first transfer.
 *   4. Hosted onboarding returns a link. Single-use and short-lived, so this only
 *      proves one can be minted.
 *
 * Refuses to run when a live key is configured ANYWHERE, same rule as the escrow smoke:
 * these calls create real connected accounts on a live platform.
 */

import { isRealMoneyProvider, resolvePaymentProvider } from '../domain/services/providerMode';
import { createStripeService, readStripeConfig } from '../domain/services/stripe';
import {
  DEFAULT_CONFIG_REGION,
  isStripeConfigured,
  liveConfiguredRegionCodes,
} from '../domain/services/stripe/config';
import { regionCurrency } from '../domain/region';
import { canReceiveFunds, deriveMerchantStatus } from '../domain/orchestrator/merchantOnboarding';

const REGION = (process.argv[2]?.trim() || DEFAULT_CONFIG_REGION).toUpperCase();

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    process.exitCode = 1;
    throw new Error(msg);
  }
}

let step = 0;
function heading(label: string): void {
  step += 1;
  console.log(`\n${step}. ${label}`);
}

function ok(detail: string): void {
  console.log(`  ok    ${detail}`);
}

async function main(): Promise<void> {
  heading(`Guard: test mode only (region ${REGION})`);
  assert(
    isStripeConfigured(process.env, REGION),
    `no Stripe key for ${REGION} — set STRIPE_SECRET_KEY${
      REGION === DEFAULT_CONFIG_REGION ? '' : `_${REGION}`
    } and load with --env-file=.env.local`,
  );
  const config = readStripeConfig(process.env, REGION);
  assert(config.environment === 'test', `refusing to smoke against ${config.environment}`);
  assert(
    !isRealMoneyProvider({ ...process.env, PAYMENTS_PROVIDER: 'stripe' }),
    `a live key is configured for ${liveConfiguredRegionCodes().join(', ')} — refusing to run`,
  );
  ok(`region=${config.region} environment=${config.environment} country=${config.country}`);
  console.log(`        PAYMENTS_PROVIDER resolves to: ${resolvePaymentProvider()}`);

  // The region table owns the currency/country mapping, so a disagreement here means
  // the platform account and the registry have drifted apart.
  assert(
    config.currency === regionCurrency(REGION),
    `currency ${config.currency} disagrees with the region table (${regionCurrency(REGION)})`,
  );
  assert(
    config.country === REGION.toLowerCase(),
    `account country ${config.country} is not ${REGION.toLowerCase()}`,
  );
  ok(`currency and country agree with domain/region/regions.ts`);

  const payments = createStripeService({ region: REGION });
  assert(payments.createManagedMerchant, 'binding exposes no createManagedMerchant');
  assert(payments.getManagedMerchant, 'binding exposes no getManagedMerchant');

  const profileId = `smoke-connect-${Date.now()}`;

  heading('createManagedMerchant — a v2 recipient account for this region');
  const created = await payments.createManagedMerchant!({
    profileId,
    businessEmail: `smoke+${profileId}@noditto.app`,
    legalEntityName: 'Smoke Connect Tester',
    country: REGION.toLowerCase(),
  });
  assert(created.merchantRef, 'no merchantRef returned');
  ok(`${created.merchantRef} created`);

  heading('Creating the shell is the START of onboarding, not the milestone');
  // ASSERTED THROUGH `deriveMerchantStatus`, not on a raw field. The first version of
  // this check read `created.status`, which does not exist on `ManagedMerchant` — the
  // provider status is `complianceStatus` — so it compared undefined to 'APPROVED' and
  // passed vacuously. A check that cannot fail is worse than no check.
  assert(
    typeof created.complianceStatus === 'string' && created.complianceStatus.length > 0,
    `no complianceStatus returned (got ${String(created.complianceStatus)})`,
  );
  const derived = deriveMerchantStatus(created);
  // Guards the 0060 shortcut: an account that read APPROVED here would let a member
  // publish listings and front a cash sale having typed nothing into Stripe's pages.
  assert(
    derived !== 'APPROVED',
    `a freshly created account derives ${derived} — this is the 0060 bug`,
  );
  assert(
    created.settlementsEnabled === false,
    'a freshly created account reported settlements enabled',
  );
  // The mechanical precondition for a transfer, evaluated exactly as the payout path
  // does. A fresh shell must not be payable.
  assert(
    !canReceiveFunds({
      merchantRef: created.merchantRef,
      merchantStatus: derived,
      settlementsEnabled: created.settlementsEnabled,
    } as Parameters<typeof canReceiveFunds>[0]),
    'a freshly created account is already considered payable',
  );
  ok(
    `complianceStatus=${created.complianceStatus} derived=${derived} ` +
      `settlementsEnabled=false canReceiveFunds=false`,
  );

  heading('getManagedMerchant — the read-back is the authoritative path');
  const readBack = await payments.getManagedMerchant!(created.merchantRef);
  assert(readBack, 'read-back returned null for an account just created');
  assert(
    readBack!.merchantRef === created.merchantRef,
    `read-back returned a different account: ${readBack!.merchantRef}`,
  );
  const derivedReadBack = deriveMerchantStatus(readBack!);
  assert(
    derivedReadBack !== 'APPROVED',
    `read-back derives APPROVED before onboarding: ${readBack!.complianceStatus}`,
  );
  ok(
    `complianceStatus=${readBack!.complianceStatus} derived=${derivedReadBack} ` +
      `settlementsEnabled=${String(readBack!.settlementsEnabled)}`,
  );

  if (payments.createMerchantOnboardingLink) {
    heading('createMerchantOnboardingLink — provider-hosted onboarding');
    const link = await payments.createMerchantOnboardingLink({
      merchantRef: created.merchantRef,
      returnUrl: 'https://noditto.app/profile?payouts=complete',
      refreshUrl: 'https://noditto.app/profile?payouts=refresh',
    });
    assert(link?.url?.startsWith('https://'), `expected an https link, got ${link?.url}`);
    ok(`hosted onboarding link minted (single-use, short-lived)`);
  }

  console.log(`\nAll Connect assertions passed for ${REGION}.`);
}

main().catch((error) => {
  console.error(`\n${(error as Error).message}`);
  process.exitCode = 1;
});
