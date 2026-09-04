// lib/trades/collateralPlacement.ts
//
// Placing a Trade's collateral, and everything that has to happen in the same breath.
//
// WHY IT MOVED OUT OF `tradeNegotiation.ts`. Collateral used to be authorised inside
// `acceptTradeTerms`, in the same request that agreed the terms. It is now placed a
// day before the MEETING instead, by a scheduled pass — so the sequence has two
// callers with nothing else in common: a member pressing retry, and a cron with no
// session at all.
//
// AND IT COULD NOT SIMPLY BE EXPORTED. `tradeNegotiation.ts` carries `'use server'`,
// which makes every export an endpoint addressable by anyone who learns its id.
// Exporting the fee charge or the bond placement from there would put "charge both
// traders" and "authorise both cards" on the public surface. This module is
// `server-only` and has no such door; the same reasoning already keeps
// `inspectionSweep` out of the action layer.
//
// WHY THE WHOLE SEQUENCE IS ONE FUNCTION rather than pieces the callers assemble.
// The order is load-bearing and was got wrong once already: bonds are placed BEFORE
// the fee is charged, so a trade whose card declines is never billed. An earlier
// version returned success regardless of what the provider said and charged both
// traders 5% on a declined card. Anything that can place collateral has to come
// through here.

import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { readIdentityGate, identityGateMessage } from '@/lib/identityGate';
import { getPaymentService, isLivePaymentsProvider } from '@/domain/services';
import {
  placeBondsForAgreedTrade,
  currentHoldsAreActive,
  currentHoldsSeekFailed,
} from '@/domain/orchestrator/tradeProposal';
import { resolveTradeSideValues } from '@/domain/trade/tradeSideValues';
import { chargeTradeFees, refundTradeFees } from '@/lib/actions/tradeFees';
import { createSupabaseTradeProposalRepository } from '@/domain/orchestrator/supabaseTradeProposalRepository';
import { createDefaultTradeOrchestrator } from '@/domain/orchestrator/supabaseTradeRepository';
import { regionForTrade } from '@/lib/regionBinding';
import type { Tables } from '@/lib/supabase/database.types';

type TradeRow = Tables<'trades'>;

/** Why collateral could not be placed. Each maps to copy the caller owns. */
export type CollateralPlacementError =
  | 'not-found'
  | 'not-pending'
  | 'not-verified'
  | 'payer-not-found'
  | 'hold-failed'
  | 'side-unvalued'
  | 'failed';

export type CollateralPlacementResult =
  | { ok: true; alreadyActive: boolean }
  | { ok: false; error: CollateralPlacementError; message: string };

/** Every Item a given Trader is putting into a Trade. */
export async function itemIdsFor(tradeId: string, traderId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('trade_items')
    .select('item_id')
    .eq('trade_id', tradeId)
    .eq('trader_id', traderId);
  return ((data ?? []) as { item_id: string }[]).map((row) => row.item_id);
}

/**
 * Charge both traders the Trade_Fee once collateral is actually in place.
 *
 * Never called before {@link placeTradeCollateral} has a live hold, which is the
 * whole of "no exchange, no fee".
 */
async function chargeFeesForAgreedTrade(trade: TradeRow): Promise<void> {
  const admin = createAdminClient();
  const sideGoods = async (traderId: string) => {
    const ids = await itemIdsFor(trade.id, traderId);
    if (ids.length === 0) return { goodsCents: 0, hasShopfront: false };
    const { data } = await admin
      .from('items')
      .select('fmv_cents, listing_kind')
      .in('id', ids);
    const rows = (data ?? []) as { fmv_cents: number | null; listing_kind: string }[];
    return {
      goodsCents: rows.reduce((sum, row) => sum + Number(row.fmv_cents ?? 0), 0),
      hasShopfront: rows.some((row) => row.listing_kind === 'SHOPFRONT'),
    };
  };
  const [initiatorSide, counterpartSide] = await Promise.all([
    sideGoods(trade.initiator_id),
    sideGoods(trade.counterpart_id),
  ]);
  const { initiatorSideCents: initiatorGives, counterpartSideCents: counterpartGives } =
    resolveTradeSideValues({
      initiatorGoodsCents: initiatorSide.goodsCents,
      counterpartGoodsCents: counterpartSide.goodsCents,
      counterpartIsShopfront: counterpartSide.hasShopfront,
    });
  const cash = Number(trade.cash_amount_cents ?? 0);
  const initiatorPaysCash = trade.cash_direction === 'PROPOSER_PAYS';
  const fees = await chargeTradeFees({
    tradeId: trade.id,
    initiatorId: trade.initiator_id,
    counterpartId: trade.counterpart_id,
    initiatorReceivesCents: counterpartGives + (initiatorPaysCash ? 0 : cash),
    counterpartReceivesCents: initiatorGives + (initiatorPaysCash ? cash : 0),
  });
  if (fees.anyFailed) {
    console.warn(
      `[collateral] trade ${trade.id}: at least one Trade_Fee did not collect; ` +
        'left FAILED for the retry drain.',
    );
  }
}

/**
 * Drive the transition from the hold rows rather than waiting for a webhook.
 *
 * Stripe authorisations resolve synchronously, so the answer is already on file by
 * the time this runs.
 */
export async function syncHolds(tradeId: string, actorId: string): Promise<void> {
  const admin = createAdminClient();
  const holds = await createSupabaseTradeProposalRepository(admin).getHolds(tradeId);
  if (holds.length === 0) return;
  const orchestrator = createDefaultTradeOrchestrator({
    payments: getPaymentService(await regionForTrade(tradeId)),
  });
  // Only the latest hold per trader counts. A retry leaves the declined row on
  // file, and treating it as current would confirm a successful retry as failed.
  if (currentHoldsAreActive(holds)) {
    await orchestrator.applyEvent({ tradeId, event: 'HOLDS_CONFIRMED', actorId });
    return;
  }
  if (currentHoldsSeekFailed(holds)) {
    await orchestrator.applyEvent({ tradeId, event: 'HOLDS_FAILED', actorId });
  }
}

/**
 * Authorise both traders' cards for a Trade waiting in COLLATERAL_PENDING, charge
 * the Trade_Fee, and advance the state machine.
 *
 * `actorId` names who is recorded on the resulting audit rows. A scheduled pass has
 * no actor, so it passes the initiator and lets the event name carry the real cause —
 * the same convention `sweepTradeInspections` uses for a deadline nobody decided.
 *
 * Idempotent enough to be retried: a trade whose current holds are already ACTIVE is
 * confirmed rather than authorised a second time.
 */
export async function placeTradeCollateral(params: {
  tradeId: string;
  actorId: string;
}): Promise<CollateralPlacementResult> {
  const { tradeId, actorId } = params;
  const admin = createAdminClient();

  const { data } = await admin.from('trades').select('*').eq('id', tradeId).maybeSingle();
  const trade = data as TradeRow | null;
  if (!trade) return { ok: false, error: 'not-found', message: 'That trade no longer exists.' };
  if (trade.state !== 'COLLATERAL_PENDING') {
    return {
      ok: false,
      error: 'not-pending',
      message: 'Collateral is not waiting to be placed on this trade.',
    };
  }

  // Both sides must still pass the Identity_Gate. Checked HERE and not only at
  // agreement, because placement can now be days later and a ban in between must
  // stop the trade rather than be discovered after the cards are authorised.
  for (const partyId of [trade.initiator_id, trade.counterpart_id]) {
    const gate = await readIdentityGate(partyId);
    if (!gate.satisfied) {
      return {
        ok: false,
        error: 'not-verified',
        message:
          partyId === actorId
            ? identityGateMessage('trade', gate.state)
            : 'The other trader has not finished identity verification, so this trade cannot lock.',
      };
    }
  }

  const repository = createSupabaseTradeProposalRepository(admin);
  const payments = getPaymentService(await regionForTrade(tradeId));
  const orchestrator = createDefaultTradeOrchestrator({ payments });
  const existing = await repository.getHolds(tradeId);

  // Already authorised and just never confirmed — the process died between placing
  // and syncing. Confirm rather than authorise a second card hold.
  if (currentHoldsAreActive(existing)) {
    await orchestrator.applyEvent({ tradeId, event: 'HOLDS_CONFIRMED', actorId });
    return { ok: true, alreadyActive: true };
  }

  // A crashed attempt could leave one side ACTIVE while the other failed. Release
  // those before placing again so two authorisations cannot sit on one card.
  for (const hold of existing) {
    if (hold.status === 'ACTIVE') {
      await payments.voidHold(hold.holdRef);
      await repository.markHoldStatus(hold.holdRef, 'VOIDED');
    }
  }

  const initiatorItemIds = await itemIdsFor(tradeId, trade.initiator_id);
  const counterpartItemIds = await itemIdsFor(tradeId, trade.counterpart_id);
  await repository.reserveItems([...initiatorItemIds, ...counterpartItemIds]);

  const bonds = await placeBondsForAgreedTrade(
    { repository, payments },
    {
      tradeId,
      initiatorId: trade.initiator_id,
      counterpartId: trade.counterpart_id,
      initiatorItemIds,
      counterpartItemIds,
    },
  );

  if (!bonds.ok) {
    // HOLDS_FAILED loops back to COLLATERAL_PENDING on purpose, so a member can
    // replace their card and retry without renegotiating.
    await orchestrator.applyEvent({ tradeId, event: 'HOLDS_FAILED', actorId });
    // Nothing has been charged at this point — the fee is collected below, after
    // bonds — but call it anyway so the path stays correct if that order changes.
    await refundTradeFees(tradeId);
    return {
      ok: false,
      error:
        bonds.error === 'payer-not-found'
          ? 'payer-not-found'
          : bonds.error === 'hold-failed'
            ? 'hold-failed'
            : bonds.error === 'side-unvalued'
              ? 'side-unvalued'
              : 'failed',
      message:
        bonds.error === 'payer-not-found'
          ? 'A saved card is needed to place the trade collateral hold. Add one, then retry.'
          : bonds.error === 'side-unvalued'
            ? 'One side of this trade has no value against it, so there is nothing to hold collateral against.'
            : bonds.error === 'hold-failed'
              ? 'A card declined the collateral hold. Nothing was charged. Replace the card, then retry.'
              : 'Collateral could not be arranged. Nothing was charged.',
    };
  }

  // The Commitment_Point. Charged only now, so a trade that cannot get collateral
  // is never billed.
  await chargeFeesForAgreedTrade(trade);

  if (bonds.bondsRequired === 0) {
    // Nobody owes a bond, so no provider event will ever arrive to confirm one.
    await orchestrator.applyEvent({ tradeId, event: 'HOLDS_CONFIRMED', actorId });
  } else if (isLivePaymentsProvider()) {
    await syncHolds(tradeId, actorId);
  }

  return { ok: true, alreadyActive: false };
}
