// domain/orchestrator/supabaseCashSaleRepository.ts
// Supabase binding for the bilateral Cash_Sale orchestrator (Req 4).
// All writes use the service-role client and therefore repeat participant/state
// checks in the pure orchestrator plus conditional expected-state updates here.

import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Tables, TablesUpdate } from '@/lib/supabase/database.types';
import { createPayoutNotifier } from '@/lib/notifications/payoutNotifier';
import { getTrackingService } from '@/domain/services/tracking';
import {
  createCashSaleOrchestrator,
  platformFeeCentsFor,
  type BuyerRecord,
  type CashSaleOrchestrator,
  type CashSaleOrchestratorDeps,
  type CashSaleDisputeOutcome,
  type CashSalePayoutStatus,
  type CashSaleRecord,
  type CashSaleRepository,
  type CreateCashSaleParams,
  type ItemRecord,
  type ItemStatus,
} from './cashSaleOrchestrator';
import type { MerchantRecord } from './merchantOnboarding';

type AdminClient = ReturnType<typeof createAdminClient>;
type CashSaleRow = Tables<'cash_sales'>;

type ProfileRow = Pick<
  Tables<'profiles'>,
  | 'id'
  | 'payer_id'
  | 'payment_source_id'
  | 'display_name'
  | 'contact_email'
  | 'payment_token_type'
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
    autoCompleted: row.auto_completed,
    buyerHandoverConfirmedAt: row.buyer_handover_confirmed_at,
    sellerHandoverConfirmedAt: row.seller_handover_confirmed_at,
    completedAt: row.completed_at,
    conversationId: row.conversation_id,
    sellerIdentity: {
      sellerId: row.seller_id,
      version: row.seller_identity_version ?? '',
      legalEntityName: row.seller_legal_entity_name ?? '',
      tradingName: row.seller_trading_name,
      organisationType: row.seller_organisation_type,
      verifiedAt: row.seller_identity_verified_at ?? '',
    },
    buyerSellerIdentityConfirmedAt: row.buyer_seller_identity_confirmed_at ?? '',
    sellerPayoutStatus: row.seller_payout_status ?? 'NOT_DUE',
    sellerPayoutRef: row.seller_payout_ref ?? null,
    sellerPayoutNonce: row.seller_payout_nonce ?? null,
    sellerPayoutAttempts: Number(row.seller_payout_attempts ?? 0),
    disputeResolution: (row.dispute_resolution ?? null) as CashSaleRecord['disputeResolution'],
    disputeResolvedAt: row.dispute_resolved_at ?? null,
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
          'id, payer_id, payment_source_id, display_name, contact_email, payment_token_type',
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
          }
        : null;
    },
    async loadSellerPayee(sellerId: string): Promise<MerchantRecord | null> {
      const { data } = await client
        .from('profiles')
        .select(
          'id, merchant_ref, merchant_status, merchant_compliance_status, merchant_live_enabled, merchant_transactions_enabled, merchant_settlements_enabled, merchant_legal_entity_name, merchant_trading_name, merchant_registration_number, merchant_organisation_type, merchant_identity_version, merchant_identity_disclosure_consented_at, merchant_identity_verified_at',
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
        .select('id, owner_id, fmv_cents, status, title, description, condition, image_paths')
        .eq('id', itemId)
        .maybeSingle();
      return data
        ? {
            id: data.id,
            ownerId: data.owner_id,
            fmvCents: data.fmv_cents,
            status: data.status,
            title: data.title,
            description: data.description,
            condition: data.condition,
            imagePaths: data.image_paths,
          }
        : null;
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
      });
      if (error) {
        if (error.message.includes('own item')) throw new Error('SELF_PURCHASE');
        throw new Error(`Failed to create agreement: ${error.message}`);
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
      return row
        ? { ok: true as const, sale: toCashSale(row) }
        : { ok: false as const, reason: 'STALE' as const };
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

    async acceptTerms({ cashSaleId, actor, termsVersion, acceptedAt }) {
      const patch: TablesUpdate<'cash_sales'> =
        actor === 'BUYER'
          ? {
              buyer_terms_accepted_version: termsVersion,
              buyer_terms_accepted_at: acceptedAt,
            }
          : {
              seller_terms_accepted_version: termsVersion,
              seller_terms_accepted_at: acceptedAt,
            };
      const { data } = await client
        .from('cash_sales')
        .update(patch)
        .eq('id', cashSaleId)
        .eq('status', 'AGREEMENT')
        .eq('terms_version', termsVersion)
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
        .eq('buyer_terms_accepted_version', termsVersion)
        .eq('seller_terms_accepted_version', termsVersion)
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
      const patch: TablesUpdate<'cash_sales'> =
        actor === 'BUYER'
          ? { buyer_handover_confirmed_at: confirmedAt }
          : { seller_handover_confirmed_at: confirmedAt };
      const updated = await guardedUpdate(client, cashSaleId, 'HANDOVER', patch);
      if (!updated) return null;
      if (!updated.buyerHandoverConfirmedAt || !updated.sellerHandoverConfirmedAt) {
        return updated;
      }
      return (
        (await guardedUpdate(client, cashSaleId, 'HANDOVER', {
          status: 'COMPLETED',
          completed_at: confirmedAt,
          updated_at: confirmedAt,
        })) ?? updated
      );
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

    async listDuePayouts({ limit, maxAttempts }: { limit: number; maxAttempts: number }) {
      const { data } = await client
        .from('cash_sales')
        .select('id')
        .eq('status', 'COMPLETED')
        .in('seller_payout_status', ['PENDING', 'FAILED'])
        .lt('seller_payout_attempts', maxAttempts)
        // Oldest owed first, so nobody is starved by a steady stream of new sales.
        .order('seller_payout_due_at', { ascending: true, nullsFirst: true })
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
      status: 'COMPLETED' | 'REFUNDED';
    }) {
      const { data } = await client
        .from('cash_sales')
        .update({
          dispute_resolution: params.outcome,
          dispute_resolved_by: params.resolvedBy,
          dispute_resolved_at: params.resolvedAt,
          status: params.status,
          ...(params.status === 'COMPLETED' ? { completed_at: params.resolvedAt } : {}),
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
  });
}
