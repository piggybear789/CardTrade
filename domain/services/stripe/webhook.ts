// domain/services/stripe/webhook.ts
//
// Signature verification and event translation for real Stripe deliveries
// (Req 10.1, 10.2, 10.4, 10.5).
//
// Two jobs, both pure-ish and directly unit testable:
//
//   verifyStripeSignature  - HMAC over `{timestamp}.{rawBody}` from the
//                            `stripe-signature` header, with a replay window.
//   translateStripeEvent   - Stripe event envelope -> internal `WebhookEvent`s.
//
// Translation leans on the CardTrade metadata stamped on every PaymentIntent by
// `StripeService`: Stripe reports "a PaymentIntent succeeded" and we decide
// whether that means a Friction_Tax capture cleared or a Cash_Sale settled. A
// PaymentIntent created outside `StripeService` carries no metadata, is
// unroutable, and translates to nothing (a logged NO_OP, never an error).
//
// Two simplifications versus the Pinch pipeline: Stripe gives every delivery a
// single stable event id, so the composite `{eventId}:{paymentId}` dedupe key a
// fan-out `bank-results` delivery required is unnecessary; and the SDK owns the
// HMAC comparison, so there is no hand-rolled constant-time compare here.

import type Stripe from 'stripe';

import type { WebhookEvent, WebhookEventPayload, WebhookEventType } from '../types';
import { decodeMetadata, type CardTradeMetadata } from './metadata';

/** Header carrying `t=<unix>,v1=<hmac>` on real Stripe deliveries. */
export const STRIPE_SIGNATURE_HEADER = 'stripe-signature';

/** Stripe's own default replay window, in seconds. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * Verify a delivery and return the parsed Stripe event.
 *
 * Delegates to the SDK, which recomputes the HMAC over the exact raw bytes and
 * enforces the replay window. Returns `null` on any failure — bad signature,
 * stale timestamp, or unparseable body — so the caller can answer 401 without
 * distinguishing between them.
 *
 * @param rawBody the exact request body bytes; re-serialising breaks the HMAC.
 */
export function verifyStripeSignature(params: {
  client: Stripe;
  rawBody: string;
  header: string;
  secret: string;
  toleranceSeconds?: number;
}): Stripe.Event | null {
  try {
    return params.client.webhooks.constructEvent(
      params.rawBody,
      params.header,
      params.secret,
      // Seconds, not milliseconds. Passing a ms value here silently widens the
      // replay window to days and defeats the check.
      params.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS,
    );
  } catch {
    return null;
  }
}

/**
 * Translate a Stripe event into zero or more internal `WebhookEvent`s.
 *
 * Zero means "not ours" or "nothing to do" and must be treated as a NO_OP.
 */
export function translateStripeEvent(event: Stripe.Event): WebhookEvent[] {
  const occurredAt = new Date(event.created * 1000).toISOString();

  const build = (type: WebhookEventType, payload: WebhookEventPayload): WebhookEvent[] => [
    { eventId: event.id, type, occurredAt, payload },
  ];

  switch (event.type) {
    // --- Collateral holds --------------------------------------------------

    // The authorised-but-uncaptured signal: a manual-capture PaymentIntent has
    // funds available to capture, i.e. the hold is live (Req 5.5).
    case 'payment_intent.amount_capturable_updated': {
      const intent = event.data.object as Stripe.PaymentIntent;
      const meta = decodeMetadata(intent.metadata);
      if (!meta || meta.kind !== 'HOLD') return [];
      return build('hold.active', {
        ...refPayload(meta),
        holdId: intent.id,
        amount: intent.amount_capturable,
        status: intent.status,
      });
    }

    case 'payment_intent.canceled': {
      const intent = event.data.object as Stripe.PaymentIntent;
      const meta = decodeMetadata(intent.metadata);
      if (!meta || meta.kind !== 'HOLD') return [];
      // Covers both an explicit voidHold and an authorisation Stripe expired on
      // our behalf once `capture_before` passed (Req 6.7, 7.5, 8.5).
      return build('hold.voided', {
        ...refPayload(meta),
        holdId: intent.id,
        amount: intent.amount,
        status: intent.status,
        ...(intent.cancellation_reason ? { reason: intent.cancellation_reason } : {}),
      });
    }

    case 'payment_intent.succeeded': {
      const intent = event.data.object as Stripe.PaymentIntent;
      const meta = decodeMetadata(intent.metadata);
      if (!meta) return [];

      if (meta.kind === 'TRANSFER') {
        return build('transfer.settled', {
          ...refPayload(meta),
          transferId: intent.id,
          amount: intent.amount_received,
          status: intent.status,
        });
      }

      // A captured hold. Capturing less than the authorised amount is the
      // Friction_Tax (Req 7.2, 7.3); capturing all of it is fraud (Req 8.2).
      const partial = intent.amount_received < intent.amount;
      return build(partial ? 'capture.partial.settled' : 'capture.full.settled', {
        ...refPayload(meta),
        holdId: intent.id,
        captureId: chargeIdOf(intent),
        amount: intent.amount_received,
        status: intent.status,
      });
    }

    case 'payment_intent.payment_failed': {
      const intent = event.data.object as Stripe.PaymentIntent;
      const meta = decodeMetadata(intent.metadata);
      if (!meta) return [];
      const reason =
        intent.last_payment_error?.message ??
        intent.last_payment_error?.code ??
        'Payment failed at the provider';

      // Same provider event, two internal meanings — which is precisely why the
      // metadata is stamped on creation (Req 4.4, 5.6).
      return meta.kind === 'HOLD'
        ? build('hold.failed', {
            ...refPayload(meta),
            holdId: intent.id,
            amount: intent.amount,
            status: intent.status,
            reason,
          })
        : build('transfer.failed', {
            ...refPayload(meta),
            transferId: intent.id,
            amount: intent.amount,
            status: intent.status,
            reason,
          });
    }

    // A capture that cleared authorisation but failed to settle (Req 7.6, 8.6).
    case 'charge.failed': {
      const charge = event.data.object as Stripe.Charge;
      const meta = decodeMetadata(charge.metadata);
      if (!meta || meta.kind !== 'HOLD') return [];
      return build('capture.failed', {
        ...refPayload(meta),
        holdId: typeof charge.payment_intent === 'string' ? charge.payment_intent : undefined,
        captureId: charge.id,
        amount: charge.amount,
        status: charge.status,
        reason: charge.failure_message ?? charge.failure_code ?? 'Capture failed to settle',
      });
    }

    // --- Chargebacks -------------------------------------------------------

    // A payer disputed a charge with their card issuer. Translated WITHOUT the
    // usual `if (!meta) return []` bail-out: an unattributable chargeback is
    // still real money leaving the platform balance, so it has to be recorded
    // even when the metadata is missing or the charge was created outside
    // StripeService. Dropping it would make the loss invisible.
    case 'charge.dispute.created': {
      const dispute = event.data.object as Stripe.Dispute;
      const meta = decodeMetadata(dispute.metadata) ?? disputeChargeMetadata(dispute);
      return build('charge.disputed', {
        ...(meta ? refPayload(meta) : {}),
        disputeId: dispute.id,
        captureId: typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id,
        amount: dispute.amount,
        status: dispute.status,
        reason: dispute.reason,
        ...(dispute.evidence_details?.due_by
          ? {
              evidenceDueBy: new Date(dispute.evidence_details.due_by * 1000).toISOString(),
            }
          : {}),
      });
    }

    case 'charge.dispute.closed': {
      const dispute = event.data.object as Stripe.Dispute;
      const meta = decodeMetadata(dispute.metadata) ?? disputeChargeMetadata(dispute);
      return build('charge.dispute.closed', {
        ...(meta ? refPayload(meta) : {}),
        disputeId: dispute.id,
        captureId: typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id,
        amount: dispute.amount,
        status: dispute.status,
        disputeOutcome: disputeOutcomeOf(dispute.status),
        reason: dispute.reason,
      });
    }

    // --- Dispute refunds -----------------------------------------------------

    // A refund is reported SETTLED as soon as Stripe accepts it, including while
    // `pending`, so this is the only signal that one later failed at the bank. Only
    // the failure is translated: a `pending` to `succeeded` transition confirms what
    // was already recorded and needs no work.
    case 'charge.refund.updated': {
      const refund = event.data.object as Stripe.Refund;
      if (refund.status !== 'failed') return [];
      const meta = decodeMetadata(refund.metadata);
      return build('refund.failed', {
        ...(meta?.cashSaleId ? { cashSaleId: meta.cashSaleId } : {}),
        amount: refund.amount,
        status: refund.status,
        reason: refund.failure_reason ?? 'The refund was returned by the bank',
      });
    }

    // Stripe Identity events (`identity.verification_session.*`) were translated
    // here into `kyc.verified` / `kyc.rejected`. Both are gone with the payer
    // gate: identity is now reported by `account.updated` below, which is the same
    // event that decides payability. An Identity event arriving now falls through
    // to the default branch and is a logged NO_OP, which is the correct handling
    // for an event type we no longer route.

    // --- Seller payout onboarding ------------------------------------------

    case 'account.updated': {
      const account = event.data.object as Stripe.Account;
      // `payouts_enabled` is the only flag that means money can actually ARRIVE,
      // so it is what gates `merchant_status = APPROVED`. `charges_enabled` is
      // irrelevant for a recipient account that never accepts payments itself.
      return build('merchant.compliance.updated', {
        merchantRef: account.id,
        profileId: profileIdOf(account.metadata),
        status: account.requirements?.disabled_reason ?? undefined,
        merchantActive: account.payouts_enabled === true,
        settlementsEnabled: account.payouts_enabled === true,
        transactionsEnabled: account.charges_enabled === true,
        liveEnabled: account.payouts_enabled === true,
      });
    }

    default:
      return [];
  }
}

/** Entity ids recovered from the stamped metadata. */
function refPayload(meta: CardTradeMetadata): WebhookEventPayload {
  return {
    ...(meta.tradeId ? { tradeId: meta.tradeId } : {}),
    ...(meta.cashSaleId ? { cashSaleId: meta.cashSaleId } : {}),
    ...(meta.profileId ? { profileId: meta.profileId } : {}),
  };
}

function chargeIdOf(intent: Stripe.PaymentIntent): string | undefined {
  const charge = intent.latest_charge;
  if (typeof charge === 'string') return charge;
  return charge?.id ?? undefined;
}

function profileIdOf(metadata: Stripe.Metadata | null | undefined): string | undefined {
  const value = metadata?.cardtrade_profile_id;
  return typeof value === 'string' && value.trim() ? value : undefined;
}

// `payerIdOf` was removed here. It read `cardtrade_payer_id` off provider metadata to
// route events by payer, which nothing has needed since the payer gate was retired —
// routing is by profile, trade or sale. Left in place it would have looked like a
// supported routing key.

/**
 * Recover CardTrade context for a dispute.
 *
 * A Dispute carries no metadata we set — we stamp PaymentIntents, not disputes.
 * When Stripe expands `dispute.charge` the charge's metadata is available, which
 * is the same map copied down from the intent. Returns `null` when the charge is
 * an unexpanded id, in which case the dispute is still reported but without
 * trade/sale attribution.
 */
function disputeChargeMetadata(dispute: Stripe.Dispute): CardTradeMetadata | null {
  if (typeof dispute.charge === 'string') return null;
  return decodeMetadata(dispute.charge?.metadata);
}

/**
 * Collapse Stripe's dispute status into the terminal outcome.
 *
 * Only `won` and `lost` are genuinely terminal; a closed dispute in any other
 * status (notably the `warning_*` early-fraud-warning states) has not moved
 * money, so it must not be reported as a loss.
 */
function disputeOutcomeOf(
  status: Stripe.Dispute['status'],
): NonNullable<WebhookEventPayload['disputeOutcome']> {
  if (status === 'won') return 'won';
  if (status === 'lost') return 'lost';
  if (status === 'warning_closed') return 'warning_closed';
  return 'other';
}
