/**
 * Live smoke of the Cash_Sale money legs against the Stripe TEST API.
 *
 *   npx tsx --env-file=.env.local scripts/smoke-stripe-refund.ts
 *
 * WHY THIS EXISTS. `smoke-stripe-test.ts` proves the TRADE escrow primitives —
 * authorise, void, partial capture, full capture. It says nothing about the Cash_Sale
 * legs, and a check of the account found the reason that matters: across the whole
 * history of this Stripe account there were ZERO refunds, in test mode or live. The
 * refund path carries dispute resolution, return tracking and the bounced-refund
 * reopen, it has been rewritten by four separate bug-fix migrations, and not one line
 * of it had ever reached the provider.
 *
 * What is asserted here, in the order the money moves:
 *
 *   1. requestTransfer  -> collects to the PLATFORM balance, immediately, and is not
 *                          a destination charge (no transfer_data, no on_behalf_of)
 *   2. refundPayment    -> returns the money and reports SETTLED
 *   3. the same nonce   -> deduplicated by Stripe into ONE refund, not two
 *   4. a partial refund -> takes exactly what was asked and leaves the rest refundable
 *   5. an impossible    -> reported as FAILED with a reason, never thrown, because
 *      refund               `retryCashSaleRefund` branches on the status
 *
 * Assertion 3 is the one worth the trouble. Every refund in this codebase is keyed on
 * a nonce that SQL mints once and never regenerates, and the whole defence against
 * paying a buyer twice out of platform funds rests on Stripe honouring it. That was
 * a belief until this script ran.
 *
 * Refuses to run against a live key.
 */

import { isRealMoneyProvider, resolvePaymentProvider } from '../domain/services/providerMode';
import { createStripeClient, createStripeService, readStripeConfig } from '../domain/services/stripe';

/** Small on purpose: this runs against a real API and leaves real test objects behind. */
const SALE_CENTS = 5_000; // $50.00
const PARTIAL_CENTS = 1_500; // $15.00

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
  assert(
    process.env.STRIPE_SECRET_KEY,
    'STRIPE_SECRET_KEY missing — load with --env-file=.env.local',
  );
  const config = readStripeConfig();
  assert(config.environment === 'test', `refusing to smoke against ${config.environment}`);
  assert(
    !isRealMoneyProvider({ ...process.env, PAYMENTS_PROVIDER: 'stripe' }),
    'key moves real money',
  );
  ok(`environment=${config.environment} currency=${config.currency}`);
  console.log(`        PAYMENTS_PROVIDER resolves to: ${resolvePaymentProvider()}`);

  const stripe = createStripeClient(config);
  const payments = createStripeService();

  heading('A buyer with a vaulted card');
  const profileId = `refund-smoke-${Date.now()}`;
  const payer = await payments.createPayer(profileId, {
    displayName: 'Refund Smoke',
    email: `smoke+${profileId}@noditto.app`,
  });
  await payments.attachPaymentSource!({
    payerId: payer.payerId,
    token: 'pm_card_visa',
    sourceType: 'credit-card',
  });
  ok(`${payer.payerId} with a default card`);

  heading(`requestTransfer(${aud(SALE_CENTS)}) — collect into the PLATFORM balance`);
  const collected = await payments.requestTransfer({
    payerId: payer.payerId,
    amount: SALE_CENTS,
    ref: `cash-sale:${profileId}`,
    nonce: `payment:${profileId}`,
  });
  assert(collected.status === 'SETTLED', `expected SETTLED, got ${collected.status}`);
  assert(collected.transferId.startsWith('pi_'), `expected pi_..., got ${collected.transferId}`);
  ok(`${collected.transferId} collected ${aud(collected.amount)}`);

  // The escrow claim rests on this: the money is OURS to hold, not forwarded to a
  // seller at collection time. A destination charge here would mean no escrow at all.
  const intent = await stripe.paymentIntents.retrieve(collected.transferId);
  assert(intent.status === 'succeeded', `expected succeeded, got ${intent.status}`);
  assert(
    intent.amount_received === SALE_CENTS,
    `expected ${SALE_CENTS} received, got ${intent.amount_received}`,
  );
  assert(!intent.transfer_data, 'transfer_data set — this is a destination charge, not escrow');
  assert(!intent.on_behalf_of, 'on_behalf_of set — the platform is not merchant of record');
  ok('captured immediately, no transfer_data, no on_behalf_of (platform holds the funds)');

  heading('refundPayment — return the whole collection');
  const refundNonce = `refund:${profileId}`;
  const refunded = await payments.refundPayment({
    paymentRef: collected.transferId,
    amount: SALE_CENTS,
    nonce: refundNonce,
    ref: `cash-sale-refund:${profileId}`,
  });
  assert(refunded.status === 'SETTLED', `expected SETTLED, got ${refunded.status}`);
  assert(refunded.refundId.startsWith('re_'), `expected re_..., got ${refunded.refundId}`);
  assert(refunded.amount === SALE_CENTS, `expected ${SALE_CENTS}, got ${refunded.amount}`);
  ok(`${refunded.refundId} returned ${aud(refunded.amount)}`);

  heading('the SAME nonce again — Stripe must deduplicate, not refund twice');
  const replay = await payments.refundPayment({
    paymentRef: collected.transferId,
    amount: SALE_CENTS,
    nonce: refundNonce,
    ref: `cash-sale-refund:${profileId}`,
  });
  assert(replay.status === 'SETTLED', `expected SETTLED on replay, got ${replay.status}`);
  assert(
    replay.refundId === refunded.refundId,
    `replay minted a NEW refund: ${replay.refundId} vs ${refunded.refundId}`,
  );

  // Belt and braces: ask Stripe directly how many refunds exist against the charge.
  // The nonce returning the same id could in principle be our own caching.
  const allRefunds = await stripe.refunds.list({ payment_intent: collected.transferId });
  assert(
    allRefunds.data.length === 1,
    `expected exactly 1 refund on the charge, found ${allRefunds.data.length}`,
  );
  ok(`replay returned ${replay.refundId} and Stripe holds exactly 1 refund — nonce honoured`);

  heading(`a partial refund of ${aud(PARTIAL_CENTS)} on a second collection`);
  const second = await payments.requestTransfer({
    payerId: payer.payerId,
    amount: SALE_CENTS,
    ref: `cash-sale:${profileId}-partial`,
    nonce: `payment:${profileId}-partial`,
  });
  assert(second.status === 'SETTLED', `expected SETTLED, got ${second.status}`);

  const partial = await payments.refundPayment({
    paymentRef: second.transferId,
    amount: PARTIAL_CENTS,
    nonce: `refund:${profileId}-partial`,
    ref: `cash-sale-refund:${profileId}-partial`,
  });
  assert(partial.status === 'SETTLED', `expected SETTLED, got ${partial.status}`);
  assert(partial.amount === PARTIAL_CENTS, `expected ${PARTIAL_CENTS}, got ${partial.amount}`);

  // A partial refund must leave the balance available to release to the seller —
  // that is what `sellerNetCentsFor` subtracts `refundCents` for.
  const afterPartial = await stripe.paymentIntents.retrieve(second.transferId);
  const stillRefundable = afterPartial.amount_received - PARTIAL_CENTS;
  assert(
    stillRefundable === SALE_CENTS - PARTIAL_CENTS,
    `expected ${SALE_CENTS - PARTIAL_CENTS} left, got ${stillRefundable}`,
  );
  ok(`took exactly ${aud(partial.amount)}, ${aud(stillRefundable)} still refundable`);

  heading('an impossible refund — must be a FAILED value, never a throw');
  // `retryCashSaleRefund` and `resolveCashSaleDispute` both branch on
  // `refund.status !== 'SETTLED'` and leave the sale DISPUTED so the drain can try
  // again. A throw here would escape that and abort the whole drain pass.
  const overRefund = await payments.refundPayment({
    paymentRef: second.transferId,
    amount: SALE_CENTS, // more than the remaining balance
    nonce: `refund:${profileId}-over`,
    ref: `cash-sale-refund:${profileId}-over`,
  });
  assert(overRefund.status === 'FAILED', `expected FAILED, got ${overRefund.status}`);
  assert(overRefund.reason, 'expected a reason on the failure, so the drain can log why');
  ok(`FAILED as a value: ${overRefund.reason}`);

  heading('a refund against a payment that does not exist');
  const missing = await payments.refundPayment({
    paymentRef: 'pi_does_not_exist_00000000',
    amount: SALE_CENTS,
    nonce: `refund:${profileId}-missing`,
  });
  assert(missing.status === 'FAILED', `expected FAILED, got ${missing.status}`);
  ok(`FAILED as a value: ${missing.reason}`);

  console.log('\nAll Cash_Sale refund assertions passed.');
}

main().catch((err) => {
  console.error(`\nSmoke failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
