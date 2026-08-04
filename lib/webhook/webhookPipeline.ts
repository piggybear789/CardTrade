import 'server-only';

// lib/webhook/webhookPipeline.ts
//
// The shared Webhook_Handler pipeline (Req 10), extracted from the route so it
// can be driven two ways:
//   * over HTTP by `app/api/webhooks/stripe/route.ts` (real provider deliveries
//     and local `stripe listen` / demo POSTs), and
//   * in-process by trusted server code that has already signed a
//     provider-shaped envelope.
//
// Both callers hand `handleWebhookDelivery` the raw body bytes and the request
// headers, so the SAME verify -> translate -> dedupe -> map -> dispatch -> log
// path runs whichever entry point is used. The in-process caller exists because
// a serverless function POSTing to its own public deployment URL is unreliable
// on some hosts ("fetch failed"); processing in-process removes that network
// hop while preserving signature verification and every downstream guard.
//
// Only `authenticate()` below is provider-specific. Everything after it — dedupe,
// map, dispatch, log — is provider-agnostic and unchanged from the Pinch era,
// which is what made swapping providers a small edit rather than a rewrite.
//
// SECURITY MODEL: authenticated BY SIGNATURE, not by user session. The HMAC check
// runs BEFORE any state change or log write (Req 10.1, 10.2). Uses the
// service-role admin client because it writes to trades / cash_sales /
// webhook_logs on behalf of the provider.

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Database, Json } from '@/lib/supabase/database.types';
import { getPaymentService, isLivePaymentsProvider } from '@/domain/services';
import {
  MOCK_SIGNATURE_HEADER,
  signWebhookBody,
} from '@/domain/services/mock/MockService';
import type Stripe from 'stripe';

import {
  createStripeClient,
  readWebhookSecrets,
  STRIPE_SIGNATURE_HEADER,
  translateStripeEvent,
  verifyStripeSignature,
} from '@/domain/services/stripe';
import type { WebhookEvent } from '@/domain/services/types';
import { mapEventToAction } from '@/domain/webhook/mapEventToAction';
import { createDefaultTradeOrchestrator } from '@/domain/orchestrator/supabaseTradeRepository';
import { createSupabaseCollateralSideEffects } from '@/domain/orchestrator/supabaseTradeProposalRepository';
import { createDefaultCashSaleOrchestrator } from '@/domain/orchestrator/supabaseCashSaleRepository';
import { createDefaultMerchantOnboardingOrchestrator } from '@/domain/orchestrator/supabaseMerchantRepository';

type AdminClient = ReturnType<typeof createAdminClient>;
type WebhookOutcome = Database['cardtrade']['Enums']['webhook_outcome'];

/**
 * Shared secret used to verify MockService webhook signatures. Read from
 * `WEBHOOK_SECRET` with the same local default the emitter
 * (`domain/services/index.ts`) uses, so the signature path works end-to-end in
 * local demos while production supplies a real secret.
 */
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? 'dev-mock-webhook-secret';

/**
 * Constant-time comparison of two hex signature strings. Returns `false` on any
 * length mismatch (Node's `timingSafeEqual` requires equal-length buffers) so a
 * tampered or absent signature is rejected without leaking timing information.
 */
function signaturesMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Resolve the target Trade id for a trade-mapped event. Prefers an explicit
 * `tradeId` in the payload; otherwise resolves it from the referenced hold via
 * `pre_auth_holds.hold_ref`. Returns `null` when the event cannot be routed to a
 * Trade (treated as a NO_OP so an unroutable event is still acknowledged).
 */
async function resolveTradeId(
  client: AdminClient,
  event: WebhookEvent,
): Promise<string | null> {
  if (event.payload.tradeId) return event.payload.tradeId;
  if (event.payload.holdId) {
    const { data } = await client
      .from('pre_auth_holds')
      .select('trade_id')
      .eq('hold_ref', event.payload.holdId)
      .maybeSingle();
    return (data as { trade_id: string } | null)?.trade_id ?? null;
  }
  return null;
}

/**
 * Persist the Webhook_Log for this event (Req 10.3). Upserts on the unique
 * `event_id` so a re-delivered non-successful event updates its single log row
 * rather than violating the idempotency-key constraint.
 */
async function writeLog(
  client: AdminClient,
  entry: { eventId: string; eventType: string; payload: unknown },
  outcome: WebhookOutcome,
  tradeId: string | null,
): Promise<void> {
  await client.from('webhook_logs').upsert(
    {
      event_id: entry.eventId,
      event_type: entry.eventType,
      payload: entry.payload as Json,
      outcome,
      trade_id: tradeId,
    },
    { onConflict: 'event_id' },
  );
}

/** True when this event id already has a SUCCESS log (Req 10.5). */
async function alreadyProcessed(client: AdminClient, eventId: string): Promise<boolean> {
  const { data } = await client
    .from('webhook_logs')
    .select('outcome')
    .eq('event_id', eventId)
    .eq('outcome', 'SUCCESS')
    .maybeSingle();
  return Boolean(data);
}

/**
 * Dispatch one internal event through the orchestrators (Req 10.4, 10.7, 10.8)
 * and return the outcome plus the affected Trade id (for the log's `trade_id`).
 */
async function dispatchEvent(
  client: AdminClient,
  event: WebhookEvent,
): Promise<{ outcome: WebhookOutcome; tradeId: string | null }> {
  const action = mapEventToAction(event);

  switch (action.kind) {
    case 'TRADE_EVENT': {
      const tradeId = await resolveTradeId(client, event);
      if (!tradeId) {
        // Authentic but unroutable to a Trade -> no-op (Req 10.7).
        return { outcome: 'NO_OP', tradeId: null };
      }
      // Attribute the system/provider-driven transition to the Trade's
      // initiator so the audit row's FK (trade_state_transitions.requested_by ->
      // profiles.id) stays valid; the audit `event` column records the actual
      // driver. A missing Trade is treated as unroutable (Req 10.7).
      const { data: tradeRow } = await client
        .from('trades')
        .select('initiator_id')
        .eq('id', tradeId)
        .maybeSingle();
      const actorId = (tradeRow as { initiator_id: string } | null)?.initiator_id;
      if (!actorId) {
        return { outcome: 'NO_OP', tradeId };
      }

      // `runSideEffects` is the HOLDS_FAILED cancellation hook (Req 5.6): on a
      // real hold failure/timeout it voids every active hold on the Trade and
      // restores both paired Items to AVAILABLE. Every other event is a no-op
      // for this hook (see createCollateralSideEffects). Without wiring it in
      // here, a genuine provider decline left Items RESERVED forever with no
      // compensation — this is the only place HOLDS_FAILED is ever dispatched.
      const orchestrator = createDefaultTradeOrchestrator({
        payments: getPaymentService(),
        runSideEffects: createSupabaseCollateralSideEffects(client),
      });
      const result = await orchestrator.applyEvent({
        tradeId,
        event: action.tradeEvent,
        actorId,
      });
      // A rejected transition records FAILURE and preserves the current state
      // (Req 10.8); a committed transition records SUCCESS (Req 10.4).
      return { outcome: result.ok ? 'SUCCESS' : 'FAILURE', tradeId };
    }

    case 'CASH_SALE_SETTLE':
    case 'CASH_SALE_FAIL': {
      const cashSaleId = event.payload.cashSaleId;
      if (!cashSaleId) return { outcome: 'NO_OP', tradeId: null };

      const cashSales = createDefaultCashSaleOrchestrator({
        payments: getPaymentService(),
      });
      const result =
        action.kind === 'CASH_SALE_SETTLE'
          ? await cashSales.settleCashSale({ cashSaleId })
          : await cashSales.failCashSale({ cashSaleId });
      return { outcome: result.ok ? 'SUCCESS' : 'FAILURE', tradeId: null };
    }

    case 'CASH_SALE_REFUND_FAILED': {
      const cashSaleId = event.payload.cashSaleId;
      if (!cashSaleId) return { outcome: 'NO_OP', tradeId: null };

      // Delegated to SQL because the decision (reopen vs merely flag) and the
      // writes have to be one atomic step: a concurrent operator retry must not
      // observe a half-reversed sale.
      const { error } = await client.rpc('record_cash_sale_refund_failure', {
        p_cash_sale_id: cashSaleId,
        p_reason: event.payload.reason ?? null,
      });

      return { outcome: error ? 'FAILURE' : 'SUCCESS', tradeId: null };
    }

    // The `KYC_DECISION` branch used to live here. It wrote `kyc_status` plus the
    // `identity_verified_*` columns from a Stripe Identity summary. Both the action
    // and those writes are gone with the payer gate: the verified legal name now
    // arrives on MERCHANT_COMPLIANCE below and is persisted by
    // `applyComplianceUpdate`, which writes it monotonically so a later report
    // cannot blank a name already disclosed to a Buyer.

    case 'MERCHANT_COMPLIANCE': {
      const merchantRef = event.payload.merchantRef;
      if (!merchantRef) return { outcome: 'NO_OP', tradeId: null };

      const merchants = createDefaultMerchantOnboardingOrchestrator({
        payments: getPaymentService(),
      });
      const result = await merchants.applyComplianceUpdate({
        merchantRef,
        complianceStatus: event.payload.status,
        liveEnabled: event.payload.liveEnabled,
        transactionsEnabled: event.payload.transactionsEnabled,
        settlementsEnabled: event.payload.settlementsEnabled,
        merchantActive: event.payload.merchantActive,
        notes: event.payload.reason,
      });
      return { outcome: result.ok ? 'SUCCESS' : 'FAILURE', tradeId: null };
    }

    // A chargeback. Recorded unconditionally — including when it cannot be
    // attributed to a Trade or Cash_Sale — because the platform is merchant of
    // record and absorbs the loss either way. Never a Trade_State transition: a
    // dispute is a banking event that can land at any point, even after
    // COMPLETED, so forcing a transition would corrupt the machine.
    case 'CHARGE_DISPUTE': {
      const disputeRef = event.payload.disputeId;
      const chargeRef = event.payload.captureId;
      // Without a provider dispute id there is nothing to key idempotency on, so
      // recording it would risk duplicate rows and repeat admin alerts.
      if (!disputeRef || !chargeRef) return { outcome: 'NO_OP', tradeId: null };

      const admin = createAdminClient();
      const { error } = await admin.rpc('record_charge_dispute', {
        p_dispute_ref: disputeRef,
        p_charge_ref: chargeRef,
        p_amount_cents: event.payload.amount ?? 0,
        p_status: event.payload.status ?? 'unknown',
        p_reason: event.payload.reason ?? null,
        p_trade_id: event.payload.tradeId ?? null,
        p_cash_sale_id: event.payload.cashSaleId ?? null,
        p_profile_id: event.payload.profileId ?? null,
        p_evidence_due_by: event.payload.evidenceDueBy ?? null,
        // Only a closed dispute carries a terminal outcome.
        p_outcome: action.phase === 'CLOSED' ? (event.payload.disputeOutcome ?? 'other') : null,
      });

      return {
        outcome: error ? 'FAILURE' : 'SUCCESS',
        tradeId: event.payload.tradeId ?? null,
      };
    }

    case 'NO_OP':
    default:
      return { outcome: 'NO_OP', tradeId: null };
  }
}

/**
 * Result of authenticating a delivery: the internal events to process, plus the
 * provider envelope details used to log a delivery that maps to nothing.
 */
interface AuthenticatedDelivery {
  events: WebhookEvent[];
  /** Set for real provider deliveries so an untranslatable event is still logged. */
  providerEnvelope?: { eventId: string; eventType: string; payload: unknown };
}

/**
 * Verify the delivery and resolve it to internal events.
 *
 * @returns the events on success, or an HTTP `Response` describing the rejection.
 */
function authenticate(
  rawBody: string,
  headers: Headers,
): AuthenticatedDelivery | Response {
  // --- Real Stripe delivery ------------------------------------------------
  const stripeSignature = headers.get(STRIPE_SIGNATURE_HEADER);
  if (stripeSignature) {
    const secrets = readWebhookSecrets();
    if (secrets.length === 0) {
      // Fail closed: without an endpoint secret we cannot prove authenticity.
      return NextResponse.json(
        { ok: false, error: 'webhook secret not configured' },
        { status: 401 },
      );
    }

    // Try every configured secret. A platform needs at least two endpoints —
    // platform events and Connect events are signed with different secrets — and
    // `stripe listen` adds a third locally. A delivery is authentic if ANY of them
    // signed it.
    //
    // The SDK verifies the HMAC over the exact raw bytes AND enforces the replay
    // window, then parses. A null result covers a bad signature, a stale
    // timestamp, and an unparseable body alike — all rejected the same way,
    // without revealing which check failed.
    const client = createStripeClient();
    let event: Stripe.Event | null = null;
    for (const secret of secrets) {
      event = verifyStripeSignature({ client, rawBody, header: stripeSignature, secret });
      if (event) break;
    }
    if (!event) {
      return NextResponse.json({ ok: false, error: 'invalid signature' }, { status: 401 });
    }

    return {
      events: translateStripeEvent(event),
      providerEnvelope: { eventId: event.id, eventType: event.type, payload: event },
    };
  }

  // --- MockService delivery ------------------------------------------------
  // Reject mock-signed envelopes when a real provider is active so demo buttons
  // cannot advance real money flows without a provider signature.
  if (isLivePaymentsProvider()) {
    return NextResponse.json(
      { ok: false, error: 'mock webhooks disabled while a real provider is active' },
      { status: 401 },
    );
  }

  const providedSignature = headers.get(MOCK_SIGNATURE_HEADER);
  const expectedSignature = signWebhookBody(rawBody, WEBHOOK_SECRET);
  if (!providedSignature || !signaturesMatch(expectedSignature, providedSignature)) {
    return NextResponse.json({ ok: false, error: 'invalid signature' }, { status: 401 });
  }

  // Parse only AFTER authenticity is established. A malformed authentic body has
  // no event_id to log against, so we reject it as a bad request.
  let event: WebhookEvent;
  try {
    event = JSON.parse(rawBody) as WebhookEvent;
  } catch {
    return NextResponse.json({ ok: false, error: 'malformed body' }, { status: 400 });
  }
  if (!event?.eventId || !event?.type) {
    return NextResponse.json({ ok: false, error: 'malformed event' }, { status: 400 });
  }

  return { events: [event] };
}

/**
 * Run the full Webhook_Handler pipeline over a raw delivery and return the HTTP
 * `Response` to ack with. Shared by the route handler and the in-process
 * compliance simulator.
 */
export async function handleWebhookDelivery(
  rawBody: string,
  headers: Headers,
): Promise<Response> {
  // 1. AUTHENTICITY — verified over the exact raw bytes, BEFORE any state change
  //    or log write (Req 10.1). A mismatch or missing signature is rejected with
  //    401, applies no side effect, and writes no success log (Req 10.2).
  const authenticated = authenticate(rawBody, headers);
  if (authenticated instanceof Response) return authenticated;

  const client = createAdminClient();
  const { events, providerEnvelope } = authenticated;

  // An authentic provider delivery that carries nothing we act on is logged as a
  // NO_OP against the provider's own event id, keeping the audit trail complete
  // (Req 10.3, 10.7).
  if (events.length === 0) {
    if (providerEnvelope) {
      await writeLog(client, providerEnvelope, 'NO_OP', null);
    }
    return NextResponse.json({ ok: true, outcome: 'NO_OP' }, { status: 200 });
  }

  const outcomes: WebhookOutcome[] = [];
  let dedupedCount = 0;

  for (const event of events) {
    // 2. IDEMPOTENCY — skip events already processed successfully (Req 10.5).
    if (await alreadyProcessed(client, event.eventId)) {
      outcomes.push('SUCCESS');
      dedupedCount += 1;
      continue;
    }

    // 3./4. MAP + DISPATCH.
    const { outcome, tradeId } = await dispatchEvent(client, event);

    // 5. LOG the outcome (Req 10.3, 10.6).
    await writeLog(
      client,
      { eventId: event.eventId, eventType: event.type, payload: event },
      outcome,
      tradeId,
    );
    outcomes.push(outcome);
  }

  // Authentic deliveries are always acked (200); the recorded outcomes
  // distinguish SUCCESS / FAILURE / NO_OP (Req 10.6).
  const aggregate: WebhookOutcome = outcomes.includes('FAILURE')
    ? 'FAILURE'
    : outcomes.includes('SUCCESS')
      ? 'SUCCESS'
      : 'NO_OP';

  return NextResponse.json(
    {
      ok: aggregate !== 'FAILURE',
      outcome: aggregate,
      processed: outcomes.length,
      // True only when every event in the delivery was already processed — the
      // demo UI surfaces this to show idempotent re-delivery (Req 10.5).
      deduped: dedupedCount === outcomes.length,
    },
    { status: 200 },
  );
}
