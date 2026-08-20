// domain/orchestrator/supabaseCashSaleRepository.ts
// Supabase binding for the bilateral Cash_Sale orchestrator (Req 4).
// All writes use the service-role client and therefore repeat participant/state
// checks in the pure orchestrator plus conditional expected-state updates here.

import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Tables, TablesUpdate } from '@/lib/supabase/database.types';
import { createPayoutNotifier } from '@/lib/notifications/payoutNotifier';
import { getTrackingService } from '@/domain/services/tracking';
import { operationalRegions } from '@/domain/services';
import {
  createCashSaleOrchestrator,
  platformFeeCentsFor,
  type BuyerRecord,
  type CashSaleOrchestrator,
  type CashSaleOrchestratorDeps,
  type CashSaleDisputeOutcome,
  type CashSalePayoutStatus,
  type CashSaleLineItem,
  type CashSaleLineItemDraft,
  type CashSaleRecord,
  type CashSaleRepository,
  type CreateCashSaleParams,
  type ItemRecord,
  type ItemStatus,
} from './cashSaleOrchestrator';
import type { MerchantRecord } from './merchantOnboarding';

type AdminClient = ReturnType<typeof createAdminClient>;
type CashSaleRow = Tables<'cash_sales'>;
type LineItemRow = Pick<
  Tables<'cash_sale_items'>,
  'id' | 'description' | 'condition' | 'quantity' | 'unit_price_cents' | 'image_path' | 'sort_order'
>;

/** Map one contract line row to the aggregate shape (0064). */
function toLineItem(row: LineItemRow): CashSaleLineItem {
  return {
    id: row.id,
    description: row.description,
    condition: row.condition,
    quantity: row.quantity,
    unitPriceCents: row.unit_price_cents,
    imagePath: row.image_path,
    sortOrder: row.sort_order,
  };
}

/**
 * Shape contract lines for the `jsonb` argument both RPCs take.
 *
 * Snake_case keys because the SQL reads them with `line->>'unit_price_cents'`;
 * array order becomes `sort_order` on the way in, so the member's ordering
 * survives a round trip.
 */
function toLineItemPayload(
  lines: readonly CashSaleLineItemDraft[],
): { description: string; condition: string | null; quantity: number; unit_price_cents: number; image_path: string | null }[] {
  return lines.map((line) => ({
    description: line.description,
    condition: line.condition ?? null,
    quantity: line.quantity,
    unit_price_cents: line.unitPriceCents,
    image_path: line.imagePath ?? null,
  }));
}

type ProfileRow = Pick<
  Tables<'profiles'>,
  | 'id'
  | 'payer_id'
  | 'payment_source_id'
  | 'display_name'
  | 'contact_email'
  | 'payment_token_type'
  | 'region_code'
>;

/** Map one database row to the provider-independent aggregate. */
function toCashSale(row: CashSaleRow): CashSaleRecord {
  return {
    id: row.id,
    itemId: row.item_id,
    itemTitle: row.item_title ?? 'your item',
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    amountCents: row.amount_cents,
    agreedPriceCents: row.agreed_price_cents,
    platformFeeCents: row.platform_fee_cents,
    status: row.status,
    fromShopfront: row.from_shopfront ?? false,
    version: row.version,
    transferId: row.transfer_id,
    paymentNonce: row.payment_nonce,
    paymentRequestedAt: row.payment_requested_at,
    paymentSettledAt: row.payment_settled_at,
    fulfillmentMethod: row.fulfillment_method,
    shippingCostCents: row.shipping_cost_cents,
    shippingNotes: row.shipping_notes,
    deliveryAddressConfigured: row.delivery_address_configured,
    meetingLocation: row.meeting_location,
    meetingLat: row.meeting_lat,
    meetingLng: row.meeting_lng,
    meetingPlaceId: row.meeting_place_id,
    meetingAt: row.meeting_at,
    termsVersion: row.terms_version,
    buyerTermsAcceptedVersion: row.buyer_terms_accepted_version,
    sellerTermsAcceptedVersion: row.seller_terms_accepted_version,
    buyerTermsAcceptedAt: row.buyer_terms_accepted_at,
    sellerTermsAcceptedAt: row.seller_terms_accepted_at,
    trackingCarrier: row.tracking_carrier,
    trackingNumber: row.tracking_number,
    trackingUrl: row.tracking_url,
    trackingStatus: row.tracking_status,
    shippedAt: row.shipped_at,
    receivedAt: row.received_at,
    inspectionAcceptedAt: row.inspection_accepted_at,
    carrierDeliveredAt: row.carrier_delivered_at,
    inspectionDeadlineAt: row.inspection_deadline_at,
    // Return leg (0088), kept separate from the outbound fields above.
    returnTrackingCarrier: row.return_tracking_carrier,
    returnTrackingNumber: row.return_tracking_number,
    returnTrackingUrl: row.return_tracking_url,
    returnTrackingStatus: row.return_tracking_status,
    returnShippedAt: row.return_shipped_at,
    returnCarrierDeliveredAt: row.return_carrier_delivered_at,
    returnDeadlineAt: row.return_deadline_at,
    returnWarnedAt: row.return_warned_at,
    returnDisputedAt: row.return_disputed_at,
    returnDisputeReason: row.return_dispute_reason,
    returnLapsedAt: row.return_lapsed_at,
    autoCompleted: row.auto_completed,
    buyerHandoverConfirmedAt: row.buyer_handover_confirmed_at,
    sellerHandoverConfirmedAt: row.seller_handover_confirmed_at,
    completedAt: row.completed_at,
    conversationId: row.conversation_id,
    sellerIdentity: {
      sellerId: row.seller_id,
      version: row.seller_identity_version ?? '',
      legalEntityName: row.seller_legal_entity_name ?? '',
      // FALSE BECAUSE THE SNAPSHOT DOES NOT RECORD PROVENANCE, not because this
      // seller's name was self-stated. `cash_sales` freezes
      // `seller_legal_entity_name` alone, with no column saying which of the two
      // sources it came from, so the honest value here is "cannot prove a document
      // check" — and the conservative direction is the safe one, since the failure
      // mode of `true` is telling a buyer a government document backs a name the
      // seller typed.
      //
      // Nothing renders a claim from this today: `ContractPartyLine` prints the name
      // bare, with no "verified"/"real" label. If the contract room ever needs to
      // make that claim, this needs a real `seller_identity_name_document_verified`
      // snapshot column plus its entry in `CASH_SALE_PUBLIC_SELECT` — do not soften
      // it to `true` here instead.
      nameIsDocumentVerified: false,
      tradingName: row.seller_trading_name,
      organisationType: row.seller_organisation_type,
      verifiedAt: row.seller_identity_verified_at ?? '',
    },
    buyerSellerIdentityConfirmedAt: row.buyer_seller_identity_confirmed_at ?? '',
    sellerPayoutStatus: row.seller_payout_status ?? 'NOT_DUE',
    sellerPayoutRef: row.seller_payout_ref ?? null,
    sellerPayoutNonce: row.seller_payout_nonce ?? null,
    sellerPayoutAttempts: Number(row.seller_payout_attempts ?? 0),
    disputedBy: row.disputed_by ?? null,
    disputeResolution: (row.dispute_resolution ?? null) as CashSaleRecord['disputeResolution'],
    disputeResolvedAt: row.dispute_resolved_at ?? null,
    disputeResolvedBy: row.dispute_resolved_by ?? null,
    refundCents: Number(row.refund_cents ?? 0),
    refundStatus: (row.refund_status ?? 'NOT_DUE') as CashSalePayoutStatus,
    refundRef: row.refund_ref ?? null,
    refundNonce: row.refund_nonce ?? null,
    refundAttempts: Number(row.refund_attempts ?? 0),
  };
}

async function selectSale(
  client: AdminClient,
  cashSaleId: string,
): Promise<CashSaleRecord | null> {
  const { data } = await client
    .from('cash_sales')
    .select('*')
    .eq('id', cashSaleId)
    .maybeSingle();
  return data ? toCashSale(data as CashSaleRow) : null;
}

async function guardedUpdate(
  client: AdminClient,
  cashSaleId: string,
  expectedStatus: CashSaleRecord['status'],
  patch: TablesUpdate<'cash_sales'>,
): Promise<CashSaleRecord | null> {
  const { data } = await client
    .from('cash_sales')
    .update(patch)
    .eq('id', cashSaleId)
    .eq('status', expectedStatus)
    .select('*')
    .maybeSingle();
  return data ? toCashSale(data as CashSaleRow) : null;
}

/** Build the service-role repository. */
export function createSupabaseCashSaleRepository(
  client: AdminClient = createAdminClient(),
): CashSaleRepository {
  return {
    async loadBuyer(buyerId: string): Promise<BuyerRecord | null> {
      const { data } = await client
        .from('profiles')
        .select(
          'id, payer_id, payment_source_id, display_name, contact_email, payment_token_type, region_code',
        )
        .eq('id', buyerId)
        .maybeSingle();
      const row = data as ProfileRow | null;
      return row
        ? {
            profileId: row.id,
            payerId: row.payer_id,
            paymentSourceId: row.payment_source_id,
            displayName: row.display_name,
            contactEmail: row.contact_email,
            paymentTokenType: row.payment_token_type,
            regionCode: row.region_code,
          }
        : null;
    },
    async loadSellerPayee(sellerId: string): Promise<MerchantRecord | null> {
      const { data } = await client
        .from('profiles')
        .select(
          'id, merchant_ref, merchant_status, merchant_compliance_status, merchant_live_enabled, merchant_transactions_enabled, merchant_settlements_enabled, merchant_legal_entity_name, merchant_trading_name, merchant_registration_number, merchant_organisation_type, merchant_identity_version, merchant_identity_disclosure_consented_at, merchant_identity_verified_at, identity_check_status, identity_check_name, identity_check_verified_at, fraud_banned_at',
        )
        .eq('id', sellerId)
        .maybeSingle();
      if (!data) return null;
      return {
        profileId: data.id,
        merchantRef: data.merchant_ref,
        merchantStatus: data.merchant_status,
        complianceStatus: data.merchant_compliance_status,
        liveEnabled: data.merchant_live_enabled,
        transactionsEnabled: data.merchant_transactions_enabled,
        settlementsEnabled: data.merchant_settlements_enabled,
        legalEntityName: data.merchant_legal_entity_name,
        tradingName: data.merchant_trading_name,
        registrationNumber: data.merchant_registration_number,
        organisationType: data.merchant_organisation_type,
        identityVersion: data.merchant_identity_version,
        identityDisclosureConsentedAt: data.merchant_identity_disclosure_consented_at,
        identityVerifiedAt: data.merchant_identity_verified_at,
        identityCheckStatus: (data.identity_check_status as MerchantRecord['identityCheckStatus']) ?? undefined,
        identityCheckName: data.identity_check_name,
        identityCheckVerifiedAt: data.identity_check_verified_at,
        fraudBannedAt: data.fraud_banned_at,
      };
    },

    // A Stripe Customer belongs to the PLATFORM and can pay any connected
    // account, so a single `profiles.payer_id` serves every payee. The former
    // provider scoped payers to the merchant they were created under, which is
    // why these two methods used to consult a (profile, merchant) mapping table.
    // The table is gone (migration 0028); the buyer's own payer id is the answer
    // regardless of which seller is being paid.
    async findPayerRef({ profileId }) {
      const { data } = await client
        .from('profiles')
        .select('payer_id')
        .eq('id', profileId)
        .maybeSingle();
      return data?.payer_id ?? null;
    },

    async savePayerRef(params) {
      await client
        .from('profiles')
        .update({ payer_id: params.payerId })
        .eq('id', params.profileId);
    },

    async loadItem(itemId: string): Promise<ItemRecord | null> {
      const { data } = await client
        .from('items')
        .select(
          'id, owner_id, fmv_cents, status, listing_kind, closed_at, title, description, condition, image_paths',
        )
        .eq('id', itemId)
        .maybeSingle();
      if (!data) return null;

      // The OWNER's trading region, read separately rather than as an embedded
      // select. `database.types.ts` is hand-maintained, and a typed relational
      // embed against it is easy to get subtly wrong in a way `tsc` accepts and the
      // query then returns as null — which here would read as "region unknown" and
      // silently refuse every contract. One extra round trip, once per contract
      // open, buys a query whose failure mode is an error rather than a wrong answer.
      //
      // Note this is the owner's region, NOT `items.location_country_code`: the
      // listing's country is where the goods are, and the guard is about where the
      // money moves.
      const { data: owner } = await client
        .from('profiles')
        .select('region_code')
        .eq('id', data.owner_id)
        .maybeSingle();

      return {
        id: data.id,
        ownerId: data.owner_id,
        fmvCents: data.fmv_cents,
        status: data.status,
        listingKind: data.listing_kind,
        closedAt: data.closed_at,
        title: data.title,
        description: data.description,
        condition: data.condition,
        imagePaths: data.image_paths,
        ownerRegionCode: owner?.region_code ?? null,
      };
    },

    async createAgreement(params: CreateCashSaleParams) {
      const { data, error } = await client.rpc('create_cash_sale_agreement', {
        p_item_id: params.itemId,
        p_buyer_id: params.buyerId,
        p_agreed_price_cents: params.agreedPriceCents,
        p_platform_fee_cents: params.platformFeeCents,
        p_seller_identity_version: params.sellerIdentity.version,
        p_seller_legal_entity_name: params.sellerIdentity.legalEntityName,
        p_seller_trading_name: params.sellerIdentity.tradingName,
        // Retired vocabulary, kept only to satisfy the applied RPC signature from
        // 0008. Stripe returns no tax ID, so there is nothing to record.
        p_seller_registration_number: '',
        p_seller_organisation_type: params.sellerIdentity.organisationType,
        p_seller_identity_verified_at: params.sellerIdentity.verifiedAt,
        p_buyer_identity_confirmed_at: params.buyerSellerIdentityConfirmedAt,
        // Written inside the same transaction as the agreement (0064). A shopfront
        // contract must never exist, even momentarily, without saying which goods
        // it covers — otherwise it reads as a contract for the whole binder.
        p_items: params.lineItems ? toLineItemPayload(params.lineItems) : null,
      });
      if (error) {
        if (error.message.includes('own item')) throw new Error('SELF_PURCHASE');
        if (error.message.includes('one_active_per_shopfront_buyer'))
          throw new Error('ALREADY_OPEN');
        throw new Error(`Failed to create agreement: ${error.message}`);
      }
      const row = (data as CashSaleRow[] | null)?.[0];
      return row ? toCashSale(row) : null;
    },

    async loadLineItems(cashSaleId: string): Promise<CashSaleLineItem[]> {
      const { data } = await client
        .from('cash_sale_items')
        .select('id, description, condition, quantity, unit_price_cents, image_path, sort_order')
        .eq('cash_sale_id', cashSaleId)
        .order('sort_order', { ascending: true });
      return ((data ?? []) as LineItemRow[]).map(toLineItem);
    },

    async replaceLineItems({
      cashSaleId,
      actorId,
      expectedTermsVersion,
      lineItems,
      agreedPriceCents,
      platformFeeCents,
    }) {
      const { data, error } = await client.rpc('replace_cash_sale_items', {
        p_cash_sale_id: cashSaleId,
        p_actor_id: actorId,
        p_expected_terms_version: expectedTermsVersion,
        p_items: toLineItemPayload(lineItems),
        p_agreed_price_cents: agreedPriceCents,
        p_platform_fee_cents: platformFeeCents,
      });
      // The RPC returns an empty set for each of its guards (missing sale, not a
      // participant, wrong status, stale version, not a shopfront, no lines) and
      // RAISES only when the caller's total disagrees with the lines — which is a
      // bug, not a member-visible condition, so it is not swallowed here.
      if (error) {
        if (error.message.includes('Line items total')) {
          throw new Error(`Line item total mismatch: ${error.message}`);
        }
        return null;
      }
      const row = (data as CashSaleRow[] | null)?.[0];
      return row ? toCashSale(row) : null;
    },

    loadCashSale(cashSaleId: string) {
      return selectSale(client, cashSaleId);
    },
    async updateTerms({ cashSaleId, actorId, expectedTermsVersion, terms }) {
      const { data, error } = await client.rpc('update_cash_sale_terms', {
        p_cash_sale_id: cashSaleId,
        p_actor_id: actorId,
        p_expected_terms_version: expectedTermsVersion,
        p_fulfillment_method: terms.fulfillmentMethod,
        p_shipping_cost_cents: terms.shippingCostCents,
        p_shipping_notes: terms.shippingNotes,
        p_meeting_location: terms.meetingLocation,
        p_meeting_lat: terms.meetingLat,
        p_meeting_lng: terms.meetingLng,
        p_meeting_place_id: terms.meetingPlaceId,
        p_meeting_at: terms.meetingAt,
        p_delivery_address_label: terms.deliveryAddress?.label ?? null,
        p_delivery_place_id: terms.deliveryAddress?.placeId ?? null,
        p_delivery_country_code: terms.deliveryAddress?.countryCode ?? null,
        p_delivery_lat: terms.deliveryAddress?.lat ?? null,
        p_delivery_lng: terms.deliveryAddress?.lng ?? null,
      });
      if (error) return { ok: false as const, reason: 'UNAVAILABLE' as const };
      const row = (data as CashSaleRow[] | null)?.[0];
      if (row) return { ok: true as const, sale: toCashSale(row) };

      // `update_cash_sale_terms` returns an EMPTY SET for every guard it has:
      // missing sale, wrong status, wrong version, a seller touching the buyer's
      // address, an unresolved place, a meeting time already past. An empty
      // result therefore does not mean "someone else edited this". Re-read the
      // contract and only call it stale when the contract really did move.
      const current = await selectSale(client, cashSaleId);
      const moved =
        !current ||
        current.status !== 'AGREEMENT' ||
        current.termsVersion !== expectedTermsVersion;
      return {
        ok: false as const,
        reason: moved ? ('STALE' as const) : ('REJECTED' as const),
      };
    },

    async updateAgreedPrice({ cashSaleId, expectedTermsVersion, agreedPriceCents }) {
      const current = await selectSale(client, cashSaleId);
      if (!current || current.status !== 'AGREEMENT') return null;
      // The Platform_Fee is a percentage of the item price, so a renegotiated
      // price must re-derive it. Carrying the old fee forward would bill the
      // buyer a percentage of a price that no longer exists and would break the
      // `amount = price + fee + shipping` constraint's intent.
      const feeCents = platformFeeCentsFor(agreedPriceCents);
      const { data } = await client
        .from('cash_sales')
        .update({
          agreed_price_cents: agreedPriceCents,
          platform_fee_cents: feeCents,
          amount_cents: agreedPriceCents + feeCents + current.shippingCostCents,
        })
        .eq('id', cashSaleId)
        .eq('status', 'AGREEMENT')
        .eq('terms_version', expectedTermsVersion)
        .select('*')
        .maybeSingle();
      return data ? toCashSale(data as CashSaleRow) : null;
    },

    async claimPayment({ cashSaleId, termsVersion, nonce, requestedAt }) {
      const { data } = await client
        .from('cash_sales')
        .update({
          status: 'PAYMENT_PENDING',
          payment_nonce: nonce,
          payment_requested_at: requestedAt,
        })
        .eq('id', cashSaleId)
        .eq('status', 'AGREEMENT')
        .eq('terms_version', termsVersion)
        .is('payment_nonce', null)
        .select('*')
        .maybeSingle();
      return data ? toCashSale(data as CashSaleRow) : null;
    },

    async recordPaymentSubmission({ cashSaleId, transferId }) {
      return guardedUpdate(client, cashSaleId, 'PAYMENT_PENDING', {
        transfer_id: transferId,
        updated_at: new Date().toISOString(),
      });
    },

    async failPayment({ cashSaleId, transferId }) {
      return guardedUpdate(client, cashSaleId, 'PAYMENT_PENDING', {
        status: 'FAILED',
        ...(transferId ? { transfer_id: transferId } : {}),
        updated_at: new Date().toISOString(),
      });
    },

    async settlePayment({ cashSaleId, settledAt }) {
      const sale = await selectSale(client, cashSaleId);
      if (!sale || sale.status !== 'PAYMENT_PENDING' || !sale.fulfillmentMethod) {
        return null;
      }
      return guardedUpdate(client, cashSaleId, 'PAYMENT_PENDING', {
        status: sale.fulfillmentMethod === 'IN_PERSON' ? 'HANDOVER' : 'ESCROW_HELD',
        payment_settled_at: settledAt,
        updated_at: settledAt,
      });
    },
    async recordShipment(params) {
      return guardedUpdate(client, params.cashSaleId, 'ESCROW_HELD', {
        status: 'IN_TRANSIT',
        tracking_carrier: params.carrier,
        tracking_number: params.trackingNumber,
        tracking_url: params.trackingUrl,
        tracking_status: params.trackingStatus,
        shipped_at: params.shippedAt,
        updated_at: params.shippedAt,
      });
    },

    async recordReceipt({ cashSaleId, receivedAt }) {
      // The buyer confirming receipt does NOT set tracking to DELIVERED: only the
      // carrier can do that, because carrier confirmation is what starts the
      // auto-completion clock.
      return guardedUpdate(client, cashSaleId, 'IN_TRANSIT', {
        status: 'INSPECTION',
        received_at: receivedAt,
        updated_at: receivedAt,
      });
    },

    async applyTracking({ cashSaleId, status, deliveredAt }) {
      const { data, error } = await client.rpc('apply_cash_sale_tracking', {
        p_cash_sale_id: cashSaleId,
        p_tracking_status: status,
        p_delivered_at: deliveredAt ?? undefined,
      });
      if (error) return null;
      const row = (data as CashSaleRow[] | null)?.[0];
      return row ? toCashSale(row) : null;
    },

    async acceptInspection({ cashSaleId, acceptedAt }) {
      return guardedUpdate(client, cashSaleId, 'INSPECTION', {
        status: 'COMPLETED',
        inspection_accepted_at: acceptedAt,
        completed_at: acceptedAt,
        updated_at: acceptedAt,
      });
    },

    async confirmHandover({ cashSaleId, actor, confirmedAt }) {
      const mine =
        actor === 'BUYER' ? 'buyer_handover_confirmed_at' : 'seller_handover_confirmed_at';
      const stamp =
        actor === 'BUYER'
          ? { buyer_handover_confirmed_at: confirmedAt, updated_at: confirmedAt }
          : { seller_handover_confirmed_at: confirmedAt, updated_at: confirmedAt };
      const { data: stamped } = await client
        .from('cash_sales')
        .update(stamp)
        .eq('id', cashSaleId)
        .eq('status', 'HANDOVER')
        .is(mine, null)
        .select('*')
        .maybeSingle();
      if (!stamped) return null;

      const row = stamped as CashSaleRow;
      if (!row.buyer_handover_confirmed_at || !row.seller_handover_confirmed_at) {
        return toCashSale(row);
      }

      const completed = await guardedUpdate(client, cashSaleId, 'HANDOVER', {
        status: 'COMPLETED',
        completed_at: confirmedAt,
        updated_at: confirmedAt,
      });
      if (completed) return completed;

      // A concurrent confirm already completed the row — re-read so payout
      // still sees COMPLETED rather than a stale HANDOVER snapshot.
      const { data: latest } = await client
        .from('cash_sales')
        .select('*')
        .eq('id', cashSaleId)
        .maybeSingle();
      return latest ? toCashSale(latest as CashSaleRow) : toCashSale(row);
    },

    async cancelAgreement({ cashSaleId, actorId, reason, cancelledAt }) {
      return guardedUpdate(client, cashSaleId, 'AGREEMENT', {
        status: 'CANCELLED',
        cancelled_by: actorId,
        cancel_reason: reason,
        cancelled_at: cancelledAt,
        updated_at: cancelledAt,
      });
    },

    async raiseDispute({ cashSaleId, actorId, reason, disputedAt }) {
      // Disputes are valid from multiple active fulfillment states, not just
      // INSPECTION, so we use `.in()` rather than the single-status guardedUpdate.
      const DISPUTABLE = ['INSPECTION', 'IN_TRANSIT', 'HANDOVER', 'ESCROW_HELD'] as const;
      const { data } = await client
        .from('cash_sales')
        .update({
          status: 'DISPUTED',
          disputed_by: actorId,
          dispute_reason: reason,
          disputed_at: disputedAt,
          updated_at: disputedAt,
        })
        .eq('id', cashSaleId)
        .in('status', DISPUTABLE)
        .select('*')
        .maybeSingle();
      if (!data) return null;
      // Create the arbitration conversation for the dispute.
      await client.rpc('attach_dispute_conversation', {
        p_cash_sale_id: cashSaleId,
        p_actor_id: actorId,
      });
      // Re-fetch to pick up the dispute_conversation_id.
      const { data: refreshed } = await client
        .from('cash_sales')
        .select('*')
        .eq('id', cashSaleId)
        .maybeSingle();
      return refreshed ? toCashSale(refreshed as CashSaleRow) : toCashSale(data as CashSaleRow);
    },

    async disputeOriginStatus(cashSaleId: string) {
      // NEWEST row wins: a contract can be disputed, withdrawn and disputed again, and
      // the status to restore is the one before the LATEST claim.
      const { data } = await client
        .from('cash_sale_events')
        .select('from_status')
        .eq('cash_sale_id', cashSaleId)
        .eq('event', 'DISPUTE_RAISED')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data?.from_status as CashSaleRecord['status'] | null) ?? null;
    },

    async withdrawDispute({ cashSaleId, actorId, restoreStatus, withdrawnAt }) {
      const { data } = await client
        .from('cash_sales')
        .update({
          status: restoreStatus,
          disputed_by: null,
          dispute_reason: null,
          disputed_at: null,
          updated_at: withdrawnAt,
        })
        .eq('id', cashSaleId)
        // BOTH guards matter, and they are the concurrency story. `status` stops a
        // withdrawal landing on a sale an arbitrator resolved a moment ago, and
        // `disputed_by` stops the accused party withdrawing a claim against them even
        // if the orchestrator guard were ever bypassed. A mismatch matches no row, so
        // the caller gets a refusal instead of a silent overwrite.
        .eq('status', 'DISPUTED')
        .eq('disputed_by', actorId)
        // Never reverse a decision that has already been recorded — that is what the
        // failed-refund reopen path in 0045 is for, and it is not this.
        .is('dispute_resolution', null)
        .select('*')
        .maybeSingle();
      return data ? toCashSale(data as CashSaleRow) : null;
    },

    async attachConversation({ cashSaleId, actorId }) {
      // The RPC re-checks participation, dedupes on (item, participants), and
      // links the thread inside one transaction.
      const { error } = await client.rpc('attach_cash_sale_conversation', {
        p_cash_sale_id: cashSaleId,
        p_actor_id: actorId,
      });
      if (error) return null;
      return selectSale(client, cashSaleId);
    },

    async listDuePayouts({
      limit,
      maxAttempts,
      currency,
    }: {
      limit: number;
      maxAttempts: number;
      currency?: string;
    }) {
      let query = client
        .from('cash_sales')
        .select('id')
        .eq('status', 'COMPLETED')
        .in('seller_payout_status', ['PENDING', 'FAILED'])
        .lt('seller_payout_attempts', maxAttempts);

      // Scoped so a drain pass only sees contracts the platform account it holds can
      // actually settle (0068). Attempting another region's contract would fail as a
      // cross-region transfer AND burn a payout attempt, eventually exhausting the
      // retry budget on a contract that was never broken.
      if (currency) query = query.eq('currency', currency.toLowerCase());

      const { data } = await query
        // Oldest owed first, so nobody is starved by a steady stream of new sales.
        .order('seller_payout_due_at', { ascending: true, nullsFirst: true })
        .limit(limit);
      return ((data ?? []) as { id: string }[]).map((row) => row.id);
    },

    async listDueRefunds({
      limit,
      maxAttempts,
      currency,
    }: {
      limit: number;
      maxAttempts: number;
      currency?: string;
    }) {
      // A refund that has been queued or has failed, still has an amount, and has a
      // collection to refund against. Deliberately NOT filtered by sale status: a
      // partial refund leaves the sale COMPLETED while a full one leaves it REFUNDED,
      // and both can have a refund that did not land.
      let query = client
        .from('cash_sales')
        .select('id')
        .in('refund_status', ['PENDING', 'FAILED'])
        .gt('refund_cents', 0)
        .not('transfer_id', 'is', null)
        .lt('refund_attempts', maxAttempts)
        // A CONTESTED RETURN IS FROZEN, AND THE FREEZE HAS TO REACH HERE TOO (0088).
        //
        // `disputeCashSaleReturn` stops the automatic close, but the refund may already
        // have been queued by the carrier confirmation that arrived moments earlier. A
        // drain that ignores the contest would settle it on the next hourly pass,
        // paying the buyer while an operator was still deciding whether the return was
        // real — and if they then found for the seller, both sides would have been paid.
        //
        // The one place this must NOT apply is a refund an operator has since decided
        // to release: `resolveCashSaleReturnCase` performs that refund directly rather
        // than waiting for the drain, so nothing is stranded by excluding it here.
        .is('return_disputed_at', null);

      // Same regional scoping as the payout drain, for the same reason.
      if (currency) query = query.eq('currency', currency.toLowerCase());

      const { data } = await query
        .order('dispute_resolved_at', { ascending: true, nullsFirst: true })
        .limit(limit);
      return ((data ?? []) as { id: string }[]).map((row) => row.id);
    },

    async markPayoutDue(cashSaleId: string) {
      // Delegated to SQL so the nonce is assigned atomically and the same
      // function serves the auto-complete cron, which cannot call this code.
      await client.rpc('mark_cash_sale_payout_due', { p_cash_sale_id: cashSaleId });
      return selectSale(client, cashSaleId);
    },

    async recordPayoutResult(params: {
      cashSaleId: string;
      status: CashSalePayoutStatus;
      transferId?: string;
      error?: string;
    }) {
      const current = await selectSale(client, params.cashSaleId);
      const { data } = await client
        .from('cash_sales')
        .update({
          seller_payout_status: params.status,
          ...(params.transferId ? { seller_payout_ref: params.transferId } : {}),
          ...(params.status === 'SETTLED'
            ? { seller_payout_at: new Date().toISOString(), seller_payout_error: null }
            : {}),
          ...(params.error ? { seller_payout_error: params.error } : {}),
          // Counts attempts, so a release that keeps failing is visible rather
          // than silently retrying forever.
          seller_payout_attempts: (current?.sellerPayoutAttempts ?? 0) + 1,
        })
        .eq('id', params.cashSaleId)
        .select('*')
        .maybeSingle();
      return data ? toCashSale(data as CashSaleRow) : null;
    },

    async markRefundDue(params: { cashSaleId: string; amountCents: number }) {
      // Delegated to SQL for the same reason as the payout nonce: the assignment
      // and the state guard have to be one atomic step, or two concurrent
      // resolutions could each mint a nonce and refund the Buyer twice.
      await client.rpc('mark_cash_sale_refund_due', {
        p_cash_sale_id: params.cashSaleId,
        p_amount_cents: params.amountCents,
      });
      return selectSale(client, params.cashSaleId);
    },

    async recordRefundResult(params: {
      cashSaleId: string;
      status: CashSalePayoutStatus;
      refundId?: string;
      error?: string;
    }) {
      const current = await selectSale(client, params.cashSaleId);
      const { data } = await client
        .from('cash_sales')
        .update({
          refund_status: params.status,
          ...(params.refundId ? { refund_ref: params.refundId } : {}),
          ...(params.status === 'SETTLED' ? { refund_error: null } : {}),
          ...(params.error ? { refund_error: params.error } : {}),
          refund_attempts: (current?.refundAttempts ?? 0) + 1,
        })
        .eq('id', params.cashSaleId)
        .select('*')
        .maybeSingle();
      return data ? toCashSale(data as CashSaleRow) : null;
    },

    async recordDisputeResolution(params: {
      cashSaleId: string;
      outcome: CashSaleDisputeOutcome;
      resolvedBy: string;
      resolvedAt: string;
      status: 'COMPLETED' | 'REFUNDED' | 'RETURN_PENDING';
      returnDeadlineAt?: string;
    }) {
      const { data } = await client
        .from('cash_sales')
        .update({
          dispute_resolution: params.outcome,
          dispute_resolved_by: params.resolvedBy,
          dispute_resolved_at: params.resolvedAt,
          status: params.status,
          ...(params.status === 'COMPLETED' ? { completed_at: params.resolvedAt } : {}),
          // Only set when entering the return flow; a COMPLETED or directly REFUNDED
          // resolution has no return and must not carry a deadline that a sweep would
          // then act on.
          ...(params.status === 'RETURN_PENDING' && params.returnDeadlineAt
            ? { return_deadline_at: params.returnDeadlineAt }
            : {}),
        })
        .eq('id', params.cashSaleId)
        // Conditional on the expected state, so two operators resolving the same
        // dispute concurrently means the second update matches nothing rather than
        // overwriting the first decision.
        .eq('status', 'DISPUTED')
        .select('*')
        .maybeSingle();
      return data ? toCashSale(data as CashSaleRow) : null;
    },

    async recordReturnShipment(params: {
      cashSaleId: string;
      carrier: string;
      trackingNumber: string;
      trackingUrl: string | null;
      trackingStatus: string | null;
      shippedAt: string;
    }) {
      const { data } = await client
        .from('cash_sales')
        .update({
          status: 'RETURN_IN_TRANSIT',
          return_tracking_carrier: params.carrier,
          return_tracking_number: params.trackingNumber,
          return_tracking_url: params.trackingUrl,
          return_tracking_status: params.trackingStatus,
          return_shipped_at: params.shippedAt,
          // A LATE RETURN IS STILL A RETURN. 0089 promised the lapse flag clears
          // itself and nothing implemented that, so a case that resolved on its own
          // would have sat in the arbitration queue permanently, sending staff to
          // investigate settled cases. Cleared in the same write that records the
          // shipment, so the two cannot disagree.
          return_lapsed_at: null,
        })
        .eq('id', params.cashSaleId)
        // Only from RETURN_PENDING, and only once: `.is(return_shipped_at, null)`
        // makes a second submission match nothing rather than replacing the carrier
        // already on record, which arbitration may be relying on.
        .eq('status', 'RETURN_PENDING')
        .is('return_shipped_at', null)
        .select('*')
        .maybeSingle();
      return data ? toCashSale(data as CashSaleRow) : null;
    },

    async recordReturnCaseResolution(params: {
      cashSaleId: string;
      status: 'REFUNDED' | 'COMPLETED';
      resolvedBy: string;
      resolvedAt: string;
    }) {
      const { data } = await client
        .from('cash_sales')
        .update({
          status: params.status,
          dispute_resolved_by: params.resolvedBy,
          dispute_resolved_at: params.resolvedAt,
          // The case leaves the arbitration queue whichever way it went.
          return_lapsed_at: null,
        })
        .eq('id', params.cashSaleId)
        // Only from a return state, so this cannot be used to close anything else.
        // Deliberately WITHOUT the contested and carrier-confirmed guards that
        // recordReturnFinalised carries: staff resolving the case are the authority
        // those guards defer to.
        .in('status', ['RETURN_PENDING', 'RETURN_IN_TRANSIT'])
        .select('*')
        .maybeSingle();
      return data ? toCashSale(data as CashSaleRow) : null;
    },

    async recordReturnFinalised(params: { cashSaleId: string }) {
      const { data } = await client
        .from('cash_sales')
        .update({ status: 'REFUNDED' })
        .eq('id', params.cashSaleId)
        // Guarded so a duplicate carrier event cannot re-close a closed sale, and so
        // a contested return (which an operator must decide) is never auto-closed.
        .eq('status', 'RETURN_IN_TRANSIT')
        .not('return_carrier_delivered_at', 'is', null)
        .is('return_disputed_at', null)
        .select('*')
        .maybeSingle();
      return data ? toCashSale(data as CashSaleRow) : null;
    },

    async recordReturnDispute(params: {
      cashSaleId: string;
      reason: string;
      disputedAt: string;
    }) {
      const { data } = await client
        .from('cash_sales')
        .update({
          return_disputed_at: params.disputedAt,
          return_dispute_reason: params.reason,
        })
        .eq('id', params.cashSaleId)
        // Once only: a Seller cannot overwrite their own earlier account of what was
        // wrong with the return, for the same reason dispute evidence is append-only.
        .is('return_disputed_at', null)
        .in('status', ['RETURN_PENDING', 'RETURN_IN_TRANSIT'])
        .select('*')
        .maybeSingle();
      return data ? toCashSale(data as CashSaleRow) : null;
    },

    async setItemStatus({ itemId, status }: { itemId: string; status: ItemStatus }) {
      await client.from('items').update({ status }).eq('id', itemId);
    },

    async logEvent(params) {
      await client.from('cash_sale_events').insert({
        cash_sale_id: params.cashSaleId,
        actor_id: params.actorId,
        event: params.event,
        from_status: params.fromStatus,
        to_status: params.toStatus,
        detail: params.detail ?? null,
      });
    },
  };
}

/**
 * Production wiring with provider-independent payment and tracking seams.
 *
 * The payout notifier is defaulted here rather than at each call site because a
 * release is triggered from five places — the contract actions, the offer accept
 * path, the admin retry, the webhook pipeline and the hourly drain job — and a
 * Seller must be told their money moved regardless of which one ran it. Passing
 * `notifier` explicitly overrides this; passing `null` disables it.
 */
export function createDefaultCashSaleOrchestrator(
  deps: Pick<CashSaleOrchestratorDeps, 'payments'> &
    Partial<Omit<CashSaleOrchestratorDeps, 'payments'>> & {
      notifier?: CashSaleOrchestratorDeps['notifier'] | null;
    },
): CashSaleOrchestrator {
  return createCashSaleOrchestrator({
    repository: deps.repository ?? createSupabaseCashSaleRepository(),
    payments: deps.payments,
    tracking: deps.tracking ?? getTrackingService(),
    platformFeeCents: deps.platformFeeCents,
    now: deps.now,
    createNonce: deps.createNonce,
    payoutMode:
      deps.payoutMode ?? (process.env.PAYOUT_MODE === 'direct' ? 'direct' : 'platform'),
    notifier:
      deps.notifier === null ? undefined : (deps.notifier ?? createPayoutNotifier()),
    // Defaulted HERE rather than left to call sites, for the same reason the notifier
    // is: a contract can be opened from several places and every one of them must
    // apply the same region rule. The runtime set is stricter than the registry's
    // `tradingEnabled` — it also requires a configured Stripe platform account for
    // the region, without which the seller could not be paid.
    operationalRegions: deps.operationalRegions ?? operationalRegions(),
    payoutRegionCurrency: deps.payoutRegionCurrency,
  });
}
