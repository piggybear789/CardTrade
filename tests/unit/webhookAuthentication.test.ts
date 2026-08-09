// tests/unit/webhookAuthentication.test.ts
//
// The webhook pipeline's front door (Req 10.1, 10.2, 10.3, 10.5).
//
// WHY THIS GAP WAS THE WORST-PLACED ONE IN THE SUITE. Stripe event TRANSLATION is tested
// (`stripeWebhook.test.ts`) and event MAPPING is tested (`mapEventToAction`), but the thing
// that wires them together and decides whether a delivery is authentic at all was tested by
// nothing. That function is how money enters the system: it runs with the service-role
// client, on a route with no session, and it writes to `trades`, `cash_sales` and
// `webhook_logs` on the provider's behalf.
//
// The properties asserted here are the security model, stated in the module's own header:
//
//   * The HMAC check runs BEFORE any state change or log write. An unauthenticated caller
//     must not even be able to fill the audit table with noise.
//   * A mock-signed envelope is refused whenever a real provider is active, so a demo
//     button can never advance a real money flow.
//   * An authentic delivery is ALWAYS acked with 200 — the recorded outcome distinguishes
//     SUCCESS from NO_OP — because a non-2xx makes the provider retry a delivery that was
//     handled correctly.
//
// Only the mock signing path is exercised. The Stripe branch delegates verification to the
// SDK, which is not ours to re-test; what is ours is the branching, the ordering and the
// response codes.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MOCK_SIGNATURE_HEADER,
  signWebhookBody,
} from '@/domain/services/mock/MockService';
import { createFakeAdmin, type FakeAdmin } from './fakes/supabaseChain';

/** Matches the module's fallback when `WEBHOOK_SECRET` is unset. */
const SECRET = 'dev-mock-webhook-secret';

let admin: FakeAdmin;
let liveProvider = false;

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => admin.client,
}));

vi.mock('@/domain/services', () => ({
  isLivePaymentsProvider: () => liveProvider,
  getPaymentService: () => ({}),
}));

vi.mock('@/lib/regionBinding', () => ({
  regionForCashSale: async () => 'AU',
  regionForMerchantRef: async () => 'AU',
  regionForTrade: async () => 'AU',
}));

// The Stripe branch is steered around entirely: no `stripe-signature` header is sent, so
// none of these run. They are stubbed so importing the pipeline does not require Stripe
// credentials to be configured.
vi.mock('@/domain/services/stripe', () => ({
  createStripeClient: () => ({}),
  readWebhookSecrets: () => [],
  STRIPE_SIGNATURE_HEADER: 'stripe-signature',
  translateStripeEvent: () => [],
  verifyStripeSignature: () => null,
}));

// Dispatch targets. Nothing in this file drives a real transition; stubbing them keeps the
// test about authentication rather than about the orchestrators.
vi.mock('@/domain/orchestrator/supabaseTradeRepository', () => ({
  createDefaultTradeOrchestrator: () => ({ applyEvent: async () => ({ ok: false }) }),
}));
vi.mock('@/domain/orchestrator/supabaseTradeProposalRepository', () => ({
  createSupabaseCollateralSideEffects: () => ({}),
}));
vi.mock('@/domain/orchestrator/supabaseCashSaleRepository', () => ({
  createDefaultCashSaleOrchestrator: () => ({}),
}));
vi.mock('@/domain/orchestrator/supabaseMerchantRepository', () => ({
  createDefaultMerchantOnboardingOrchestrator: () => ({}),
}));

const { handleWebhookDelivery } = await import('@/lib/webhook/webhookPipeline');

/** A provider-shaped envelope the pipeline will parse but not act on. */
function envelope(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    eventId: 'evt_probe_1',
    type: 'SOMETHING_WE_DO_NOT_HANDLE',
    payload: {},
    ...overrides,
  });
}

function headersWith(signature: string | null): Headers {
  const headers = new Headers();
  if (signature !== null) headers.set(MOCK_SIGNATURE_HEADER, signature);
  return headers;
}

/** Writes to the audit table, which must stay empty for anything unauthenticated. */
function logWrites(recorded: FakeAdmin) {
  return recorded.writes.filter((write) => write.table === 'webhook_logs');
}

beforeEach(() => {
  liveProvider = false;
  // `webhook_logs` is read by the dedupe step and written by the log step.
  admin = createFakeAdmin({ defaults: { webhook_logs: { data: null } } });
});

describe('handleWebhookDelivery — authenticity', () => {
  it('rejects a delivery with no signature, and logs nothing', async () => {
    const response = await handleWebhookDelivery(envelope(), headersWith(null));

    expect(response.status).toBe(401);
    // Req 10.2: no side effect AND no success log. An attacker who can write to the audit
    // trail can bury the delivery that mattered.
    expect(logWrites(admin)).toEqual([]);
  });

  it('rejects a delivery whose signature does not match the body', async () => {
    const body = envelope();
    const response = await handleWebhookDelivery(body, headersWith('sha256=deadbeef'));

    expect(response.status).toBe(401);
    expect(logWrites(admin)).toEqual([]);
  });

  it('rejects a signature computed over a DIFFERENT body', async () => {
    // The HMAC has to cover the exact bytes acted on. Verifying a signature against
    // anything else would let a valid signature be replayed over altered content — the
    // amount, the trade id, the outcome.
    const signedOther = signWebhookBody(envelope({ eventId: 'evt_other' }), SECRET);
    const response = await handleWebhookDelivery(envelope(), headersWith(signedOther));

    expect(response.status).toBe(401);
    expect(logWrites(admin)).toEqual([]);
  });

  it('refuses a mock-signed envelope while a real provider is active', async () => {
    liveProvider = true;
    const body = envelope();
    const response = await handleWebhookDelivery(body, headersWith(signWebhookBody(body, SECRET)));

    // Correctly signed FOR THE MOCK, and still refused: these envelopes skip the real
    // charge path entirely, so accepting one against a live provider would advance a money
    // flow no provider ever confirmed.
    expect(response.status).toBe(401);
    expect(logWrites(admin)).toEqual([]);
  });

  it('rejects a malformed body even when the signature is valid', async () => {
    const body = 'not json at all';
    const response = await handleWebhookDelivery(body, headersWith(signWebhookBody(body, SECRET)));

    // 400 rather than 401: authentic, but unusable. A malformed authentic body has no event
    // id to log against, which is why it is not recorded.
    expect(response.status).toBe(400);
    expect(logWrites(admin)).toEqual([]);
  });

  it('rejects an authentic body that is not an event', async () => {
    const body = JSON.stringify({ nothing: 'useful' });
    const response = await handleWebhookDelivery(body, headersWith(signWebhookBody(body, SECRET)));

    expect(response.status).toBe(400);
  });
});

describe('handleWebhookDelivery — authentic deliveries', () => {
  it('acks an authentic event it does not act on, and records it as NO_OP', async () => {
    const body = envelope();
    const response = await handleWebhookDelivery(body, headersWith(signWebhookBody(body, SECRET)));

    // Req 10.6: authentic deliveries are always acked, or the provider retries work that
    // was already handled correctly.
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { ok: boolean; outcome: string };
    expect(payload.ok).toBe(true);
    expect(payload.outcome).toBe('NO_OP');

    // Req 10.3/10.7: an unroutable event is still recorded, so the audit trail is complete
    // rather than only containing the events that happened to matter.
    expect(logWrites(admin)).toHaveLength(1);
    expect(logWrites(admin)[0]?.payload).toMatchObject({
      event_id: 'evt_probe_1',
      outcome: 'NO_OP',
    });
  });

  it('does not process the same event twice', async () => {
    // Req 10.5. The dedupe read finds a prior SUCCESS, so the second delivery is
    // acknowledged without dispatching or logging again.
    const body = envelope({ eventId: 'evt_repeat', type: 'PAYMENT_AUTHORIZED' });
    admin = createFakeAdmin({
      selects: { webhook_logs: [{ data: { event_id: 'evt_repeat', outcome: 'SUCCESS' } }] },
      defaults: { webhook_logs: { data: null } },
    });

    const response = await handleWebhookDelivery(body, headersWith(signWebhookBody(body, SECRET)));

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { deduped: boolean };
    expect(payload.deduped).toBe(true);
    expect(logWrites(admin)).toEqual([]);
  });
});
