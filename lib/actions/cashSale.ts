'use server';

// lib/actions/cashSale.ts
// Authenticated, thin Cash_Sale action boundary (Req 4). Provider webhooks call
// the orchestrator directly; no client-callable settle/fail simulation exists.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createDefaultCashSaleOrchestrator } from '@/domain/orchestrator/supabaseCashSaleRepository';
import { getPaymentService } from '@/domain/services';

import type {
  CashSaleError,
  CashSaleRecord,
  CashSaleTermsInput,
} from '@/domain/orchestrator/cashSaleOrchestrator';

export type CashSaleActionError =
  | 'not-authenticated'
  | 'no-payment-method'
  | 'buyer-confirmation-required'
  | 'seller-identity-unverified'
  | 'seller-identity-changed'
  | 'seller-not-payable'
  | 'item-not-found'
  | 'item-unavailable'
  | 'self-purchase'
  | 'transfer-failed'
  | 'cash-sale-not-found'
  | 'not-participant'
  | 'not-permitted'
  | 'invalid-terms'
  | 'stale-terms'
  | 'already-recorded'
  | 'not-supported'
  | 'invalid-state';

export type CashSaleActionResult =
  | { ok: true; sale: CashSaleRecord }
  | { ok: false; error: CashSaleActionError; message?: string };

export interface InitiateCashSaleInput {
  itemId: string;
  sellerIdentityVersion: string;
  buyerConfirmedSellerIdentity: boolean;
  agreedPriceCents?: number;
}

async function getUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

function orchestrator() {
  return createDefaultCashSaleOrchestrator({ payments: getPaymentService() });
}
function mapError(error: CashSaleError): CashSaleActionError {
  const errors: Record<CashSaleError, CashSaleActionError> = {
    BUYER_NO_PAYMENT_METHOD: 'no-payment-method',
    BUYER_CONFIRMATION_REQUIRED: 'buyer-confirmation-required',
    SELLER_IDENTITY_UNVERIFIED: 'seller-identity-unverified',
    SELLER_IDENTITY_CHANGED: 'seller-identity-changed',
    SELLER_NOT_PAYABLE: 'seller-not-payable',
    ITEM_NOT_FOUND: 'item-not-found',
    ITEM_UNAVAILABLE: 'item-unavailable',
    SELF_PURCHASE: 'self-purchase',
    TRANSFER_FAILED: 'transfer-failed',
    CASH_SALE_NOT_FOUND: 'cash-sale-not-found',
    NOT_PARTICIPANT: 'not-participant',
    NOT_PERMITTED: 'not-permitted',
    INVALID_TERMS: 'invalid-terms',
    STALE_TERMS: 'stale-terms',
    ALREADY_RECORDED: 'already-recorded',
    NOT_SUPPORTED: 'not-supported',
    INVALID_STATE: 'invalid-state',
  };
  return errors[error];
}

function actionResult(result: Awaited<ReturnType<ReturnType<typeof orchestrator>['acceptTerms']>>): CashSaleActionResult {
  if (!result.ok) {
    return { ok: false, error: mapError(result.error), message: result.detail };
  }
  revalidatePath(`/sales/${result.sale.id}`);
  return { ok: true, sale: result.sale };
}

/** Create and reserve an agreement without collecting payment (Req 4.1). */
export async function initiateCashSale(
  input: InitiateCashSaleInput,
): Promise<CashSaleActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'not-authenticated' };
  if (!input?.itemId || !input.sellerIdentityVersion || !input.buyerConfirmedSellerIdentity) {
    return {
      ok: false,
      error: 'buyer-confirmation-required',
      message: 'Confirm the verified seller before opening the agreement.',
    };
  }
  const result = await orchestrator().initiateCashSale({
    buyerId: userId,
    itemId: input.itemId,
    sellerIdentityVersion: input.sellerIdentityVersion,
    buyerConfirmedSellerIdentity: true,
    agreedPriceCents: input.agreedPriceCents,
  });
  return actionResult(result);
}

/** Save a new version of fulfillment terms and clear both acceptances. */
export async function updateCashSaleTerms(
  cashSaleId: string,
  expectedTermsVersion: number,
  terms: CashSaleTermsInput,
): Promise<CashSaleActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'not-authenticated' };
  if (!cashSaleId || !Number.isInteger(expectedTermsVersion) || !terms) {
    return { ok: false, error: 'invalid-terms' };
  }
  return actionResult(
    await orchestrator().updateTerms({
      actorId: userId,
      cashSaleId,
      expectedTermsVersion,
      terms,
    }),
  );
}

/**
 * Propose a new agreed price (Req 4.3). Both acceptances are cleared by the
 * change, and the contract chat is notified automatically: every contract event
 * is mirrored into the thread by a database trigger, so this action must not
 * post its own message or the note would appear twice.
 */
export async function proposeCashSalePrice(
  cashSaleId: string,
  expectedTermsVersion: number,
  agreedPriceCents: number,
): Promise<CashSaleActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'not-authenticated' };

  return actionResult(
    await orchestrator().proposePrice({
      actorId: userId,
      cashSaleId,
      expectedTermsVersion,
      agreedPriceCents,
    }),
  );
}

/** Accept exactly the terms version shown; second acceptance starts payment. */
export async function acceptCashSaleTerms(
  cashSaleId: string,
  termsVersion: number,
): Promise<CashSaleActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'not-authenticated' };
  return actionResult(
    await orchestrator().acceptTerms({ actorId: userId, cashSaleId, termsVersion }),
  );
}
/** Open (or resolve) the participant chat for a contract (Req 4.2). */
export async function ensureCashSaleConversation(
  cashSaleId: string,
): Promise<CashSaleActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'not-authenticated' };
  return actionResult(
    await orchestrator().ensureConversation({ actorId: userId, cashSaleId }),
  );
}

export async function recordCashSaleShipment(
  cashSaleId: string,
  carrier: string,
  trackingNumber: string,
): Promise<CashSaleActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'not-authenticated' };
  return actionResult(
    await orchestrator().recordShipment({
      actorId: userId,
      cashSaleId,
      shipment: { carrier, trackingNumber },
    }),
  );
}

export async function recordCashSaleReceipt(
  cashSaleId: string,
): Promise<CashSaleActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'not-authenticated' };
  return actionResult(
    await orchestrator().recordReceipt({ actorId: userId, cashSaleId }),
  );
}

/**
 * Refresh the shipment from the carrier. A confirmed delivery starts the
 * inspection window, after which the contract auto-completes (Req 4.14a).
 */
export async function syncCashSaleTracking(
  cashSaleId: string,
): Promise<CashSaleActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'not-authenticated' };
  return actionResult(
    await orchestrator().syncTracking({ actorId: userId, cashSaleId }),
  );
}

export async function acceptCashSaleInspection(
  cashSaleId: string,
): Promise<CashSaleActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'not-authenticated' };
  return actionResult(
    await orchestrator().acceptInspection({ actorId: userId, cashSaleId }),
  );
}

export async function confirmCashSaleHandover(
  cashSaleId: string,
): Promise<CashSaleActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'not-authenticated' };
  return actionResult(
    await orchestrator().confirmHandover({ actorId: userId, cashSaleId }),
  );
}

export async function cancelCashSaleAgreement(
  cashSaleId: string,
  reason?: string,
): Promise<CashSaleActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'not-authenticated' };
  return actionResult(
    await orchestrator().cancelAgreement({ actorId: userId, cashSaleId, reason }),
  );
}

export async function disputeCashSale(
  cashSaleId: string,
  reason: string,
): Promise<CashSaleActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'not-authenticated' };
  return actionResult(
    await orchestrator().raiseDispute({ actorId: userId, cashSaleId, reason }),
  );
}
