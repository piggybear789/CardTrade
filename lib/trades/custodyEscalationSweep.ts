// lib/trades/custodyEscalationSweep.ts
//
// The custody backstop (design §1.2, ESC-01): on every DISPUTED trade, capture each
// live hold into the platform balance shortly before it would lapse, so a slow staff
// decision cannot destroy the remedy. Runs in the `:17` job, AFTER the hold-expiry
// re-estimate, because it keys on `expires_at`.
//
// - Selection is the pure `holdsToEscalate` (every live hold by default; staff may
//   narrow to the accused). A hold with no expiry is never taken.
// - The capture is the one `custodyCaptureHold` operation, shared with a pending fraud
//   finding, so the two cannot race into a double capture.
// - A failure is logged (`collateral.custody_capture` / CUSTODY_CAPTURE_FAILED, which
//   is unexpected), the trade is flagged by the coordinator, and the next hour retries.
// - Both traders get ONE pre-warning a day before the capture point
//   (`custody_warned_at`).
//
// `server-only`, not a Server Action.

import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { createNotification } from '@/lib/notifications/createNotification';
import { logBackgroundFailure } from '@/lib/errors/errorLog';
import { regionForCurrency } from '@/lib/regionBinding';
import {
  holdsToEscalate,
  holdsToWarn,
  type CustodyScope,
  type EscalationHold,
} from '@/domain/dispute/custodyEscalation';
import type { TradeState } from '@/domain/state-machine/types';
import { createLoggedDisputeOrchestrator } from './disputeOrchestrator';

const MAX_TRADES_PER_PASS = 100;

export interface CustodyEscalationResult {
  considered: number;
  captured: number;
  warned: number;
  failed: number;
}

/** Run one backstop pass over disputed trades. Never throws per trade. */
export async function sweepCustodyEscalation(now: Date = new Date()): Promise<CustodyEscalationResult> {
  const admin = createAdminClient();
  const result: CustodyEscalationResult = { considered: 0, captured: 0, warned: 0, failed: 0 };

  const { data, error } = await admin
    .from('trades')
    .select('id, state, initiator_id, counterpart_id, custody_scope, custody_accused_id, currency')
    .eq('state', 'DISPUTED')
    .order('disputed_at', { ascending: true })
    .limit(MAX_TRADES_PER_PASS);
  if (error) throw new Error(`[custody sweep] list: ${error.message}`);

  for (const row of (data ?? []) as Array<{
    id: string;
    state: TradeState;
    initiator_id: string;
    counterpart_id: string;
    custody_scope: CustodyScope | null;
    custody_accused_id: string | null;
    currency: string | null;
  }>) {
    result.considered += 1;
    try {
      const { data: holdRows, error: holdError } = await admin
        .from('pre_auth_holds')
        .select('trader_id, hold_ref, status, created_at, custody_captured_at, expires_at, custody_warned_at')
        .eq('trade_id', row.id)
        .order('created_at', { ascending: true });
      if (holdError) throw new Error(holdError.message);

      const typed = ((holdRows ?? []) as Array<{
        trader_id: string;
        hold_ref: string | null;
        status: EscalationHold['status'];
        created_at: string | null;
        custody_captured_at: string | null;
        expires_at: string | null;
        custody_warned_at: string | null;
      }>).filter((h) => h.hold_ref);
      const holds: EscalationHold[] = typed.map((h) => ({
        traderId: h.trader_id,
        holdRef: h.hold_ref as string,
        status: h.status,
        createdAt: h.created_at,
        custodyCapturedAt: h.custody_captured_at,
        expiresAt: h.expires_at,
      }));
      const trade = {
        state: row.state,
        initiatorId: row.initiator_id,
        counterpartId: row.counterpart_id,
        custodyScope: row.custody_scope ?? 'ALL',
        accusedId: row.custody_accused_id,
      };

      // The one-time warning, a day ahead of the capture point.
      const warnedAlready = new Set(typed.filter((h) => h.custody_warned_at).map((h) => h.hold_ref));
      const toWarn = holdsToWarn(trade, holds, now).filter((ref) => !warnedAlready.has(ref));
      if (toWarn.length > 0) {
        for (const userId of [row.initiator_id, row.counterpart_id]) {
          await createNotification({
            userId,
            type: 'TRADE',
            title: 'Trade collateral will be held tomorrow',
            body:
              'This trade is still under review and a temporary card hold on it expires soon. ' +
              'About a day from now we will charge it as a safeguard while staff decide; it is ' +
              'refunded or paid out when the case is decided.',
            link: `/trades/${row.id}`,
          });
        }
        const { error: warnError } = await admin
          .from('pre_auth_holds')
          .update({ custody_warned_at: now.toISOString() })
          .in('hold_ref', toWarn);
        if (warnError) throw new Error(warnError.message);
        result.warned += toWarn.length;
      }

      const due = holdsToEscalate(trade, holds, now);
      if (due.length === 0) continue;
      const coordinator = createLoggedDisputeOrchestrator(regionForCurrency(row.currency));
      for (const holdRef of due) {
        const captured = await coordinator.custodyCaptureHold({ tradeId: row.id, holdRef, reason: 'EXPIRY_BACKSTOP' });
        if (captured.ok) {
          result.captured += captured.alreadyCaptured ? 0 : 1;
        } else {
          result.failed += 1;
          await logBackgroundFailure({
            name: 'collateral.custody_capture',
            errorCode: 'CUSTODY_CAPTURE_FAILED',
            message: `Custody capture refused: ${captured.error}${captured.detail ? ` (${captured.detail})` : ''}`,
            context: { tradeId: row.id },
          });
        }
      }
    } catch (error) {
      result.failed += 1;
      await logBackgroundFailure({
        name: 'collateral.custody_capture',
        errorCode: 'THREW',
        error,
        context: { tradeId: row.id },
      });
    }
  }
  return result;
}
