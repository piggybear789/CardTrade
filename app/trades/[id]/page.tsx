// app/trades/[id]/page.tsx
//
// The real-time Trade Contract view route (Req 11, plus the 6/7/8 actions it
// surfaces). This Server Component:
//   1. Requires an authenticated user (unauthenticated -> sign-in, Req 1.7).
//   2. Loads the Trade under RLS — the participant-read policy grants the row
//      only to the two participating Traders, so a non-participant simply sees
//      no row and is sent to a 404 (Req 9.6, 9.7).
//   3. Derives the caller's role (INITIATOR / COUNTERPART) from the trade row.
//   4. Renders the live client view (TradeContract), which subscribes to
//      realtime updates and drives all interactive behavior.
//
// The Demo panel (task 15.3) is mounted here and passed into TradeContract's
// `demoPanel` slot; it fires simulated collateral webhooks into the real
// Webhook_Handler so the mock trade lifecycle can be driven from the UI.

import { notFound, redirect } from 'next/navigation';

import { ContractBackLink } from '@/components/contract/ContractBackLink';
import { createClient } from '@/lib/supabase/server';
import { TradeContract } from '@/components/trade/TradeContract';
import { getDisputeEvidence } from '@/lib/actions/disputeEvidence';
import { DemoPanel } from '@/components/trade/DemoPanel';
import { LeaveReviewDialog } from '@/components/reviews/LeaveReviewDialog';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { myReviewFor } from '@/lib/actions/reviews';
import { isPaymentDemoEnabled } from '@/domain/services';
import { canReceiveFunds } from '@/domain/orchestrator/merchantOnboarding';
import { createSupabaseMerchantRepository } from '@/domain/orchestrator/supabaseMerchantRepository';
import type { TradeViewerRole } from '@/domain/state-machine/types';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

// Reads the authenticated user's session, so it must render dynamically.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Trade contract · NoDitto',
  description: 'Live contract status and actions for a 2-way trade.',
};

export default async function TradePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: tradeId } = await params;

  const supabase = await createClient();

  // Require authentication (Req 1.7).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/sign-in?redirectTo=/trades/${tradeId}`);
  }

  // RLS grants this read only to the two participants (Req 9.6/9.7); a
  // non-participant (or a missing trade) yields no row -> not found.
  const { data: trade } = await supabase
    .from('trades')
    .select(
      'id, initiator_id, counterpart_id, state, initiator_item_id, counterpart_item_id, cash_amount_cents, cash_direction',
    )
    .eq('id', tradeId)
    .maybeSingle();

  if (!trade) {
    notFound();
  }

  const viewerRole: TradeViewerRole | null =
    trade.initiator_id === user.id
      ? 'INITIATOR'
      : trade.counterpart_id === user.id
        ? 'COUNTERPART'
        : null;

  // Defensive: RLS should already have excluded non-participants.
  if (viewerRole === null) {
    notFound();
  }

  // Compact participant context for the contract workspace (demo-contract-ux
  // Req 2.1): reputation only, never merchant/compliance detail.
  const { data: partyRows } = await supabase
    .from('public_profiles')
    .select('id, display_name, rating, rating_count, is_verified, avatar_path, social_links')
    .in('id', [trade.initiator_id, trade.counterpart_id]);
  const partyById = new Map((partyRows ?? []).map((row) => [row.id as string, row]));
  const partyFor = (id: string) => {
    const row = partyById.get(id);
    return {
      name: (row?.display_name as string | null)?.trim() || 'NoDitto member',
      avatarPath: (row?.avatar_path as string | null) ?? null,
      verified: Boolean(row?.is_verified),
      rating: row?.rating == null ? null : Number(row.rating),
      ratingCount: (row?.rating_count as number | null) ?? 0,
      socialLinks: (row?.social_links as Record<string, string> | null) ?? null,
    };
  };
  const participants = {
    initiator: partyFor(trade.initiator_id),
    counterpart: partyFor(trade.counterpart_id),
  };

  // What was actually agreed. `trade_items` carries every Item on each side for a
  // bundle; a straight 1:1 trade predates that table, so fall back to the two
  // primary Item columns.
  const { data: tradeItemRows } = await supabase
    .from('trade_items')
    .select('trader_id, item_id')
    .eq('trade_id', trade.id);

  const sides = (tradeItemRows ?? []).length
    ? (tradeItemRows ?? []).map((row) => ({
        traderId: row.trader_id as string,
        itemId: row.item_id as string,
      }))
    : [
        { traderId: trade.initiator_id as string, itemId: trade.initiator_item_id as string },
        { traderId: trade.counterpart_id as string, itemId: trade.counterpart_item_id as string },
      ];

  const { data: goodsRows } = await supabase
    .from('items')
    // `listing_kind` decides whether this item's `fmv_cents` may be summed into a
    // side value at all (0081). Without it the room would disclose a fee sized on a
    // whole binder while charging one sized on the bundle.
    .select('id, title, fmv_cents, image_paths, listing_kind')
    .in(
      'id',
      sides.map((entry) => entry.itemId),
    );
  const goodsById = new Map(
    (goodsRows ?? []).map((row) => [
      row.id as string,
      {
        id: row.id as string,
        title: (row.title as string) ?? 'Item',
        fmvCents: (row.fmv_cents as number) ?? 0,
        imagePath: ((row.image_paths as string[] | null) ?? [])[0] ?? null,
        isShopfront: (row.listing_kind as string) === 'SHOPFRONT',
      },
    ]),
  );

  const goods = {
    yours: sides
      .filter((entry) => entry.traderId === user.id)
      .map((entry) => goodsById.get(entry.itemId))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
    theirs: sides
      .filter((entry) => entry.traderId !== user.id)
      .map((entry) => goodsById.get(entry.itemId))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
    // Cash direction is stored on the accepted contract, not inferred from who
    // initiated it: a proposal can now request cash from the Counterpart.
    cashAmountCents: (trade.cash_amount_cents as number) ?? 0,
    cashDirection:
      (trade.cash_direction as string) === 'COUNTERPART_PAYS'
        ? trade.counterpart_id === user.id
          ? ('outgoing' as const)
          : ('incoming' as const)
        : trade.initiator_id === user.id
          ? ('outgoing' as const)
          : ('incoming' as const),
  };

  // Cash may be agreed before the receiver can take payouts — surface that in
  // the contract room so settlement is an explicit later step, not a surprise.
  let cashReceiverPayoutReady = true;
  if (goods.cashAmountCents > 0) {
    const cashReceiverId =
      (trade.cash_direction as string) === 'COUNTERPART_PAYS'
        ? (trade.initiator_id as string)
        : (trade.counterpart_id as string);
    const receiver = await createSupabaseMerchantRepository().loadMerchant(
      cashReceiverId,
    );
    cashReceiverPayoutReady = canReceiveFunds(receiver);
  }

  // Participant evidence (0082). Only fetched for a trade that has actually been
  // disputed — every other trade would pay for a query guaranteed to return nothing.
  const disputeEvidence =
    trade.state === 'DISPUTED' || trade.state === 'FRAUD_RESOLVED'
      ? await getDisputeEvidence('TRADE', trade.id).then((result) =>
          result.ok ? result.data.entries : [],
        )
      : [];

  // Post-transaction review affordance: once the trade is COMPLETED, either
  // participant may review the other trader (unless already reviewed).
  let reviewSection: React.ReactNode = null;
  if (trade.state === 'COMPLETED') {
    const counterpartyId =
      trade.initiator_id === user.id
        ? trade.counterpart_id
        : trade.initiator_id;

    const [{ data: counterparty }, existingReview] = await Promise.all([
      supabase
        .from('public_profiles')
        .select('display_name')
        .eq('id', counterpartyId)
        .maybeSingle(),
      myReviewFor('trade', trade.id),
    ]);
    const counterpartyName =
      (counterparty?.display_name as string | null) ?? 'the other trader';

    reviewSection = (
      <div className="mt-6 flex flex-col items-stretch gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium">Rate this trade</p>
          <p className="text-xs text-muted-foreground">
            Share how it went with {counterpartyName}.
          </p>
        </div>
        {existingReview ? (
          <span className="text-sm text-muted-foreground sm:shrink-0">
            Reviewed
          </span>
        ) : (
          <LeaveReviewDialog
            revieweeId={counterpartyId}
            revieweeName={counterpartyName}
            sourceType="trade"
            sourceId={trade.id}
          />
        )}
      </div>
    );
  }

  return (
    <MarketplaceShell title="Trade">
      <ContractBackLink fallbackHref="/trades" />
      <TradeContract
        tradeId={trade.id}
        initiatorId={trade.initiator_id}
        counterpartId={trade.counterpart_id}
        viewerRole={viewerRole}
        goods={goods}
        participants={participants}
        cashReceiverPayoutReady={cashReceiverPayoutReady}
        demoPanel={
          isPaymentDemoEnabled() ? <DemoPanel tradeId={trade.id} /> : null
        }
        disputeEvidence={disputeEvidence}
      />
      {reviewSection}
    </MarketplaceShell>
  );
}
