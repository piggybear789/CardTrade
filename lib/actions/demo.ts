'use server';

// lib/actions/demo.ts
//
// Demo-only Server Actions that fire SIMULATED Pinch Webhook_Events into the
// real Webhook_Handler (`app/api/webhooks/pinch/route.ts`). These back the
// Trade Contract "Demo" panel (task 15.3), letting a demo operator drive the
// payment/collateral webhooks that would otherwise arrive from Pinch - chiefly
// the pre-auth hold confirmation that advances a Trade
// COLLATERAL_PENDING -> COLLATERAL_LOCKED (Req 5.5), plus a hold-failure control
// (Req 5.6).
//
// Why a server action (not a browser fetch): the webhook body must be SIGNED
// with the server-side shared secret (HMAC-SHA256), and the secret must never
// reach the browser (Req 10.1). So the browser calls this action, and the
// action signs + POSTs on the server - exercising the exact same authenticated
// code path a real Pinch webhook would (Req 10.1). We reuse the MockService's
// `buildEnvelope` to produce the signed body + header contract, then POST it
// ourselves so we can read the handler's outcome and return a typed result.
//
// The action never mutates the Trade directly: it only delivers the webhook.
// The resulting Trade_State transition is committed by the Webhook_Handler via
// the orchestrator, and the live view updates over the existing realtime
// subscription - so the panel does not need to refetch.

import { createClient } from '@/lib/supabase/server';
import { MockService } from '@/domain/services/mock/MockService';
import {
  PINCH_EVENT_ID_HEADER,
  PINCH_SIGNATURE_HEADER,
} from '@/domain/services/mock/MockService';
import type {
  WebhookEvent,
  WebhookEventType,
} from '@/domain/services/types';

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/**
 * The set of simulated webhooks the Demo panel can fire. Deliberately narrow:
 * shipping/receipt/acceptance/dispute/fraud are real user actions in the
 * ActionBar, so the panel only simulates the PAYMENT/COLLATERAL webhooks Pinch
 * would otherwise send.
 *   - `confirm-holds` -> `hold.active`  -> HOLDS_CONFIRMED (Req 5.5)
 *   - `fail-holds`    -> `hold.failed`  -> HOLDS_FAILED    (Req 5.6)
 */
export type DemoWebhookKind = 'confirm-holds' | 'fail-holds';

/** Typed failure codes for {@link fireTradeWebhook}. */
export type FireTradeWebhookError =
  | 'unauthenticated'
  | 'not-participant'
  | 'delivery-failed'
  | 'rejected';

/** Discriminated result of firing a simulated webhook. */
export type FireTradeWebhookResult =
  | { ok: true; kind: DemoWebhookKind; outcome: string; deduped: boolean }
  | { ok: false; error: FireTradeWebhookError; detail?: string };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** The webhook event type each demo control maps to. */
const EVENT_TYPE_BY_KIND: Record<DemoWebhookKind, WebhookEventType> = {
  'confirm-holds': 'hold.active',
  'fail-holds': 'hold.failed',
};

/**
 * Webhook wiring, read with the same local defaults the emitter
 * (`domain/services/index.ts`) and the handler (`route.ts`) use, so the signed
 * delivery verifies end-to-end in local demos while production supplies real
 * values via env.
 */
function readWebhookConfig(): { webhookUrl: string; secret: string } {
  return {
    webhookUrl:
      process.env.WEBHOOK_URL ?? 'http://localhost:3000/api/webhooks/pinch',
    secret: process.env.WEBHOOK_SECRET ?? 'dev-mock-webhook-secret',
  };
}

/**
 * Confirm the caller is authenticated and one of the two participating Traders.
 * RLS on `trades` grants the row only to participants, so a missing row is
 * reported as `not-participant` (Req 9.6/9.7). This keeps the demo control from
 * being driven against trades the caller has no part in, even though the
 * webhook itself is signature-authenticated rather than session-authenticated.
 */
async function requireParticipant(
  tradeId: string,
): Promise<{ ok: true } | { ok: false; error: 'unauthenticated' | 'not-participant' }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const { data: trade } = await supabase
    .from('trades')
    .select('id, initiator_id, counterpart_id')
    .eq('id', tradeId)
    .maybeSingle();
  if (!trade) return { ok: false, error: 'not-participant' };
  if (trade.initiator_id !== user.id && trade.counterpart_id !== user.id) {
    return { ok: false, error: 'not-participant' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Server action
// ---------------------------------------------------------------------------

/**
 * Fire a simulated Pinch Webhook_Event for a Trade into the real
 * Webhook_Handler (Req 10.1), signing the body server-side.
 *
 * Steps:
 *   1. Authenticate + confirm the caller participates in the Trade.
 *   2. Build the WebhookEvent for `kind`, carrying the `tradeId` so the handler
 *      can route it to the Trade without a hold lookup. The `eventId` is stable
 *      per (trade, kind) so re-firing is idempotent (Req 10.5): a repeat of an
 *      already-successful confirmation is deduped rather than reprocessed.
 *   3. Sign the exact body bytes via MockService.buildEnvelope and POST it with
 *      the provider's signature + event-id headers.
 *   4. Read the handler's outcome and map it to a typed result. A FAILURE
 *      outcome (e.g. the event is invalid from the current Trade_State) is
 *      surfaced as `rejected` so the caller can toast an error.
 */
export async function fireTradeWebhook(
  tradeId: string,
  kind: DemoWebhookKind,
): Promise<FireTradeWebhookResult> {
  const guard = await requireParticipant(tradeId);
  if (!guard.ok) return guard;

  const { webhookUrl, secret } = readWebhookConfig();

  const event: WebhookEvent = {
    // Stable per (trade, kind) -> idempotent re-fires (Req 10.5).
    eventId: `evt_demo_${kind}_${tradeId}`,
    type: EVENT_TYPE_BY_KIND[kind],
    occurredAt: new Date().toISOString(),
    payload: {
      tradeId,
      status: kind === 'confirm-holds' ? 'ACTIVE' : 'FAILED',
      ...(kind === 'fail-holds' ? { reason: 'Simulated pre-auth hold failure' } : {}),
    },
  };

  // Reuse the MockService signing contract to produce the exact signed body +
  // header values the handler recomputes and verifies.
  const mock = new MockService({ webhookUrl, secret });
  const envelope = mock.buildEnvelope(event);

  let response: Response;
  try {
    response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [PINCH_SIGNATURE_HEADER]: envelope.signature,
        [PINCH_EVENT_ID_HEADER]: envelope.event.eventId,
      },
      body: envelope.rawBody,
      cache: 'no-store',
    });
  } catch (cause) {
    return {
      ok: false,
      error: 'delivery-failed',
      detail: cause instanceof Error ? cause.message : 'Could not reach the webhook handler.',
    };
  }

  // A non-2xx here means the signed delivery itself was rejected (e.g. 401 on a
  // signature mismatch, 400 on a malformed body) - a wiring problem, not a
  // business rejection.
  if (!response.ok) {
    return { ok: false, error: 'delivery-failed', detail: `Webhook responded ${response.status}.` };
  }

  const body = (await response.json().catch(() => null)) as
    | { ok?: boolean; outcome?: string; deduped?: boolean }
    | null;

  // The handler acks authentic events with 200 and an outcome of
  // SUCCESS / FAILURE / NO_OP. A FAILURE means the mapped transition was
  // rejected from the current state (Req 10.8).
  if (body?.outcome === 'FAILURE') {
    return { ok: false, error: 'rejected', detail: 'The trade could not accept this event in its current state.' };
  }

  return {
    ok: true,
    kind,
    outcome: body?.outcome ?? 'SUCCESS',
    deduped: body?.deduped === true,
  };
}

// ---------------------------------------------------------------------------
// Cash Sale - simulated payment settlement / failure
// ---------------------------------------------------------------------------

/**
 * The set of simulated webhooks for Cash_Sale payment flows.
 *   - `settle-payment` -> `transfer.settled` -> ESCROW_HELD (Req 4.3)
 *   - `fail-payment`   -> `transfer.failed`  -> FAILED (Req 4.4)
 */
export type DemoCashSaleWebhookKind = 'settle-payment' | 'fail-payment';

/** Typed failure codes for {@link fireCashSaleWebhook}. */
export type FireCashSaleWebhookError =
  | 'unauthenticated'
  | 'not-participant'
  | 'delivery-failed'
  | 'rejected';

/** Discriminated result of firing a simulated cash-sale webhook. */
export type FireCashSaleWebhookResult =
  | { ok: true; kind: DemoCashSaleWebhookKind; outcome: string; deduped: boolean }
  | { ok: false; error: FireCashSaleWebhookError; detail?: string };

/** The webhook event type each cash-sale demo control maps to. */
const CASH_SALE_EVENT_TYPE_BY_KIND: Record<DemoCashSaleWebhookKind, WebhookEventType> = {
  'settle-payment': 'transfer.settled',
  'fail-payment': 'transfer.failed',
};

/**
 * Confirm the caller is authenticated and a buyer or seller on this cash sale.
 */
async function requireCashSaleParticipant(
  cashSaleId: string,
): Promise<{ ok: true } | { ok: false; error: 'unauthenticated' | 'not-participant' }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const { data: sale } = await supabase
    .from('cash_sales')
    .select('id, buyer_id, seller_id')
    .eq('id', cashSaleId)
    .maybeSingle();
  if (!sale) return { ok: false, error: 'not-participant' };
  if (sale.buyer_id !== user.id && sale.seller_id !== user.id) {
    return { ok: false, error: 'not-participant' };
  }
  return { ok: true };
}

/**
 * Fire a simulated Pinch `transfer.settled` or `transfer.failed` webhook for a
 * Cash_Sale, advancing PAYMENT_PENDING -> ESCROW_HELD (or FAILED).
 *
 * Follows the same pattern as `fireTradeWebhook`: authenticate, build event,
 * sign server-side, POST to our own webhook route, return the outcome.
 */
export async function fireCashSaleWebhook(
  cashSaleId: string,
  kind: DemoCashSaleWebhookKind,
): Promise<FireCashSaleWebhookResult> {
  const guard = await requireCashSaleParticipant(cashSaleId);
  if (!guard.ok) return guard;

  const { webhookUrl, secret } = readWebhookConfig();

  const event: WebhookEvent = {
    // Stable per (sale, kind) -> idempotent re-fires (Req 10.5).
    eventId: `evt_demo_${kind}_${cashSaleId}`,
    type: CASH_SALE_EVENT_TYPE_BY_KIND[kind],
    occurredAt: new Date().toISOString(),
    payload: {
      cashSaleId,
      status: kind === 'settle-payment' ? 'SETTLED' : 'FAILED',
      ...(kind === 'fail-payment' ? { reason: 'Simulated payment failure' } : {}),
    },
  };

  const mock = new MockService({ webhookUrl, secret });
  const envelope = mock.buildEnvelope(event);

  let response: Response;
  try {
    response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [PINCH_SIGNATURE_HEADER]: envelope.signature,
        [PINCH_EVENT_ID_HEADER]: envelope.event.eventId,
      },
      body: envelope.rawBody,
      cache: 'no-store',
    });
  } catch (cause) {
    return {
      ok: false,
      error: 'delivery-failed',
      detail: cause instanceof Error ? cause.message : 'Could not reach the webhook handler.',
    };
  }

  if (!response.ok) {
    return { ok: false, error: 'delivery-failed', detail: `Webhook responded ${response.status}.` };
  }

  const body = (await response.json().catch(() => null)) as
    | { ok?: boolean; outcome?: string; deduped?: boolean }
    | null;

  if (body?.outcome === 'FAILURE') {
    return { ok: false, error: 'rejected', detail: 'The sale could not accept this event in its current state.' };
  }

  return {
    ok: true,
    kind,
    outcome: body?.outcome ?? 'SUCCESS',
    deduped: body?.deduped === true,
  };
}
