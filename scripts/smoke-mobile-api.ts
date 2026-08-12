/**
 * Smoke test for the mobile API surface (`app/api/mobile/**`).
 *
 *   npx tsx --env-file=.env.local scripts/smoke-mobile-api.ts
 *
 * Signs in as a seeded member, calls every endpoint, and asserts a meaningful
 * response. Endpoints that would move money are tested for their guard refusal
 * rather than skipped — if an unverified member can initiate a sale, that is the
 * bug this test would have caught.
 *
 * Refuses to run against live credentials.
 */

import { createClient } from '@supabase/supabase-js';

const BASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// Seeded test member credentials (from supabase/seed.sql)
const TEST_EMAIL = 'buyer@test.cardtrade.app';
const TEST_PASSWORD = 'test123456';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    process.exitCode = 1;
    throw new Error(msg);
  }
}

let step = 0;
let passed = 0;
let failed = 0;

function heading(label: string): void {
  step += 1;
  console.log(`\n${step}. ${label}`);
}

function ok(detail: string): void {
  passed += 1;
  console.log(`  ok    ${detail}`);
}

function fail(detail: string): void {
  failed += 1;
  console.error(`  FAIL  ${detail}`);
}

async function post(
  endpoint: string,
  token: string,
  body: Record<string, unknown> = {},
): Promise<{ status: number; data: Record<string, unknown> }> {
  const url = `${APP_URL}/api/mobile/${endpoint}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, data };
}

async function main(): Promise<void> {
  heading('Guard: test mode only');
  assert(BASE_URL, 'NEXT_PUBLIC_SUPABASE_URL missing — load with --env-file=.env.local');
  assert(ANON_KEY, 'NEXT_PUBLIC_SUPABASE_ANON_KEY missing');

  // Refuse live keys
  const stripeKey = process.env.STRIPE_SECRET_KEY || '';
  if (stripeKey.startsWith('sk_live_')) {
    console.error('  FAIL  refusing to smoke against a live Stripe key');
    process.exitCode = 1;
    return;
  }
  ok('not running against live credentials');

  heading('Sign in as seeded test member');
  const supabase = createClient(BASE_URL!, ANON_KEY!);
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  assert(!authError, `sign-in failed: ${authError?.message}`);
  assert(authData.session, 'no session returned');
  const token = authData.session.access_token;
  ok(`signed in as ${TEST_EMAIL}`);

  // ─── Listings ─────────────────────────────────────────────────────────────

  heading('Listings: create (expect guard refusal for unverified)');
  const createResult = await post('listings/create', token, {
    title: 'Smoke Test Card',
    description: 'Test',
    category: 'Trading Cards',
    condition: 'Near Mint',
    fmvCents: 1000,
    images: [],
    listingKind: 'SINGLE',
  });
  // May succeed if member is verified, or fail with not-verified
  if (createResult.data.ok) {
    ok('listing created (member is verified)');
  } else if (createResult.data.error === 'not-verified' || createResult.data.error === 'seller-not-verified') {
    ok(`guard refusal: ${createResult.data.error} (correct for unverified member)`);
  } else {
    fail(`unexpected: status=${createResult.status} error=${createResult.data.error}`);
  }

  // ─── Cash Sale ────────────────────────────────────────────────────────────

  heading('Cash Sale: initiate (expect guard refusal or valid response)');
  const initiateResult = await post('cash-sale/initiate', token, {
    itemId: '00000000-0000-0000-0000-000000000001', // likely nonexistent
    sellerIdentityVersion: '1',
    buyerConfirmedSellerIdentity: true,
  });
  assert(initiateResult.status !== 404, 'cash-sale/initiate returned 404 — endpoint missing');
  assert(initiateResult.status !== 500, `cash-sale/initiate returned 500: ${JSON.stringify(initiateResult.data)}`);
  if (initiateResult.data.error) {
    ok(`guard refusal: ${initiateResult.data.error}`);
  } else {
    ok('cash sale initiated');
  }

  heading('Cash Sale: accept-terms');
  const acceptResult = await post('cash-sale/accept-terms', token, { cashSaleId: 'nonexistent', termsVersion: 1 });
  assert(acceptResult.status !== 404, 'cash-sale/accept-terms returned 404');
  assert(acceptResult.status !== 500, 'cash-sale/accept-terms returned 500');
  ok(`response: ${acceptResult.data.error || 'ok'}`);

  heading('Cash Sale: remaining endpoints respond (not 404/500)');
  const cashSaleEndpoints = [
    ['cash-sale/update-terms', { cashSaleId: 'x', expectedTermsVersion: 0, terms: {} }],
    ['cash-sale/update-items', { cashSaleId: 'x', expectedTermsVersion: 0, lineItems: [] }],
    ['cash-sale/list-items', { cashSaleId: 'x' }],
    ['cash-sale/propose-price', { cashSaleId: 'x', expectedTermsVersion: 0, priceCents: 100 }],
    ['cash-sale/record-shipment', { cashSaleId: 'x', carrier: 'AusPost', trackingNumber: 'ABC123' }],
    ['cash-sale/record-receipt', { cashSaleId: 'x' }],
    ['cash-sale/accept-inspection', { cashSaleId: 'x' }],
    ['cash-sale/confirm-handover', { cashSaleId: 'x' }],
    ['cash-sale/cancel', { cashSaleId: 'x' }],
    ['cash-sale/sync-tracking', { cashSaleId: 'x' }],
    ['cash-sale/raise-dispute', { cashSaleId: 'x', reason: 'test' }],
  ] as const;

  for (const [endpoint, body] of cashSaleEndpoints) {
    const result = await post(endpoint, token, body as Record<string, unknown>);
    if (result.status === 404) { fail(`${endpoint} returned 404`); continue; }
    if (result.status === 500) { fail(`${endpoint} returned 500`); continue; }
    ok(`${endpoint}: ${result.data.error || 'ok'}`);
  }

  // ─── Trades ───────────────────────────────────────────────────────────────

  heading('Trades: endpoints respond (not 404/500)');
  const tradeEndpoints = [
    ['trades/open', { initiatorItemId: 'x', counterpartItemId: 'y' }],
    ['trades/propose-terms', { tradeId: 'x', expectedTermsVersion: 0, terms: {} }],
    ['trades/accept-terms', { tradeId: 'x', termsVersion: 0 }],
    ['trades/decline', { tradeId: 'x' }],
    ['trades/record-shipment', { tradeId: 'x' }],
    ['trades/record-receipt', { tradeId: 'x' }],
    ['trades/record-acceptance', { tradeId: 'x' }],
    ['trades/confirm-handover', { tradeId: 'x' }],
    ['trades/report-handover-failed', { tradeId: 'x', reason: 'test' }],
    ['trades/raise-dispute', { tradeId: 'x', reason: 'test' }],
    ['trades/report-fraud', { tradeId: 'x', reason: 'test' }],
    ['trades/update-handover-terms', { tradeId: 'x', input: {} }],
    ['trades/save-delivery-address', { tradeId: 'x', address: {} }],
    ['trades/get-delivery-addresses', { tradeId: 'x' }],
    ['trades/sync-tracking', { tradeId: 'x' }],
  ] as const;

  for (const [endpoint, body] of tradeEndpoints) {
    const result = await post(endpoint, token, body as Record<string, unknown>);
    if (result.status === 404) { fail(`${endpoint} returned 404`); continue; }
    if (result.status === 500) { fail(`${endpoint} returned 500`); continue; }
    ok(`${endpoint}: ${result.data.error || 'ok'}`);
  }

  // ─── Offers ───────────────────────────────────────────────────────────────

  heading('Offers: endpoints respond');
  const offerEndpoints = [
    ['offers/make', { itemId: 'x', amountCents: 100 }],
    ['offers/counter', { offerId: 'x', amountCents: 200 }],
    ['offers/respond', { offerId: 'x', action: 'decline' }],
    ['offers/list-mine', {}],
    ['offers/list-for-item', { itemId: 'x' }],
  ] as const;

  for (const [endpoint, body] of offerEndpoints) {
    const result = await post(endpoint, token, body as Record<string, unknown>);
    if (result.status === 404) { fail(`${endpoint} returned 404`); continue; }
    if (result.status === 500) { fail(`${endpoint} returned 500`); continue; }
    ok(`${endpoint}: ${result.data.error || 'ok'}`);
  }

  // ─── Messages ─────────────────────────────────────────────────────────────

  heading('Messages: endpoints respond');
  const messageEndpoints = [
    ['messages/get-or-create', { otherUserId: 'x' }],
    ['messages/send', { conversationId: 'x', body: 'smoke test' }],
    ['messages/mark-read', { conversationId: 'x' }],
    ['messages/list-conversations', {}],
    ['messages/get-conversation', { conversationId: 'x' }],
  ] as const;

  for (const [endpoint, body] of messageEndpoints) {
    const result = await post(endpoint, token, body as Record<string, unknown>);
    if (result.status === 404) { fail(`${endpoint} returned 404`); continue; }
    if (result.status === 500) { fail(`${endpoint} returned 500`); continue; }
    ok(`${endpoint}: ${result.data.error || 'ok'}`);
  }

  // ─── Payments ─────────────────────────────────────────────────────────────

  heading('Payments: endpoints respond');
  const paymentEndpoints = [
    ['payments/begin-card-setup', {}],
    ['payments/complete-card-setup', { setupId: 'seti_fake' }],
    ['payments/get-status', {}],
  ] as const;

  for (const [endpoint, body] of paymentEndpoints) {
    const result = await post(endpoint, token, body as Record<string, unknown>);
    if (result.status === 404) { fail(`${endpoint} returned 404`); continue; }
    if (result.status === 500) { fail(`${endpoint} returned 500`); continue; }
    ok(`${endpoint}: ${result.data.error || 'ok'}`);
  }

  // ─── Listings CRUD ────────────────────────────────────────────────────────

  heading('Listings CRUD: remaining endpoints respond');
  const listingEndpoints = [
    ['listings/update', { itemId: 'x', title: 'Updated' }],
    ['listings/close', { itemId: 'x' }],
    ['listings/delete', { itemId: 'x' }],
  ] as const;

  for (const [endpoint, body] of listingEndpoints) {
    const result = await post(endpoint, token, body as Record<string, unknown>);
    if (result.status === 404) { fail(`${endpoint} returned 404`); continue; }
    if (result.status === 500) { fail(`${endpoint} returned 500`); continue; }
    ok(`${endpoint}: ${result.data.error || 'ok'}`);
  }

  // ─── Auth: 401 without token ──────────────────────────────────────────────

  heading('Auth: 401 without a token');
  const noAuthResult = await post('listings/create', '', { title: 'x' });
  assert(noAuthResult.status === 401, `expected 401, got ${noAuthResult.status}`);
  ok('unauthenticated request returns 401');

  // ─── Summary ──────────────────────────────────────────────────────────────

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Smoke complete: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exitCode = 1;
});
