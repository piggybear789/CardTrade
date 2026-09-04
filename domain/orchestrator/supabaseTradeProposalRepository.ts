// domain/orchestrator/supabaseTradeProposalRepository.ts
//
// The concrete, production wiring of the trade-proposal data-access seam
// (`TradeProposalRepository`), backed by the service-role Supabase admin client
// (which bypasses RLS — a valid proposal must create the Trade, reserve items,
// and record holds via this trusted path). Mirrors
// `supabaseTradeRepository.ts`.
//
// This binding is kept OUT of `tradeProposal.ts` on purpose: that coordination
// module must stay importable by the domain tests (in-memory fake) without
// pulling in `server-only`/Supabase. Only this file carries the server-only
// dependency.

import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { satisfiesIdentityGate, type IdentityCheckStatus } from '../identity/identityGate';
import type { PreAuthHold } from '../services/types';
import type { TradeRecord } from './tradeOrchestrator';
import {
  proposeTrade,
  createCollateralSideEffects,
  type CreateTradeParams,
  type HoldRecordInput,
  type ItemRecord,
  type ProfileRecord,
  type ProposeTradeParams,
  type ProposeTradeResult,
  type RecordedHold,
  type TradeProposalDeps,
  type TradeProposalRepository,
} from './tradeProposal';
import type { PaymentService } from '../services/types';
import type { RunSideEffects } from './tradeOrchestrator';

/** The Supabase admin client type (service-role, RLS-bypassing). */
type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Build a {@link TradeProposalRepository} backed by the Supabase admin client.
 *
 * Column mapping (see `supabase/migrations/0001_schema.sql`,
 * `0005_merchant_onboarding.sql`):
 * - profiles: `id`, `merchant_status`, `payer_id`
 * - items:    `id`, `owner_id`, `fmv_cents`, `status`
 * - trades:   `initiator_id`, `counterpart_id`, `initiator_item_id`,
 *             `counterpart_item_id`, `state`, `version`
 * - pre_auth_holds: `trade_id`, `trader_id`, `hold_ref`, `amount_cents`, `status`
 */
export function createSupabaseTradeProposalRepository(
  client: AdminClient = createAdminClient(),
): TradeProposalRepository {
  return {
    async getProfile(profileId: string): Promise<ProfileRecord | null> {
      const { data } = await client
        .from('profiles')
        .select('id, identity_check_status, payer_id')
        .eq('id', profileId)
        .maybeSingle();
      if (!data) return null;
      const row = data as {
        id: string;
        identity_check_status: string;
        payer_id: string | null;
      };
      // Answered by the gate module, never re-derived here. This line used to read
      // `row.merchant_status === 'APPROVED'` inline and omit settlements, which is a
      // second answer to a question that must have exactly one — the shape of the bug
      // that broke buying. It was inert only because `resolveTradeBonds` discards
      // `verified`; the next caller that trusted it would not have been so lucky.
      return {
        id: row.id,
        verified: satisfiesIdentityGate({
          identityCheckStatus: row.identity_check_status as IdentityCheckStatus,
        }),
        payerId: row.payer_id,
      };
    },

    async getItem(itemId: string): Promise<ItemRecord | null> {
      const { data } = await client
        .from('items')
        // `listing_kind` is not cosmetic here: it decides whether this item's
        // `fmv_cents` may be summed into a side value at all (0081).
        .select('id, owner_id, fmv_cents, status, listing_kind')
        .eq('id', itemId)
        .maybeSingle();
      if (!data) return null;
      const row = data as {
        id: string;
        owner_id: string;
        fmv_cents: number;
        status: ItemRecord['status'];
        listing_kind: NonNullable<ItemRecord['listingKind']>;
      };
      return {
        id: row.id,
        ownerId: row.owner_id,
        fmvCents: Number(row.fmv_cents),
        status: row.status,
        listingKind: row.listing_kind,
      };
    },

    async createTrade(params: CreateTradeParams): Promise<TradeRecord> {
      const { data, error } = await client
        .from('trades')
        .insert({
          initiator_id: params.initiatorId,
          counterpart_id: params.counterpartId,
          initiator_item_id: params.initiatorItemId,
          counterpart_item_id: params.counterpartItemId,
          state: 'COLLATERAL_PENDING',
          version: 0,
        })
        .select('*')
        .single();
      if (error || !data) {
        throw new Error(`Failed to create trade: ${error?.message ?? 'no row returned'}`);
      }
      return data as TradeRecord;
    },

    async reserveItems(itemIds: string[]): Promise<void> {
      if (itemIds.length === 0) return;
      // A SHOPFRONT is never reserved (0064). Several members hold their own
      // contracts against one binder, and `items_catalog_select` treats
      // availability as VISIBILITY — so reserving it would delete the binder from
      // the catalog for everybody else. Filtered here as well as in
      // `begin_trade_collateral`, because both paths reach the same rows.
      await client
        .from('items')
        .update({ status: 'RESERVED' })
        .in('id', itemIds)
        .neq('listing_kind', 'SHOPFRONT');
    },

    async restoreItems(itemIds: string[]): Promise<void> {
      if (itemIds.length === 0) return;
      // Deliberately unfiltered: a binder is already AVAILABLE, so this is a no-op
      // on one. Excluding it would only mean a future non-shopfront path silently
      // skipping a restore.
      await client.from('items').update({ status: 'AVAILABLE' }).in('id', itemIds);
    },

    async recordHold(hold: HoldRecordInput): Promise<void> {
      await client.from('pre_auth_holds').insert({
        trade_id: hold.tradeId,
        trader_id: hold.traderId,
        hold_ref: hold.holdRef,
        amount_cents: hold.amountCents,
        status: hold.status,
        // Persisted so the expiry reconciler can find holds the provider is
        // about to release. Null only for non-expiring providers.
        expires_at: hold.expiresAt ?? null,
      });
    },

    async getHolds(tradeId: string): Promise<RecordedHold[]> {
      const { data } = await client
        .from('pre_auth_holds')
        .select('trade_id, trader_id, hold_ref, amount_cents, status')
        .eq('trade_id', tradeId)
        .order('created_at', { ascending: true });
      const rows = (data ?? []) as Array<{
        trade_id: string;
        trader_id: string;
        hold_ref: string;
        amount_cents: number;
        status: PreAuthHold['status'];
      }>;
      return rows.map((row) => ({
        tradeId: row.trade_id,
        traderId: row.trader_id,
        holdRef: row.hold_ref,
        amountCents: Number(row.amount_cents),
        status: row.status,
      }));
    },

    async listTradeItemIds(tradeId: string): Promise<string[]> {
      const { data } = await client
        .from('trade_items')
        .select('item_id')
        .eq('trade_id', tradeId);
      return ((data ?? []) as { item_id: string }[]).map((row) => row.item_id);
    },

    async markHoldStatus(holdRef: string, status: PreAuthHold['status']): Promise<void> {
      await client.from('pre_auth_holds').update({ status }).eq('hold_ref', holdRef);
    },
  };
}

/**
 * Convenience production binding for proposing a Trade: wires the Supabase-backed
 * repository to the injected {@link PaymentService} and delegates to the pure
 * {@link proposeTrade}.
 */
export function proposeTradeWithSupabase(
  payments: PaymentService,
  params: ProposeTradeParams,
  overrides: Partial<TradeProposalDeps> = {},
): Promise<ProposeTradeResult> {
  const deps: TradeProposalDeps = {
    repository: overrides.repository ?? createSupabaseTradeProposalRepository(),
    payments: overrides.payments ?? payments,
  };
  return proposeTrade(deps, params);
}

/**
 * Build the collateral cancellation {@link RunSideEffects} hook (Req 5.6) backed
 * by the Supabase repository, ready to inject into the guarded transition core
 * (`createDefaultTradeOrchestrator({ runSideEffects, payments })`).
 */
export function createSupabaseCollateralSideEffects(
  client: AdminClient = createAdminClient(),
): RunSideEffects {
  return createCollateralSideEffects(createSupabaseTradeProposalRepository(client));
}
