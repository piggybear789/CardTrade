// domain/webhook/mapEventToAction.ts
//
// The pure event → action mapping for the Webhook_Handler (Req 10.4, 10.7).
//
// This module has NO I/O and NO Supabase/React/service dependencies - it is a
// framework-free classifier so tasks 9.2/9.3/9.4 can exhaustively test the
// mapping in isolation. Given a decoded `WebhookEvent`, it decides WHICH kind of
// downstream action the handler should take (a Trade_State transition, a
// Cash_Sale update, a KYC status update, or a no-op). The concrete id
// resolution (which Trade / which Cash_Sale) and dispatch live in the route
// handler, which owns the persistence seam.

import type { WebhookEvent } from '../services/types';
import type { TradeEvent } from '../state-machine/types';

/**
 * A classified webhook action. The handler switches on `kind`:
 * - `TRADE_EVENT`      - dispatch `tradeEvent` through the Trade State Machine
 *                        via the orchestrator (Req 10.4).
 * - `CASH_SALE_SETTLE` - settle the referenced Cash_Sale (Req 4.3).
 * - `CASH_SALE_FAIL`   - fail the referenced Cash_Sale (Req 4.4).
 * - `MERCHANT_COMPLIANCE` - apply a provider compliance decision to a sub-merchant.
 * - `NO_OP`            - an authentic event that maps to no state change (Req 10.7).
 */
export type WebhookAction =
  | { kind: 'TRADE_EVENT'; tradeEvent: TradeEvent }
  | { kind: 'CASH_SALE_SETTLE' }
  | { kind: 'CASH_SALE_FAIL' }
  | { kind: 'MERCHANT_COMPLIANCE' }
  | { kind: 'NO_OP' };

/**
 * Map a `WebhookEvent` to the action the Webhook_Handler should take.
 *
 * The mapping is total: every `WebhookEventType` resolves to a concrete action,
 * and any unrecognized type falls through to `NO_OP` so an authentic-but-unknown
 * event is acknowledged and logged as a no-op rather than erroring (Req 10.7).
 *
 * Notes on the ambiguous cases:
 * - `transfer.settled` / `transfer.failed` are used for BOTH Cash_Sale
 *   settlement/failure (Req 4.3, 4.4) and the fraud-payout transfer to the
 *   victim (Req 8.3). Only a Cash_Sale needs a follow-up state change here, so
 *   the event is a Cash_Sale action when it carries a `cashSaleId` and a `NO_OP`
 *   otherwise (the fraud payout's state was already committed by the fraud
 *   orchestrator).
 * - `hold.voided` and every `capture.*` event are dispute/fraud FOLLOW-UPS whose
 *   Trade_State transition (DISPUTED / FRAUD_RESOLVED / COMPLETED) is driven by
 *   the user-initiated orchestrator flow, not the webhook. They therefore map to
 *   `NO_OP` - recorded and acknowledged without a further transition (Req 10.7).
 */
export function mapEventToAction(event: WebhookEvent): WebhookAction {
  switch (event.type) {
    // Collateral holds -> the COLLATERAL_PENDING lifecycle transitions (Req 5.5, 5.6).
    case 'hold.active':
      return { kind: 'TRADE_EVENT', tradeEvent: 'HOLDS_CONFIRMED' };
    case 'hold.failed':
      return { kind: 'TRADE_EVENT', tradeEvent: 'HOLDS_FAILED' };

    // Bank transfers -> Cash_Sale settlement/failure when a sale is referenced;
    // otherwise a fraud payout that needs no further transition (Req 4.3, 4.4, 8.3).
    case 'transfer.settled':
      return event.payload.cashSaleId ? { kind: 'CASH_SALE_SETTLE' } : { kind: 'NO_OP' };
    case 'transfer.failed':
      return event.payload.cashSaleId ? { kind: 'CASH_SALE_FAIL' } : { kind: 'NO_OP' };

    // Identity verification outcomes: the standalone KYC payer check is
    // retired (verification is now provider-approved Managed Merchant
    // onboarding, handled via `merchant.compliance.updated` below), so these
    // event types are acknowledged and logged without a further transition.
    case 'kyc.verified':
    case 'kyc.rejected':
      return { kind: 'NO_OP' };

    // A sub-merchant compliance decision: routed to the merchant onboarding
    // orchestrator, which decides APPROVED/REJECTED/PENDING from the flags.
    case 'merchant.compliance.updated':
      return event.payload.merchantRef ? { kind: 'MERCHANT_COMPLIANCE' } : { kind: 'NO_OP' };

    // Dispute/fraud follow-ups: no webhook-driven Trade_State transition (Req 10.7).
    case 'hold.voided':
    case 'capture.partial.settled':
    case 'capture.full.settled':
    case 'capture.failed':
      return { kind: 'NO_OP' };

    default:
      return { kind: 'NO_OP' };
  }
}
