/**
 * Live smoke against Pinch TEST API using credentials from `.env.local`.
 *
 *   npx tsx --env-file=.env.local scripts/smoke-pinch-test.ts
 *
 * Covers OAuth, merchant confirmation, payer create, mock KYC against a real
 * payer, then (if CaptureJS tokenisation works from Node) source + charge +
 * refund. Card tokenisation is browser-scoped; when it cannot run here we
 * still prove the server Pinch binding is live.
 */

import {
  getPaymentService,
  isLivePaymentsProvider,
} from '../domain/services/index';
import { PinchClient, readPinchConfig, readPinchPublishableKey } from '../domain/services/pinch';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function step(name: string) {
  process.stdout.write(`\n→ ${name} ... `);
}

function ok(detail = '') {
  console.log(`OK${detail ? ` (${detail})` : ''}`);
}

async function tryTokeniseViaCaptureHosts(publishableKey: string): Promise<string | null> {
  const expiryYear = String(new Date().getFullYear() + 2);
  const payloads = [
    {
      publishableKey,
      sourceType: 'credit-card',
      cardNumber: '4242424242424242',
      expiryMonth: '12',
      expiryYear,
      cvc: '123',
      cardHolderName: 'CardTrade Smoke',
    },
    // Some Capture hosts expect nested / alternate field names.
    {
      key: publishableKey,
      sourceType: 'credit-card',
      number: '4242424242424242',
      exp_month: '12',
      exp_year: expiryYear,
      cvc: '123',
      name: 'CardTrade Smoke',
    },
  ];

  const urls = [
    'https://api.getpinch.com.au/test/tokens',
    'https://api.getpinch.com.au/tokens',
    'https://capture.getpinch.com.au/v1/tokens',
    'https://capture.getpinch.com.au/tokens',
  ];

  for (const url of urls) {
    for (const body of payloads) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            'pinch-version': '2020.1',
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) continue;
        const json = (await res.json()) as { token?: string; id?: string };
        if (json.token || json.id) return json.token ?? json.id ?? null;
      } catch {
        // try next
      }
    }
  }
  return null;
}

async function main() {
  assert(process.env.PINCH_DEV_ID, 'PINCH_DEV_ID missing — load with --env-file=.env.local');
  assert(process.env.PINCH_DEV_SECRET, 'PINCH_DEV_SECRET missing');
  assert(process.env.PINCH_ENV !== 'live', 'Refusing to smoke against live');

  console.log('Pinch live smoke (TEST mode)');
  console.log(`PAYMENTS_PROVIDER=${process.env.PAYMENTS_PROVIDER}`);
  console.log(`PINCH_ENV=${process.env.PINCH_ENV}`);
  console.log(`PINCH_KYC_MODE=${process.env.PINCH_KYC_MODE ?? '(default mock)'}`);

  step('isLivePaymentsProvider');
  assert(isLivePaymentsProvider(), 'expected Pinch credentials to activate live provider');
  ok();

  step('getPaymentService() → Pinch');
  const payments = getPaymentService();
  ok(payments.constructor.name);

  const config = readPinchConfig();
  assert(config.environment === 'test', `expected test env, got ${config.environment}`);
  const client = new PinchClient({ config });

  step('OAuth + GET /merchants');
  // Authenticated merchant is a single object (not a list).
  const merchant = await client.request<{ id?: string; companyName?: string; testPublishableKey?: string }>(
    'GET',
    '/merchants',
  );
  assert(merchant?.id, 'GET /merchants returned no merchant id');
  ok(`${merchant.id} · ${merchant.companyName ?? 'unnamed'}`);

  step('Confirm PINCH_MERCHANT_ID');
  const merchantId = process.env.PINCH_MERCHANT_ID;
  if (merchantId) {
    assert(merchant.id === merchantId, `expected ${merchantId}, got ${merchant.id}`);
    ok(merchantId);
  } else {
    ok('skipped');
  }

  step('Publishable key matches portal');
  const publishableFromEnv = readPinchPublishableKey();
  if (merchant.testPublishableKey && publishableFromEnv) {
    assert(
      merchant.testPublishableKey === publishableFromEnv,
      'PINCH_TEST_PUBLISHABLE_KEY does not match GET /merchants.testPublishableKey',
    );
    ok('match');
  } else {
    ok('skipped');
  }

  const profileId = `smoke_${Date.now()}`;
  const email = `smoke+${Date.now()}@cardtrade.test`;

  step('createPayer');
  const payer = await payments.createPayer(profileId, {
    displayName: 'CardTrade Smoke',
    email,
  });
  assert(payer.payerId, 'missing payer id');
  ok(payer.payerId);

  step('GET /payers/{id}');
  const fetched = await client.request<{ id?: string }>('GET', `/payers/${payer.payerId}`);
  assert(fetched?.id === payer.payerId, 'payer round-trip failed');
  ok();

  step('runVerification (mock KYC, real payer)');
  const kyc = await payments.runVerification(payer.payerId);
  assert(['VERIFIED', 'PENDING', 'REJECTED'].includes(kyc.outcome), `unexpected ${kyc.outcome}`);
  ok(kyc.outcome);

  step('Publishable key present for CaptureJS');
  const publishable = readPinchPublishableKey();
  assert(publishable?.startsWith('pk_test_'), `expected pk_test_…, got ${publishable ?? 'null'}`);
  ok(`${publishable.slice(0, 12)}…`);

  step('Tokenise test card (server probe)');
  const token = await tryTokeniseViaCaptureHosts(publishable);
  if (!token) {
    console.log('SKIP — CaptureJS is browser-only; no public token REST from Node');
    console.log('\nServer Pinch binding works: OAuth, merchants, payers, KYC delegate.');
    console.log('Add a card in the UI (4242…) to exercise charge + refund end-to-end.');
    return;
  }
  ok('token acquired');

  step('attachPaymentSource');
  const source = await payments.attachPaymentSource!({
    payerId: payer.payerId,
    token,
    sourceType: 'credit-card',
  });
  ok(source.sourceId);

  step('placeHold $1.00 (realtime charge)');
  const hold = await payments.placeHold({
    payerId: payer.payerId,
    amount: 100,
    ref: `smoke-hold:${profileId}`,
  });
  assert(hold.status === 'ACTIVE', `hold status ${hold.status}`);
  ok(hold.holdId);

  step('voidHold (full refund)');
  const voided = await payments.voidHold(hold.holdId);
  assert(voided.status === 'VOIDED', `void status ${voided.status}`);
  ok();

  console.log('\nAll Pinch smoke checks passed.');
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('\nFAIL', message);
  process.exit(1);
});
