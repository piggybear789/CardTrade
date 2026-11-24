// tests/e2e/audit/backend/stripeEvents.ts
//
// SIGNED STRIPE WEBHOOK FIXTURES for events Stripe test mode cannot produce on demand:
// an early fraud warning, and a chargeback opening and closing won or lost.
//
// Requirements:
//   14.7, 14.8  early fraud warning and chargeback outcomes reach the real pipeline
//   26.5        fixtures are signed with a configured `whsec_` secret, test mode only
//   26.6        a fixture verifies with the SDK's `constructEvent` and the same secret
//   4.7         callers wrap every post in `simulated()` (enforced by a source scan)
//
// BUILT FROM REAL TEST OBJECTS. Each fixture names the PaymentIntent and Charge a
// Pathway really created on Stripe test mode, read back through the test-only client
// in `./stripe.ts`. So the pipeline's lookups (the sale by `transfer_id`, the trade
// cash leg by `collection_ref`, the hold by `hold_ref`) hit real rows, and anything the
// pipeline asks Stripe afterwards (the charge's card fingerprint on a lost fraud
// dispute) is answered by a real object. Only the warning or dispute record itself is
// synthesised, unless the Pathway already has a real dispute (test card
// `4000000000000259`), in which case that dispute is read back and used.
//
// SIGNING. `Stripe.webhooks.generateTestHeaderString` produces exactly the
// `t=…,v1=…` header `constructEvent` checks, over the exact body that is posted. The
// secret comes from the same variables the server reads (`readWebhookSecrets`), so a
// fixture is authentic to the main server and to nothing else. Secrets are never
// returned, logged or put in an error message.
//
// A synthesised dispute id (`dp_e2e…`) does not exist at Stripe, so the pipeline's
// evidence staging on an OPENED dispute fails against it and is logged as a background
// failure. That is the honest result of a simulated chargeback, not a defect; a
// Pathway that needs evidence staging to succeed passes a real `disputeId`.

import { randomBytes } from 'node:crypto';

import Stripe from 'stripe';

import { envValue } from '../../support/db';
import { readWebhookSecrets } from '../../../../domain/services/stripe/config';
import { decodeMetadata } from '../../../../domain/services/stripe/metadata';
import { stripeRunId, testStripe, type TestPlatform } from './stripe';

/** Where the main App_Server listens (design: Main, port 3100). */
export const MAIN_SERVER_URL = 'http://localhost:3100';

/** The Stripe webhook route on an App_Server. */
const STRIPE_WEBHOOK_PATH = '/api/webhooks/stripe';

/** The event types this module builds. */
export type StripeFixtureType =
  | 'radar.early_fraud_warning.created'
  | 'charge.dispute.created'
  | 'charge.dispute.closed';

/** A Stripe event envelope, shaped like a platform (not Connect) delivery. */
export interface StripeFixtureEvent {
  id: string;
  object: 'event';
  api_version: string;
  created: number;
  data: { object: Record<string, unknown> };
  livemode: false;
  pending_webhooks: number;
  request: { id: null; idempotency_key: null };
  type: StripeFixtureType;
}

/** The real objects a fixture names, for the Pathway's own assertions. */
export interface FixtureSubject {
  platform: TestPlatform;
  paymentIntentId: string;
  chargeId: string;
}

/** A built fixture, plus what it was built from. */
export interface BuiltFixture extends FixtureSubject {
  event: StripeFixtureEvent;
}

/** The body and header to post, from {@link signStripeFixture}. */
export interface SignedFixture {
  body: string;
  signature: string;
}

/** Stripe ids are alphanumeric with underscores; a run id may also hold `.`, `:`, `-`. */
function idPart(runId: string): string {
  return runId.replace(/[^A-Za-z0-9]/g, '').slice(0, 24) || 'run';
}

/** A fixture object id that can never collide with a real one or with another run's. */
export function fixtureId(prefix: string, runId: string): string {
  return `${prefix}_e2e${idPart(runId)}${randomBytes(6).toString('hex')}`;
}

/**
 * Wrap an object in a platform event envelope. No `account` field: every routed
 * `charge.*` event of ours is a platform event, and `translateStripeEvent` drops one
 * that carries `account` (ESC-37). Pure apart from the random id.
 */
export function stripeEventEnvelope(
  type: StripeFixtureType,
  object: Record<string, unknown>,
  opts: { runId: string; now?: Date },
): StripeFixtureEvent {
  return {
    id: fixtureId('evt', opts.runId),
    object: 'event',
    api_version: Stripe.API_VERSION,
    created: Math.floor((opts.now ?? new Date()).getTime() / 1000),
    data: { object },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
  };
}

/**
 * Serialise and sign a fixture with the SDK's test header helper. `timestamp` is in
 * SECONDS (the unit `constructEvent`'s tolerance uses); it defaults to now. Pure.
 */
export function signStripeFixture(
  event: StripeFixtureEvent,
  secret: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): SignedFixture {
  if (!/^whsec_/.test(secret)) throw new Error('refusing to sign: the secret is not a whsec_ signing secret');
  const body = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload: body, secret, timestamp });
  return { body, signature };
}

/**
 * The signing secret the main server accepts: the first of the secrets it is
 * configured with, read through the app's own `readWebhookSecrets` over the same
 * variable names. Never logged.
 */
export function configuredWebhookSecret(): string {
  const names = ['STRIPE_WEBHOOK_SECRET', 'STRIPE_CONNECT_WEBHOOK_SECRET'];
  const env: Record<string, string | undefined> = {};
  for (const name of names) {
    env[name] = envValue(name);
    for (const platform of ['AU', 'US']) env[`${name}_${platform}`] = envValue(`${name}_${platform}`);
  }
  const [secret] = readWebhookSecrets(env, ['AU', 'US']);
  if (!secret) {
    throw new Error('refusing to sign: no whsec_ secret in STRIPE_WEBHOOK_SECRET or STRIPE_CONNECT_WEBHOOK_SECRET');
  }
  return secret;
}

/** Read the real test PaymentIntent and its latest Charge. Refuses anything live. */
async function readSubject(
  platform: TestPlatform,
  paymentIntentId: string,
): Promise<{ intent: Stripe.PaymentIntent; charge: Stripe.Charge }> {
  const stripe = testStripe(platform);
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] });
  if (intent.livemode) throw new Error(`refusing: ${paymentIntentId} is a live object`);
  const charge = intent.latest_charge;
  if (!charge || typeof charge === 'string') {
    throw new Error(`${paymentIntentId} has no charge yet (status ${intent.status}); a fixture must name a real charge`);
  }
  return { intent, charge };
}

/**
 * `radar.early_fraud_warning.created` naming a real test charge (ESC-14). The
 * pipeline routes it by `payment_intent`, which is the real intent's id.
 */
export async function earlyFraudWarningFixture(params: {
  paymentIntentId: string;
  platform?: TestPlatform;
  fraudType?: Stripe.Radar.EarlyFraudWarning['fraud_type'];
  actionable?: boolean;
  runId?: string;
}): Promise<BuiltFixture> {
  const platform = params.platform ?? 'AU';
  const runId = params.runId ?? stripeRunId();
  const { intent, charge } = await readSubject(platform, params.paymentIntentId);
  const now = new Date();
  const warning = {
    id: fixtureId('issfr', runId),
    object: 'radar.early_fraud_warning',
    actionable: params.actionable ?? true,
    charge: charge.id,
    created: Math.floor(now.getTime() / 1000),
    fraud_type: params.fraudType ?? 'made_with_stolen_card',
    livemode: false,
    payment_intent: intent.id,
  };
  return {
    platform,
    paymentIntentId: intent.id,
    chargeId: charge.id,
    event: stripeEventEnvelope('radar.early_fraud_warning.created', warning, { runId, now }),
  };
}

/** The dispute status each phase reports. */
function disputeStatus(phase: 'created' | 'closed', outcome: 'won' | 'lost' | undefined): Stripe.Dispute.Status {
  if (phase === 'created') return 'needs_response';
  if (!outcome) throw new Error('a closed dispute fixture needs an outcome: won or lost');
  return outcome;
}

/**
 * `charge.dispute.created` (phase `created`) or `charge.dispute.closed` (phase
 * `closed`, won or lost) naming a real test charge.
 *
 * The dispute carries the real Charge EXPANDED, which the translator reads for
 * attribution (`disputeChargeMetadata`). When that charge's own metadata does not
 * carry the CardTrade routing keys, the real PaymentIntent's routing keys are put on
 * the dispute's `metadata` instead, so attribution still comes from a real object.
 * Pass a real `disputeId` to read that dispute back rather than synthesising one.
 */
export async function disputeFixture(params: {
  paymentIntentId: string;
  phase: 'created' | 'closed';
  outcome?: 'won' | 'lost';
  reason?: Stripe.Dispute['reason'];
  disputeId?: string;
  platform?: TestPlatform;
  runId?: string;
}): Promise<BuiltFixture> {
  const platform = params.platform ?? 'AU';
  const runId = params.runId ?? stripeRunId();
  const { intent, charge } = await readSubject(platform, params.paymentIntentId);
  const status = disputeStatus(params.phase, params.outcome);
  const now = new Date();
  const created = Math.floor(now.getTime() / 1000);

  const routing = decodeMetadata(charge.metadata) ? {} : routingKeys(intent.metadata);

  let dispute: Record<string, unknown>;
  if (params.disputeId) {
    const real = await testStripe(platform).disputes.retrieve(params.disputeId);
    if (real.livemode) throw new Error(`refusing: ${params.disputeId} is a live object`);
    const realCharge = typeof real.charge === 'string' ? real.charge : real.charge.id;
    if (realCharge !== charge.id) {
      throw new Error(`${params.disputeId} is against ${realCharge}, not ${charge.id}`);
    }
    // `lastResponse` is the SDK's own request record, not part of the object.
    const { lastResponse: _lastResponse, ...object } = real;
    dispute = { ...object, charge, status, metadata: { ...object.metadata, ...routing } };
  } else {
    dispute = {
      id: fixtureId('dp', runId),
      object: 'dispute',
      amount: charge.amount,
      balance_transactions: [],
      charge,
      created,
      currency: charge.currency,
      evidence_details: {
        due_by: created + 7 * 24 * 60 * 60,
        has_evidence: false,
        past_due: false,
        submission_count: 0,
      },
      is_charge_refundable: false,
      livemode: false,
      metadata: routing,
      payment_intent: intent.id,
      reason: params.reason ?? 'fraudulent',
      status,
    };
  }

  return {
    platform,
    paymentIntentId: intent.id,
    chargeId: charge.id,
    event: stripeEventEnvelope(
      params.phase === 'created' ? 'charge.dispute.created' : 'charge.dispute.closed',
      dispute,
      { runId, now },
    ),
  };
}

/** Only the `cardtrade_` routing keys of a metadata map (never the run stamp). */
function routingKeys(metadata: Stripe.Metadata | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (key.startsWith('cardtrade_') && key !== 'cardtrade_sandbox' && key !== 'cardtrade_e2e_run') {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Sign a fixture with the configured secret and POST it to an App_Server's Stripe
 * webhook route. Returns the status and the parsed reply. Call it only inside
 * `simulated()`.
 */
export async function postStripeFixture(
  event: StripeFixtureEvent,
  opts: { baseUrl?: string; secret?: string } = {},
): Promise<{ status: number; body: unknown }> {
  const { body, signature } = signStripeFixture(event, opts.secret ?? configuredWebhookSecret());
  const response = await fetch(`${opts.baseUrl ?? MAIN_SERVER_URL}${STRIPE_WEBHOOK_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    body,
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // keep the text
  }
  return { status: response.status, body: parsed };
}
