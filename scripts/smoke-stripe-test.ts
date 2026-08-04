/**
 * Live smoke against the Stripe TEST API using credentials from `.env.local`.
 *
 *   npx tsx --env-file=.env.local scripts/smoke-stripe-test.ts
 *
 * Proves the escrow contract on the real API, which is the whole reason for
 * moving off Pinch. Pinch had no authorize/void/partial-capture primitives, so
 * `placeHold` genuinely charged the collateral and `voidHold` refunded it. Each
 * assertion below checks that Stripe does the honest thing instead:
 *
 *   1. placeHold      -> authorised, NO funds captured, and it reports an expiry
 *   2. partialCapture -> takes exactly the Friction_Tax and Stripe releases the
 *                        remainder by itself (no compensating refund)
 *   3. voidHold       -> cancels at $0
 *   4. fullCapture    -> takes the whole authorisation
 *
 * Refuses to run against a live key.
 */

import { isRealMoneyProvider, resolvePaymentProvider } from '../domain/services/providerMode';
import { createStripeClient, createStripeService, readStripeConfig } from '../domain/services/stripe';

const FMV_CENTS = 50_000; // $500.00 collateral
const FRICTION_TAX_CENTS = 2_000; // $20.00 fixed friction tax (Req 7.2)

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

function aud(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

async function main(): Promise<void> {
  heading('Guard: test mode only');
  assert(process.env.STRIPE_SECRET_KEY, 'STRIPE_SECRET_KEY missing — load with --env-file=.env.local');
  const config = readStripeConfig();
  assert(config.environment === 'test', `refusing to smoke against ${config.environment}`);
  assert(!isRealMoneyProvider({ ...process.env, PAYMENTS_PROVIDER: 'stripe' }), 'key moves real money');
  ok(`environment=${config.environment} currency=${config.currency}`);
  console.log(`        PAYMENTS_PROVIDER resolves to: ${resolvePaymentProvider()}`);

  const stripe = createStripeClient(config);
  const payments = createStripeService();

  heading('createPayer — a platform Customer, not a per-merchant payer');
  const profileId = `smoke-${Date.now()}`;
  const payer = await payments.createPayer(profileId, {
    displayName: 'Smoke Tester',
    email: `smoke+${profileId}@noditto.app`,
  });
  assert(payer.payerId.startsWith('cus_'), `expected cus_..., got ${payer.payerId}`);
  ok(`${payer.payerId} for profile ${profileId}`);

  heading('attachPaymentSource — vault a reusable PaymentMethod');
  const attached = await payments.attachPaymentSource!({
    payerId: payer.payerId,
    token: 'pm_card_visa',
    sourceType: 'credit-card',
  });
  assert(attached.sourceId.startsWith('pm_'), `expected pm_..., got ${attached.sourceId}`);
  ok(`${attached.sourceId} vaulted and set as default`);

  heading(`placeHold(${aud(FMV_CENTS)}) — authorise WITHOUT moving funds`);
  const hold = await payments.placeHold({
    payerId: payer.payerId,
    amount: FMV_CENTS,
    ref: `hold:${profileId}:trader-1`,
  });
  assert(hold.status === 'ACTIVE', `expected ACTIVE, got ${hold.status}`);
  assert(hold.holdId.startsWith('pi_'), `expected pi_..., got ${hold.holdId}`);
  assert(hold.amount === FMV_CENTS, `expected ${FMV_CENTS} capturable, got ${hold.amount}`);
  ok(`${hold.holdId} ACTIVE, ${aud(hold.amount)} capturable`);

  // The critical difference from the Pinch binding: nothing has been collected.
  const authorised = await stripe.paymentIntents.retrieve(hold.holdId);
  assert(authorised.status === 'requires_capture', `expected requires_capture, got ${authorised.status}`);
  assert(authorised.amount_received === 0, `funds moved! amount_received=${authorised.amount_received}`);
  ok(`status=requires_capture, amount_received=${aud(authorised.amount_received)} (no funds moved)`);

  assert(hold.expiresAt, 'expected expiresAt from the charge capture_before');
  const daysLeft = (Date.parse(hold.expiresAt!) - Date.now()) / 86_400_000;
  ok(`expiresAt=${hold.expiresAt} (~${daysLeft.toFixed(1)} days — the 7-day auth ceiling)`);

  heading(`partialCapture(${aud(FRICTION_TAX_CENTS)}) — Friction_Tax, remainder auto-released`);
  const capture = await payments.partialCapture({
    holdId: hold.holdId,
    amount: FRICTION_TAX_CENTS,
  });
  assert(capture.status === 'SETTLED', `expected SETTLED, got ${capture.status}`);
  assert(capture.amount === FRICTION_TAX_CENTS, `expected ${FRICTION_TAX_CENTS}, got ${capture.amount}`);
  ok(`captured exactly ${aud(capture.amount)} (capture id ${capture.captureId})`);

  const settled = await stripe.paymentIntents.retrieve(hold.holdId);
  assert(settled.status === 'succeeded', `expected succeeded, got ${settled.status}`);
  assert(settled.amount_received === FRICTION_TAX_CENTS, `amount_received=${settled.amount_received}`);
  assert(settled.amount_capturable === 0, `remainder still held: ${settled.amount_capturable}`);
  ok(
    `remainder ${aud(FMV_CENTS - FRICTION_TAX_CENTS)} released by Stripe with no refund call ` +
      `(amount_capturable=0)`,
  );

  heading('voidHold — release a second hold at $0');
  const toVoid = await payments.placeHold({
    payerId: payer.payerId,
    amount: FMV_CENTS,
    ref: `hold:${profileId}-void:trader-2`,
  });
  assert(toVoid.status === 'ACTIVE', `expected ACTIVE, got ${toVoid.status}`);
  const voided = await payments.voidHold(toVoid.holdId);
  assert(voided.status === 'VOIDED', `expected VOIDED, got ${voided.status}`);
  const cancelled = await stripe.paymentIntents.retrieve(toVoid.holdId);
  assert(cancelled.amount_received === 0, `funds moved on a void: ${cancelled.amount_received}`);
  ok(`${toVoid.holdId} canceled, nothing collected`);

  heading('fullCapture — Objective_Fraud takes the whole authorisation');
  const toCapture = await payments.placeHold({
    payerId: payer.payerId,
    amount: FMV_CENTS,
    ref: `hold:${profileId}-fraud:trader-3`,
  });
  assert(toCapture.status === 'ACTIVE', `expected ACTIVE, got ${toCapture.status}`);
  const full = await payments.fullCapture(toCapture.holdId);
  assert(full.status === 'SETTLED', `expected SETTLED, got ${full.status}`);
  assert(full.amount === FMV_CENTS, `expected ${FMV_CENTS}, got ${full.amount}`);
  ok(`captured ${aud(full.amount)} in full`);

  heading('placeHold with no vaulted method — must report FAILED, not throw');
  const bare = await payments.createPayer(`${profileId}-bare`, {
    displayName: 'No Card',
    email: `smoke+${profileId}-bare@noditto.app`,
  });
  const failed = await payments.placeHold({
    payerId: bare.payerId,
    amount: FMV_CENTS,
    ref: `hold:${profileId}-bare:trader-4`,
  });
  assert(failed.status === 'FAILED', `expected FAILED, got ${failed.status}`);
  ok('FAILED returned as a value, so the HOLDS_FAILED path (Req 5.6) can compensate');

  console.log('\nAll Stripe escrow assertions passed.');
}

main().catch((err) => {
  console.error(`\nSmoke failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
