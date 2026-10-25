// lib/trades/handoverChanges.ts
//
// Handover change PROPOSALS on a COLLATERAL_PENDING trade (ESC-04, design ESC-04).
//
// Once terms are agreed, the meeting is what collateral will be placed against, so
// one trader may no longer move it alone. Before the placement cutoff (and while no
// hold is ACTIVE) they may PROPOSE a change; the other trader accepts or declines. At
// most one undecided proposal per trade (partial unique index, 0133). Undecided
// proposals lapse at the current meeting's placement cutoff, expired by the `:17` job.
//
// Terms are validated at proposal AND again at acceptance: the cutoff may have passed
// in between, and a proposal that no longer validates is refused and marked EXPIRED.
//
// `server-only`. The Server Actions that call this live in `lib/actions/trades.ts`.

import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { createNotification } from '@/lib/notifications/createNotification';
import { logBackgroundFailure } from '@/lib/errors/errorLog';
import type { HandoverTermsColumns } from '@/lib/handover/terms';
import {
  handoverEditMode,
  proposalExpiry,
  proposalMeetingIsPlaceable,
} from '@/domain/fulfilment/handoverEdits';
import type { TradeState } from '@/domain/state-machine/types';

type AdminClient = ReturnType<typeof createAdminClient>;

export type HandoverChangeError =
  | 'invalid-state'
  | 'invalid-terms'
  | 'proposal-open'
  | 'not-found'
  | 'not-permitted'
  | 'persistence-error';

export type HandoverChangeResult<T = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: HandoverChangeError; detail?: string };

/** One proposal row as the room renders it. */
export interface HandoverChangeRow {
  id: string;
  trade_id: string;
  proposed_by: string;
  terms: HandoverTermsColumns;
  created_at: string;
  expires_at: string;
}

/** Whether any hold on the trade is a live authorisation. Throws on a read error. */
export async function tradeHasActiveHold(client: AdminClient, tradeId: string): Promise<boolean> {
  const { data, error } = await client
    .from('pre_auth_holds')
    .select('hold_ref')
    .eq('trade_id', tradeId)
    .eq('status', 'ACTIVE')
    .limit(1);
  if (error) throw new Error(`[handover change] holds: ${error.message}`);
  return (data ?? []).length > 0;
}

async function loadTrade(client: AdminClient, tradeId: string) {
  const { data, error } = await client
    .from('trades')
    .select('id, state, meeting_at, initiator_id, counterpart_id')
    .eq('id', tradeId)
    .maybeSingle();
  if (error) throw new Error(`[handover change] trade: ${error.message}`);
  return data as
    | { id: string; state: TradeState; meeting_at: string | null; initiator_id: string; counterpart_id: string }
    | null;
}

/** Open a proposal. The caller has already validated `terms` and the participant. */
export async function proposeHandoverChange(params: {
  tradeId: string;
  proposerId: string;
  terms: HandoverTermsColumns;
  now?: Date;
  client?: AdminClient;
}): Promise<HandoverChangeResult<{ changeId: string }>> {
  const client = params.client ?? createAdminClient();
  const now = params.now ?? new Date();
  const trade = await loadTrade(client, params.tradeId);
  if (!trade) return { ok: false, error: 'not-found' };
  const mode = handoverEditMode({
    state: trade.state,
    meetingAt: trade.meeting_at,
    hasActiveHold: await tradeHasActiveHold(client, params.tradeId),
    now,
  });
  if (mode !== 'PROPOSAL') return { ok: false, error: 'invalid-state' };
  if (!proposalMeetingIsPlaceable(params.terms.meeting_at, now)) {
    return { ok: false, error: 'invalid-terms', detail: 'The new meeting is too soon for the card holds to be placed.' };
  }

  const { data, error } = await client
    .from('trade_handover_changes')
    .insert({
      trade_id: params.tradeId,
      proposed_by: params.proposerId,
      terms: { ...params.terms },
      expires_at: proposalExpiry(trade.meeting_at, params.terms.meeting_at, now),
    })
    .select('id')
    .single();
  if (error) {
    // 23505: the partial unique index — an undecided proposal already exists.
    if ((error as { code?: string }).code === '23505') return { ok: false, error: 'proposal-open' };
    return { ok: false, error: 'persistence-error', detail: error.message };
  }

  const otherId = params.proposerId === trade.initiator_id ? trade.counterpart_id : trade.initiator_id;
  await createNotification({
    userId: otherId,
    type: 'TRADE',
    title: 'New meeting details proposed',
    body: 'The other trader proposed a different meeting place or time. Nothing changes unless you accept.',
    link: `/trades/${params.tradeId}`,
  });
  return { ok: true, changeId: (data as { id: string }).id };
}

async function loadOpenChange(client: AdminClient, changeId: string) {
  const { data, error } = await client
    .from('trade_handover_changes')
    .select('id, trade_id, proposed_by, terms, created_at, expires_at, decided_at')
    .eq('id', changeId)
    .maybeSingle();
  if (error) throw new Error(`[handover change] load: ${error.message}`);
  const row = data as unknown as (HandoverChangeRow & { decided_at: string | null }) | null;
  return row && !row.decided_at ? row : null;
}

async function decide(
  client: AdminClient,
  changeId: string,
  decision: 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'WITHDRAWN',
  decidedBy: string | null,
  now: Date,
): Promise<boolean> {
  const { data, error } = await client
    .from('trade_handover_changes')
    .update({ decision, decided_at: now.toISOString(), decided_by: decidedBy })
    .eq('id', changeId)
    .is('decided_at', null)
    .select('id');
  if (error) throw new Error(`[handover change] decide: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * Accept or decline. Only the NON-proposing participant may respond. Accept
 * re-validates and applies the terms in one UPDATE guarded on COLLATERAL_PENDING with
 * no ACTIVE hold; the `trades_lock_handover` trigger backs the same rule.
 */
export async function respondToHandoverChange(params: {
  changeId: string;
  responderId: string;
  decision: 'ACCEPT' | 'DECLINE';
  now?: Date;
  client?: AdminClient;
}): Promise<HandoverChangeResult<{ tradeId: string }>> {
  const client = params.client ?? createAdminClient();
  const now = params.now ?? new Date();
  const change = await loadOpenChange(client, params.changeId);
  if (!change) return { ok: false, error: 'not-found' };
  const trade = await loadTrade(client, change.trade_id);
  if (!trade) return { ok: false, error: 'not-found' };
  if (params.responderId !== trade.initiator_id && params.responderId !== trade.counterpart_id) {
    return { ok: false, error: 'not-permitted' };
  }
  if (params.responderId === change.proposed_by) return { ok: false, error: 'not-permitted' };

  if (params.decision === 'DECLINE') {
    await decide(client, change.id, 'DECLINED', params.responderId, now);
    await createNotification({
      userId: change.proposed_by,
      type: 'TRADE',
      title: 'Meeting change declined',
      body: 'The other trader kept the original meeting details.',
      link: `/trades/${trade.id}`,
    });
    return { ok: true, tradeId: trade.id };
  }

  const mode = handoverEditMode({
    state: trade.state,
    meetingAt: trade.meeting_at,
    hasActiveHold: await tradeHasActiveHold(client, trade.id),
    now,
  });
  if (mode !== 'PROPOSAL' || !proposalMeetingIsPlaceable(change.terms.meeting_at, now)) {
    await decide(client, change.id, 'EXPIRED', null, now);
    return { ok: false, error: 'invalid-terms', detail: 'This change can no longer be applied: the meeting is too close.' };
  }

  const { data: applied, error } = await client
    .from('trades')
    .update({ ...change.terms, updated_at: now.toISOString() })
    .eq('id', trade.id)
    .eq('state', 'COLLATERAL_PENDING')
    .select('id');
  if (error) return { ok: false, error: 'persistence-error', detail: error.message };
  if ((applied ?? []).length === 0) return { ok: false, error: 'invalid-state' };
  await decide(client, change.id, 'ACCEPTED', params.responderId, now);
  await createNotification({
    userId: change.proposed_by,
    type: 'TRADE',
    title: 'Meeting change accepted',
    body: 'The other trader accepted the new meeting details.',
    link: `/trades/${trade.id}`,
  });
  return { ok: true, tradeId: trade.id };
}

/** The proposer withdraws their own undecided proposal. */
export async function withdrawHandoverChange(params: {
  changeId: string;
  proposerId: string;
  now?: Date;
  client?: AdminClient;
}): Promise<HandoverChangeResult<{ tradeId: string }>> {
  const client = params.client ?? createAdminClient();
  const change = await loadOpenChange(client, params.changeId);
  if (!change) return { ok: false, error: 'not-found' };
  if (change.proposed_by !== params.proposerId) return { ok: false, error: 'not-permitted' };
  await decide(client, change.id, 'WITHDRAWN', params.proposerId, params.now ?? new Date());
  return { ok: true, tradeId: change.trade_id };
}

/** The `:17` pass: lapse undecided proposals whose cutoff has passed. */
export async function expireHandoverChangeProposals(now: Date = new Date()): Promise<{ expired: number }> {
  const client = createAdminClient();
  const { data, error } = await client
    .from('trade_handover_changes')
    .update({ decision: 'EXPIRED', decided_at: now.toISOString() })
    .is('decided_at', null)
    .lte('expires_at', now.toISOString())
    .select('id, trade_id');
  if (error) {
    await logBackgroundFailure({ name: 'trade.handover_change_expiry', errorCode: 'WRITE_FAILED', error });
    throw new Error(`[handover change] expire: ${error.message}`);
  }
  return { expired: (data ?? []).length };
}
