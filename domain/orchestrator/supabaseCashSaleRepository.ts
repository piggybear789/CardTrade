// domain/orchestrator/supabaseCashSaleRepository.ts
// Supabase binding for the bilateral Cash_Sale orchestrator (Req 4).
// All writes use the service-role client and therefore repeat participant/state
// checks in the pure orchestrator plus conditional expected-state updates here.

import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Tables, TablesUpdate } from '@/lib/supabase/database.types';
import { getTrackingService } from '@/domain/services/tracking';
import {
  createCashSaleOrchestrator,
  type BuyerRecord,
  type CashSaleOrchestrator,
  type CashSaleOrchestratorDeps,
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
  | 'kyc_status'
  | 'payer_id'
  | 'payment_source_id'
  | 'display_name'
  | 'contact_email'
  | 'payment_token'
  | 'payment_token_type'
>;

/** Map one database row to the provider-independent aggregate. */
function toCashSale(row: CashSaleRow): CashSaleRecord {
  return {
    id: row.id,
    itemId: row.item_id,
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
    deliveryAddress: row.delivery_address,
    meetingLocation: row.meeting_location,
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
      registrationNumber: row.seller_registration_number ?? '',
      organisationType: row.seller_organisation_type,
      verifiedAt: row.seller_identity_verified_at ?? '',
    },
    buyerSellerIdentityConfirmedAt: row.buyer_seller_identity_confirmed_at ?? '',
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
          'id, kyc_status, payer_id, payment_source_id, display_name, contact_email, payment_token, payment_token_type',
        )
        .eq('id', buyerId)
        .maybeSingle();
      const row = data as ProfileRow | null;
      return row
        ? {
            profileId: row.id,
            kycStatus: row.kyc_status,
            payerId: row.payer_id,
            paymentSourceId: row.payment_source_id,
            displayName: row.display_name,
            contactEmail: row.contact_email,
            paymentToken: row.payment_token,
            paymentTokenType: row.payment_token_type,
          }
        : null;
    },
    async loadSellerPayee(sellerId: string): Promise<MerchantRecord | null> {
      const { data } = await client
        .from('profiles')
        .select(
          'id, merchant_ref, merchant_status, merchant_compliance_status, merchant_live_enabled, ' +
            'merchant_transactions_enabled, merchant_settlements_enabled, ' +
            'merchant_legal_entity_name, merchant_trading_name, merchant_registration_number, ' +
            'merchant_organisation_type, merchant_identity_version, ' +
            'merchant_identity_disclosure_consented_at, merchant_identity_verified_at',
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

    async findPayerRef({ profileId, merchantRef }) {
      const { data } = await client
        .from('payer_refs')
        .select('payer_id')
        .eq('profile_id', profileId)
        .eq('merchant_ref', merchantRef)
        .maybeSingle();
      return data?.payer_id ?? null;
    },

    async savePayerRef(params) {
      await client.from('payer_refs').upsert(
        {
          profile_id: params.profileId,
          merchant_ref: params.merchantRef,
          payer_id: params.payerId,
        },
        { onConflict: 'profile_id,merchant_ref' },
      );
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
        p_seller_registration_number: params.sellerIdentity.registrationNumber,
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
    async updateTerms({ cashSaleId, expectedTermsVersion, terms }) {
      const current = await selectSale(client, cashSaleId);
      if (!current || current.status !== 'AGREEMENT') return null;
      const amountCents =
        current.agreedPriceCents + current.platformFeeCents + terms.shippingCostCents;
      const { data } = await client
        .from('cash_sales')
        .update({
          fulfillment_method: terms.fulfillmentMethod,
          shipping_cost_cents: terms.shippingCostCents,
          shipping_notes: terms.shippingNotes,
          delivery_address: terms.deliveryAddress,
          meeting_location: terms.meetingLocation,
          meeting_at: terms.meetingAt,
          amount_cents: amountCents,
        })
        .eq('id', cashSaleId)
        .eq('status', 'AGREEMENT')
        .eq('terms_version', expectedTermsVersion)
        .select('*')
        .maybeSingle();
      return data ? toCashSale(data as CashSaleRow) : null;
    },

    async updateAgreedPrice({ cashSaleId, expectedTermsVersion, agreedPriceCents }) {
      const current = await selectSale(client, cashSaleId);
      if (!current || current.status !== 'AGREEMENT') return null;
      const { data } = await client
        .from('cash_sales')
        .update({
          agreed_price_cents: agreedPriceCents,
          amount_cents:
            agreedPriceCents + current.platformFeeCents + current.shippingCostCents,
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
      const DISPUTABLE = ['INSPECTION', 'IN_TRANSIT', 'HANDOVER', 'ESCROW_HELD'];
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

/** Production wiring with provider-independent payment and tracking seams. */
export function createDefaultCashSaleOrchestrator(
  deps: Pick<CashSaleOrchestratorDeps, 'payments'> &
    Partial<Omit<CashSaleOrchestratorDeps, 'payments'>>,
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
  });
}
