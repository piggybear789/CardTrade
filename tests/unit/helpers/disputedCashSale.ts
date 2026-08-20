// tests/unit/helpers/disputedCashSale.ts
//
// Driving a Cash_Sale all the way to DISPUTED, which is the only resolvable state.
//
// Extracted so the dispute-resolution tests and the refund-drain tests share ONE setup.
// The sequence is long and order-sensitive — two parties each save terms, the buyer
// pays, payment settles, the seller ships, the buyer receives — and a second copy would
// drift from this one silently, leaving two tests that believe they are testing the same
// state.

import {
  acceptCashSaleTerms,
  disputeCashSale,
  initiateCashSale,
  recordCashSaleReceipt,
  recordCashSaleShipment,
  settleCashSale,
  updateCashSaleTerms,
  type CashSaleOrchestratorDeps,
  type CashSaleRecord,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import { BUYER, ITEM } from '../fakes/cashSaleRepository';

/** The purchase every dispute test starts from. */
export const PURCHASE = {
  buyerId: BUYER.profileId,
  itemId: ITEM.id,
  sellerIdentityVersion: 'seller-v1',
  buyerConfirmedSellerIdentity: true,
};

/** Posted fulfilment, priced by the seller and addressed by the buyer. */
export const DELIVERY_TERMS = {
  fulfillmentMethod: 'DELIVERY' as const,
  shippingCostCents: 1_500,
  deliveryAddress: {
    label: '12 Example St, Melbourne VIC 3000',
    placeId: 'geo:delivery-1',
    countryCode: 'AU',
    lat: -37.8136,
    lng: 144.9631,
  },
};

/**
 * Take a fresh sale to DISPUTED and return it.
 *
 * Throws on any setup step that fails, rather than continuing with a sale in the wrong
 * state — a test that silently starts from AGREEMENT would assert nothing useful.
 */
export async function disputedCashSale(
  deps: CashSaleOrchestratorDeps,
): Promise<CashSaleRecord> {
  const created = await initiateCashSale(deps, PURCHASE);
  if (!created.ok) throw new Error('setup: could not initiate');
  const saleId = created.sale.id;

  // Two saves by two parties: postage is the seller's to price, the address is the
  // buyer's. The seller goes first so the buyer's save leaves postage unchanged, which is
  // the only way a buyer may carry that field.
  const priced = await updateCashSaleTerms(deps, {
    cashSaleId: saleId,
    actorId: ITEM.ownerId,
    expectedTermsVersion: created.sale.termsVersion,
    terms: { ...DELIVERY_TERMS, deliveryAddress: undefined },
  });
  if (!priced.ok) throw new Error('setup: could not price postage');

  await updateCashSaleTerms(deps, {
    cashSaleId: saleId,
    actorId: BUYER.profileId,
    expectedTermsVersion: priced.sale.termsVersion,
    terms: DELIVERY_TERMS,
  });
  const sale = await deps.repository.loadCashSale(saleId);
  if (!sale) throw new Error('setup: sale vanished');

  await acceptCashSaleTerms(deps, {
    cashSaleId: saleId,
    actorId: BUYER.profileId,
    termsVersion: sale.termsVersion,
  });
  await settleCashSale(deps, { cashSaleId: saleId });
  await recordCashSaleShipment(deps, {
    cashSaleId: saleId,
    actorId: ITEM.ownerId,
    shipment: { carrier: 'Australia Post', trackingNumber: 'AP123456789AU' },
  });
  await recordCashSaleReceipt(deps, { cashSaleId: saleId, actorId: BUYER.profileId });

  const disputed = await disputeCashSale(deps, {
    cashSaleId: saleId,
    actorId: BUYER.profileId,
    reason: 'Arrived with a crease not shown in the listing photos.',
  });
  if (!disputed.ok) throw new Error('setup: could not dispute');
  return disputed.sale;
}
