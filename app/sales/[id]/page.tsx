// app/sales/[id]/page.tsx
//
// The cash-sale contract room (Req 4). A Server Component that authenticates the
// caller, loads the sale under participant-only RLS plus an explicit guard, and
// hands a snapshot to the live client room. Reviews unlock on completion.

import { notFound, redirect } from 'next/navigation';

import { CashSaleView, type SaleParty } from '@/components/sales/CashSaleView';
import { ContractBackLink } from '@/components/contract/ContractBackLink';
import { getDisputeEvidence } from '@/lib/actions/disputeEvidence';
import { LeaveReviewDialog } from '@/components/reviews/LeaveReviewDialog';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { myReviewFor } from '@/lib/actions/reviews';
import { isPaymentDemoEnabled } from '@/domain/services';
import { isTrackingStatusPollingAvailable } from '@/domain/services/tracking';
import { CASH_SALE_PUBLIC_SELECT } from '@/lib/supabase/cashSaleProjection';
import { createClient } from '@/lib/supabase/server';
import type { Tables } from '@/lib/supabase/database.types';

export const metadata = {
  title: 'Purchase contract · NoDitto',
};

export const dynamic = 'force-dynamic';

export default async function CashSalePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/sign-in?redirectTo=/sales/${id}`);
  }

  // RLS restricts this to the buyer and seller; the explicit check below keeps
  // authorization enforced twice.
  const { data } = await supabase
    .from('cash_sales')
    .select(CASH_SALE_PUBLIC_SELECT)
    .eq('id', id)
    .maybeSingle();

  const sale = data as Tables<'cash_sales'> | null;
  if (!sale || (sale.buyer_id !== user.id && sale.seller_id !== user.id)) {
    notFound();
  }

  // Reputation for both parties. Ratings come from the catalog-safe view; the
  // completed-sale counts come from an aggregate-only function, so neither party
  // gains read access to the other's sale rows.
  const [
    { data: profiles },
    buyerStats,
    sellerStats,
    { data: deliveryDetails },
    { data: lineItemRows },
  ] = await Promise.all([
    supabase
      .from('public_profiles')
      .select('id, display_name, rating, rating_count, is_verified, avatar_path')
      .in('id', [sale.buyer_id, sale.seller_id]),
    supabase.rpc('member_sale_stats', { p_profile_id: sale.buyer_id }),
    supabase.rpc('member_sale_stats', { p_profile_id: sale.seller_id }),
    // RLS returns this to the buyer throughout, and to the seller only after
    // collection succeeds. It is intentionally not a Realtime subscription.
    supabase
      .from('cash_sale_delivery_details')
      .select('address_label, place_id, country_code, latitude, longitude')
      .eq('cash_sale_id', sale.id)
      .maybeSingle(),
    // What this contract covers (0064). Participant-scoped by RLS, and empty for
    // a single-item sale whose goods are the item snapshot on the sale itself.
    // Not a Realtime subscription: every change to a line also rewrites
    // `agreed_price_cents`, so the sale row's own event already signals it.
    supabase
      .from('cash_sale_items')
      .select('id, description, condition, quantity, unit_price_cents, sort_order')
      .eq('cash_sale_id', sale.id)
      .order('sort_order', { ascending: true }),
  ]);

  const lineItems = (lineItemRows ?? []).map((row) => ({
    id: row.id,
    description: row.description,
    condition: row.condition,
    quantity: row.quantity,
    unitPriceCents: row.unit_price_cents,
  }));

  // Participant evidence (0082). Only fetched for a contract that has actually been
  // disputed — every other sale would pay for a query guaranteed to return nothing.
  // The action is participant-scoped by RLS, so this is safe for either side to call.
  const disputeEvidence =
    sale.status === 'DISPUTED' || sale.dispute_resolution
      ? await getDisputeEvidence('CASH_SALE', sale.id).then((result) =>
          result.ok ? result.data.entries : [],
        )
      : [];

  const profileById = new Map(
    (profiles ?? []).map((profile) => [profile.id as string, profile]),
  );

  const statsFor = (result: { data: unknown }) => {
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    const stats = row as
      | { completed_sales: number | null; completed_purchases: number | null }
      | null
      | undefined;
    return {
      completedSales: stats?.completed_sales ?? 0,
      completedPurchases: stats?.completed_purchases ?? 0,
    };
  };

  const partyFor = (
    userId: string,
    role: SaleParty['role'],
    stats: { completedSales: number; completedPurchases: number },
  ): SaleParty => {
    const profile = profileById.get(userId);
    const rating = profile?.rating as number | string | null | undefined;
    return {
      id: userId,
      name: (profile?.display_name as string | null)?.trim() || 'NoDitto member',
      avatarPath: (profile?.avatar_path as string | null) ?? null,
      role,
      verified: Boolean(profile?.is_verified),
      rating: rating === null || rating === undefined ? null : Number(rating),
      ratingCount: (profile?.rating_count as number | null) ?? 0,
      completedSales: stats.completedSales,
      completedPurchases: stats.completedPurchases,
      // Only the seller carries a provider-approved legal identity snapshot.
      ...(role === 'Seller'
        ? {
            legalEntityName: sale.seller_legal_entity_name,
            registrationNumber: sale.seller_registration_number,
            identityVerifiedAt: sale.seller_identity_verified_at,
          }
        : {}),
    };
  };

  const buyer = partyFor(sale.buyer_id, 'Buyer', statsFor(buyerStats));
  const seller = partyFor(sale.seller_id, 'Seller', statsFor(sellerStats));
  const counterpartyId = sale.buyer_id === user.id ? sale.seller_id : sale.buyer_id;
  const counterparty = counterpartyId === buyer.id ? buyer : seller;

  const deliveryAddress = deliveryDetails
    ? {
        label: deliveryDetails.address_label,
        placeId: deliveryDetails.place_id,
        countryCode: deliveryDetails.country_code,
        lat: deliveryDetails.latitude,
        lng: deliveryDetails.longitude,
      }
    : null;

  const existingReview =
    sale.status === 'COMPLETED' ? await myReviewFor('cash_sale', sale.id) : null;

  return (
    // Title matches the viewer's side of the contract: the buyer is making a
    // purchase, not a sale.
    <MarketplaceShell
      title={sale.buyer_id === user.id ? 'Purchase' : 'Sale'}
    >
      <ContractBackLink fallbackHref="/purchases" />
      <CashSaleView
        initialSale={sale}
        myUserId={user.id}
        buyer={buyer}
        seller={seller}
        conversationId={sale.conversation_id}
        deliveryAddress={deliveryAddress}
        trackingRefreshAvailable={isTrackingStatusPollingAvailable()}
        paymentDemoEnabled={isPaymentDemoEnabled()}
        lineItems={lineItems}
        disputeEvidence={disputeEvidence}
      />

      {sale.status === 'COMPLETED' ? (
        <div className="mt-6 flex flex-col items-stretch gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">Rate this transaction</p>
            <p className="text-xs text-muted-foreground">
              Share how it went with {counterparty.name}.
            </p>
          </div>
          {existingReview ? (
            <span className="shrink-0 text-sm text-muted-foreground">Reviewed</span>
          ) : (
            <LeaveReviewDialog
              revieweeId={counterpartyId}
              revieweeName={counterparty.name}
              sourceType="cash_sale"
              sourceId={sale.id}
            />
          )}
        </div>
      ) : null}

    </MarketplaceShell>
  );
}
