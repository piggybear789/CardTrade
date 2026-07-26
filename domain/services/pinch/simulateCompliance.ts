// domain/services/pinch/simulateCompliance.ts
//
// TEST-MODE ONLY simulation of a Pinch Managed Merchant compliance decision.
//
// WHY THIS EXISTS. Pinch's test environment can simulate almost everything a
// merchant does — `Time-Travel` for direct-debit processing/settlement, test
// cards and bank accounts, and dishonour-code triggers. What it does NOT expose
// is an endpoint to advance a compliance review: approval is a human step at
// Pinch, and the decision reaches us as a `compliance-updated` webhook. In test
// mode a managed merchant can transact before that decision exists.
//
// So rather than writing `merchant_status = APPROVED` straight into the database
// (which would bypass every guard and prove nothing), this builds a real
// Pinch-shaped `compliance-updated` envelope, signs it exactly like Pinch does
// (`pinch-signature: t=...,v2=...` over `{t}.{rawBody}`), and POSTs it to our own
// Webhook_Handler. The delivery therefore travels the entire production path:
// signature verification -> replay window -> `translatePinchEvent` -> idempotency
// -> the merchant onboarding orchestrator -> `merchant_status`.
//
// The only fiction is who authored the event. Everything downstream is real, and
// nothing here works in `live`.

import { createHmac } from 'node:crypto';

import { PINCH_LIVE_SIGNATURE_HEADER } from './webhook';
import type { PinchConfig } from './config';

/** Outcomes the simulator can deliver, mirroring `SubmissionStatus` values. */
export type SimulatedComplianceOutcome = 'approved' | 'rejected' | 'in-review';

export interface SimulateComplianceParams {
  config: PinchConfig;
  /** The `mch_...` whose compliance decision is being simulated. */
  merchantRef: string;
  outcome?: SimulatedComplianceOutcome;
  /** Absolute URL of our own Webhook_Handler. */
  webhookUrl: string;
  /** Secret used to sign the delivery; must match `PINCH_WEBHOOK_SECRET`. */
  webhookSecret: string;
  notes?: string;
  fetchFn?: typeof fetch;
  nowMs?: () => number;
}

export type SimulateComplianceResult =
  | { ok: true; eventId: string; outcome: SimulatedComplianceOutcome; response: unknown }
  | { ok: false; error: 'NOT_TEST_MODE' | 'NOT_CONFIGURED' | 'DELIVERY_FAILED'; detail?: string };

/** Map an outcome onto the documented `SubmissionStatus` + `MerchantStatus` pair. */
function statusFor(outcome: SimulatedComplianceOutcome): {
  submissionStatus: string;
  merchantStatus: string;
  enabled: boolean;
} {
  switch (outcome) {
    case 'approved':
      return { submissionStatus: 'approved', merchantStatus: 'active', enabled: true };
    case 'rejected':
      return { submissionStatus: 'rejected', merchantStatus: 'inactive', enabled: false };
    case 'in-review':
    default:
      return { submissionStatus: 'in-review', merchantStatus: 'pending', enabled: false };
  }
}

/**
 * Sign a webhook body the way Pinch does: HMAC-SHA256 over `{timestamp}.{body}`.
 * Exported so tests can assert the handler accepts what we produce.
 */
export function signPinchWebhook(params: {
  rawBody: string;
  secret: string;
  timestampSeconds: number;
}): string {
  const signature = createHmac('sha256', params.secret)
    .update(`${params.timestampSeconds}.${params.rawBody}`)
    .digest('hex');
  return `t=${params.timestampSeconds},v2=${signature}`;
}

/**
 * Build the `compliance-updated` envelope. Shaped to match the documented
 * payload (camelCase, as configured on our webhook subscription) so
 * `translatePinchEvent` needs no special case for simulated deliveries.
 */
export function buildComplianceEvent(params: {
  merchantRef: string;
  outcome: SimulatedComplianceOutcome;
  occurredAt: string;
  eventId: string;
  notes?: string;
}): Record<string, unknown> {
  const { submissionStatus, merchantStatus, enabled } = statusFor(params.outcome);
  return {
    id: params.eventId,
    type: 'compliance-updated',
    eventDate: params.occurredAt,
    metadata: { merchantId: params.merchantRef, status: submissionStatus, merchantStatus },
    data: {
      complianceSubmission: {
        merchantId: params.merchantRef,
        submissionStatus,
        merchantStatus,
        // Real approvals also flip the enable flags; include them so the
        // orchestrator's `settlementsEnabled` signal is exercised too.
        compliance: {
          liveEnabled: enabled,
          transactionsEnabled: enabled,
          settlementsEnabled: enabled,
        },
        ...(params.notes ? { complianceOfficerNotes: params.notes } : {}),
      },
      merchant: { id: params.merchantRef, status: merchantStatus },
    },
  };
}

/**
 * Deliver a simulated compliance decision to our own Webhook_Handler.
 *
 * Refuses to run outside `test`, and refuses without a webhook secret (the
 * handler would reject an unsigned delivery anyway).
 */
export async function simulateComplianceDecision(
  params: SimulateComplianceParams,
): Promise<SimulateComplianceResult> {
  if (params.config.environment !== 'test' || !params.config.simulateCompliance) {
    return { ok: false, error: 'NOT_TEST_MODE' };
  }
  if (!params.webhookSecret || !params.webhookUrl) {
    return { ok: false, error: 'NOT_CONFIGURED' };
  }

  const outcome = params.outcome ?? 'approved';
  const nowMs = params.nowMs ?? (() => Date.now());
  const timestampSeconds = Math.floor(nowMs() / 1000);
  const occurredAt = new Date(nowMs()).toISOString();
  // Deterministic per (merchant, outcome, second) so an accidental double-click
  // is absorbed by the handler's existing idempotency check.
  const eventId = `sim_compliance_${params.merchantRef}_${outcome}_${timestampSeconds}`;

  const rawBody = JSON.stringify(
    buildComplianceEvent({
      merchantRef: params.merchantRef,
      outcome,
      occurredAt,
      eventId,
      notes: params.notes ?? 'Simulated Pinch test-mode compliance decision.',
    }),
  );

  const fetchFn = params.fetchFn ?? fetch;
  try {
    const response = await fetchFn(params.webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [PINCH_LIVE_SIGNATURE_HEADER]: signPinchWebhook({
          rawBody,
          secret: params.webhookSecret,
          timestampSeconds,
        }),
      },
      body: rawBody,
    });

    const text = await response.text();
    if (!response.ok) {
      return { ok: false, error: 'DELIVERY_FAILED', detail: `${response.status} ${text}` };
    }
    return {
      ok: true,
      eventId,
      outcome,
      response: text ? (JSON.parse(text) as unknown) : null,
    };
  } catch (err) {
    return {
      ok: false,
      error: 'DELIVERY_FAILED',
      detail: err instanceof Error ? err.message : 'unknown error',
    };
  }
}
