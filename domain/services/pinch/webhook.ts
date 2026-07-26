// domain/services/pinch/webhook.ts
//
// Inbound webhook support for real Pinch deliveries: signature verification and
// translation of Pinch events into the internal `WebhookEvent` shape the
// Webhook_Handler already understands (Req 10.1–10.8).
//
// Pinch's contract differs from the MockService's in three ways, all absorbed
// here so `app/api/webhooks/pinch/route.ts` keeps a single pipeline:
//   1. Header: `pinch-signature: t=<unix>,v2=<hmac>` where the HMAC-SHA256 is
//      computed over `{t}.{rawBody}` with the `whsec_...` webhook secret, and
//      stale timestamps are rejected (5 minute window) to block replays.
//   2. Envelope: `{ Id, Type, EventDate, Metadata, Data }`, PascalCase by
//      default but configurable to camelCase — so key lookups are case-tolerant.
//   3. Fan-out: one `bank-results` delivery reports many payments, so a single
//      request can translate into several internal events.
//
// Routing relies on the CardTrade metadata stamped onto each payment by
// `PinchService` (see `metadata.ts`). An event whose payment carries no CardTrade
// metadata is not ours to act on and translates to nothing, which the handler
// records as a NO_OP.

import { createHmac, timingSafeEqual } from 'node:crypto';

import type { WebhookEvent, WebhookEventType } from '../types';
import { decodeMetadata } from './metadata';

/** The header real Pinch sends (the Mock uses `x-pinch-signature`). */
export const PINCH_LIVE_SIGNATURE_HEADER = 'pinch-signature';

/** Default replay window, matching the Pinch SDK. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/** Payment statuses that mean the funds were collected. */
const COLLECTED = new Set(['approved', 'settled']);
/** Payment statuses that mean the attempt definitively failed. */
const FAILED = new Set(['dishonoured', 'dishonored', 'failed', 'cancelled', 'canceled', 'declined']);

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/** Parsed `pinch-signature` header parts. */
interface SignatureParts {
  timestamp: number;
  signature: string;
}

/** Split `t=...,v2=...` into its parts. Returns `null` when malformed. */
function parseSignatureHeader(header: string): SignatureParts | null {
  const parts = header.split(',');
  let timestamp: number | null = null;
  let signature: string | null = null;

  for (const part of parts) {
    const [key, value] = part.split('=', 2).map((s) => s?.trim());
    if (key === 't' && value) {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) timestamp = parsed;
    } else if (key === 'v2' && value) {
      signature = value;
    }
  }

  if (timestamp === null || !signature) return null;
  return { timestamp, signature };
}

/** Constant-time hex/ascii comparison that tolerates length mismatches. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verify a real Pinch webhook delivery.
 *
 * Recomputes `HMAC-SHA256("{t}.{rawBody}", secret)` and compares it to the
 * header's `v2` value in constant time, then rejects timestamps outside the
 * tolerance window.
 *
 * @returns `true` only when the delivery is authentic and fresh.
 */
export function verifyPinchSignature(params: {
  rawBody: string;
  header: string | null;
  secret: string;
  toleranceSeconds?: number;
  nowMs?: number;
}): boolean {
  if (!params.header || !params.secret) return false;

  const parsed = parseSignatureHeader(params.header);
  if (!parsed) return false;

  const expected = createHmac('sha256', params.secret)
    .update(`${parsed.timestamp}.${params.rawBody}`, 'utf8')
    .digest('hex');

  if (!safeEqual(expected, parsed.signature.toLowerCase())) return false;

  const tolerance = params.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor((params.nowMs ?? Date.now()) / 1000);
  return Math.abs(nowSeconds - parsed.timestamp) <= tolerance;
}

// ---------------------------------------------------------------------------
// Event translation
// ---------------------------------------------------------------------------

/** Case-tolerant property read (Pinch payloads may be Pascal or camelCase). */
function prop(source: unknown, name: string): unknown {
  if (!source || typeof source !== 'object') return undefined;
  const record = source as Record<string, unknown>;
  if (name in record) return record[name];
  const lower = name.toLowerCase();
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === lower) return record[key];
  }
  return undefined;
}

function str(source: unknown, name: string): string | undefined {
  const value = prop(source, name);
  return typeof value === 'string' ? value : undefined;
}

function num(source: unknown, name: string): number | undefined {
  const value = prop(source, name);
  return typeof value === 'number' ? value : undefined;
}

/** Classify a payment's status into collected / failed / still pending. */
function classify(payment: unknown): 'COLLECTED' | 'FAILED' | 'PENDING' {
  const status = str(payment, 'status')?.toLowerCase();
  if (status && COLLECTED.has(status)) return 'COLLECTED';
  if (status && FAILED.has(status)) return 'FAILED';
  // A dishonour object present without a terminal status still means failure.
  if (prop(payment, 'dishonour')) return 'FAILED';
  return 'PENDING';
}

/** Human-readable failure detail from a payment's dishonour object. */
function failureReason(payment: unknown): string | undefined {
  const dishonour = prop(payment, 'dishonour');
  if (!dishonour) return undefined;
  const reason = str(dishonour, 'reason');
  const type = str(dishonour, 'type');
  return [type, reason].filter(Boolean).join(': ') || undefined;
}

/**
 * Translate one Pinch payment (from any payment-bearing event) into an internal
 * `WebhookEvent`. Returns `null` when the payment is not a CardTrade payment or
 * is not in a terminal state yet.
 */
function translatePayment(
  payment: unknown,
  context: { eventId: string; occurredAt: string },
): WebhookEvent | null {
  const paymentId = str(payment, 'id');
  if (!paymentId) return null;

  const metadata = decodeMetadata(prop(payment, 'metadata'));
  if (!metadata) return null;

  const outcome = classify(payment);
  if (outcome === 'PENDING') return null;

  const amount = num(payment, 'amount');
  const reason = outcome === 'FAILED' ? failureReason(payment) : undefined;

  let type: WebhookEventType;
  if (metadata.kind === 'HOLD') {
    type = outcome === 'COLLECTED' ? 'hold.active' : 'hold.failed';
  } else {
    type = outcome === 'COLLECTED' ? 'transfer.settled' : 'transfer.failed';
  }

  return {
    // Namespaced by the provider event AND the payment so a multi-payment
    // delivery produces distinct idempotency keys (Req 10.5).
    eventId: `${context.eventId}:${paymentId}`,
    type,
    occurredAt: context.occurredAt,
    payload: {
      ...(metadata.kind === 'HOLD' ? { holdId: paymentId } : { transferId: paymentId }),
      ...(metadata.tradeId ? { tradeId: metadata.tradeId } : {}),
      ...(metadata.cashSaleId ? { cashSaleId: metadata.cashSaleId } : {}),
      ...(amount !== undefined ? { amount } : {}),
      status: str(payment, 'status'),
      ...(reason ? { reason } : {}),
    },
  };
}

/**
 * Translate a verified Pinch webhook body into zero or more internal
 * `WebhookEvent`s.
 *
 * Handled event types:
 *   * `realtime-payment`, `payment-created` — a single `Data.Payment`.
 *   * `bank-results`, `scheduled-process`   — a `Data.Payments` list.
 *
 * Everything else (transfers, refunds, payers, subscriptions, disputes) returns
 * an empty list: our void/capture paths act on the synchronous refund response,
 * so no internal transition depends on those deliveries. The handler logs them
 * as NO_OP, which keeps an audit trail without inventing state changes.
 */
export function translatePinchEvent(body: unknown): WebhookEvent[] {
  const eventId = str(body, 'id');
  const type = str(body, 'type')?.toLowerCase();
  if (!eventId || !type) return [];

  const occurredAt = str(body, 'eventDate') ?? new Date().toISOString();
  const data = prop(body, 'data');
  const context = { eventId, occurredAt };

  switch (type) {
    case 'realtime-payment':
    case 'payment-created': {
      const translated = translatePayment(prop(data, 'payment'), context);
      return translated ? [translated] : [];
    }
    case 'bank-results':
    case 'scheduled-process': {
      const payments = prop(data, 'payments');
      if (!Array.isArray(payments)) return [];
      return payments
        .map((payment) => translatePayment(payment, context))
        .filter((event): event is WebhookEvent => event !== null);
    }
    case 'compliance-updated':
    case 'merchant-updated': {
      const translated = translateCompliance(body, data, context);
      return translated ? [translated] : [];
    }
    default:
      return [];
  }
}

/**
 * Translate a merchant compliance decision into the internal
 * `merchant.compliance.updated` event, which the handler routes to the merchant
 * onboarding orchestrator to move a Profile's `merchant_status`.
 *
 * The provider reports the decision across the top-level `Metadata` (status and
 * merchant status) and the `ComplianceSubmission` object, and the merchant id may
 * arrive on either. Returns `null` when no merchant reference can be resolved —
 * the delivery is then a logged NO_OP rather than a guess.
 */
function translateCompliance(
  body: unknown,
  data: unknown,
  context: { eventId: string; occurredAt: string },
): WebhookEvent | null {
  const metadata = prop(body, 'metadata');
  const submission = prop(data, 'complianceSubmission');
  const merchant = prop(data, 'merchant');

  const merchantRef =
    str(submission, 'merchantId') ??
    str(metadata, 'merchantId') ??
    str(merchant, 'id') ??
    str(submission, 'id');
  if (!merchantRef) return null;

  const status =
    str(submission, 'submissionStatus') ??
    str(metadata, 'status') ??
    str(merchant, 'status') ??
    undefined;

  const flags = prop(submission, 'compliance') ?? submission;
  const bool = (source: unknown, name: string): boolean | undefined => {
    const value = prop(source, name);
    return typeof value === 'boolean' ? value : undefined;
  };

  // The documented payload reports approval as `SubmissionStatus: approved` plus
  // `MerchantStatus: active` rather than the enable flags, so carry the merchant
  // status through as the approval signal.
  const merchantState = (
    str(submission, 'merchantStatus') ??
    str(metadata, 'merchantStatus') ??
    ''
  ).toLowerCase();

  return {
    eventId: `${context.eventId}:${merchantRef}`,
    type: 'merchant.compliance.updated',
    occurredAt: context.occurredAt,
    payload: {
      merchantRef,
      ...(status ? { status } : {}),
      ...(bool(flags, 'liveEnabled') !== undefined
        ? { liveEnabled: bool(flags, 'liveEnabled') }
        : {}),
      ...(bool(flags, 'transactionsEnabled') !== undefined
        ? { transactionsEnabled: bool(flags, 'transactionsEnabled') }
        : {}),
      ...(bool(flags, 'settlementsEnabled') !== undefined
        ? { settlementsEnabled: bool(flags, 'settlementsEnabled') }
        : {}),
      ...(merchantState ? { merchantActive: merchantState === 'active' } : {}),
      ...(str(submission, 'notes') ? { reason: str(submission, 'notes') } : {}),
    },
  };
}
