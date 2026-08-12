'use server';

// lib/actions/cashSale.ts
// Authenticated, thin Cash_Sale action boundary (Req 4). Provider webhooks call
// the orchestrator directly; no client-callable settle/fail simulation exists.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createDefaultCashSaleOrchestrator } from '@/domain/orchestrator/supabaseCashSaleRepository';
import { getPaymentService } from '@/domain/services';

import { validateCashSaleLineItems } from '@/domain/validation/cashSaleLineItems';
import { createNotification } from '@/lib/notifications/createNotification';
import { emailNotify } from '@/lib/email';

import type {
  CashSaleError,
  CashSaleLineItem,
  CashSaleRecord,
  CashSaleTermsInput,
  PartySettlementOutcome,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import type { CashSaleLineItemInput } from '@/domain/validation/cashSaleLineItems';

export type CashSaleActionError =
  | 'not-authenticated'
  | 'no-payment-method'
  | 'buyer-confirmation-required'
  | 'seller-identity-unverified'
  | 'seller-identity-changed'
  | 'seller-not-payable'
  /** Buyer and seller are not in the same enabled trading region (0065). */
  | 'region-mismatch'
  | 'item-not-found'
  | 'item-unavailable'
  | 'self-purchase'
  | 'transfer-failed'
  | 'cash-sale-not-found'
  | 'not-participant'
  | 'not-permitted'
  | 'invalid-terms'
  | 'stale-terms'
  | 'terms-update-failed'
  | 'already-recorded'
  | 'not-supported'
  | 'invalid-state'
  | 'refund-failed'
  | 'invalid-refund-amount'
  | 'nothing-to-refund';

export type CashSaleActionResult =
  | { ok: true; sale: CashSaleRecord }
  | { ok: false; error: CashSaleActionError; message?: string };

export interface InitiateCashSaleInput {
  itemId: string;
  sellerIdentityVersion: string;
  buyerConfirmedSellerIdentity: boolean;
  agreedPriceCents?: number;
  /**
   * What the buyer is asking for out of a SHOPFRONT listing (0064).
   *
   * Required for a shopfront and rejected for a single listing. The contract
   * price is the sum of these lines, so `agreedPriceCents` is ignored when they
   * are present.
   */
  lineItems?: CashSaleLineItemInput[];
}

async function getUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * Build the orchestrator for the contract actions in this module.
 *
 * NO REGION IS PASSED, and that is deliberate rather than an omission. Every
 * provider call in the Cash_Sale orchestrator lives in `resolvePaymentPayer`,
 * `submitClaimedPayment`, `payoutCashSaleSeller` and the dispute refund — none of
 * which are reachable from this module. What is here is terms, line items,
 * acceptances, shipment, receipt, tracking, inspection, handover, cancellation and
 * dispute-raising: all database writes.
 *
 * Region binding therefore belongs where the money actually moves — `payments.ts`,
 * `admin.ts`, the payout job and the webhook pipeline — and passing one here would
 * imply this call selects a Stripe account when it selects nothing.
 */
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
    // Surfaced distinctly rather than folded into `item-unavailable`: the listing is
    // perfectly available, just not to this buyer, and the orchestrator's `detail`
    // names both regions so the member can tell a fixable problem (no region set)
    // from a permanent one (the seller is overseas).
    REGION_MISMATCH: 'region-mismatch',
    ITEM_NOT_FOUND: 'item-not-found',
    ITEM_UNAVAILABLE: 'item-unavailable',
    SELF_PURCHASE: 'self-purchase',
    TRANSFER_FAILED: 'transfer-failed',
    CASH_SALE_NOT_FOUND: 'cash-sale-not-found',
    NOT_PARTICIPANT: 'not-participant',
    NOT_PERMITTED: 'not-permitted',
    INVALID_TERMS: 'invalid-terms',
    STALE_TERMS: 'stale-terms',
    TERMS_UPDATE_FAILED: 'terms-update-failed',
    ALREADY_RECORDED: 'already-recorded',
    NOT_SUPPORTED: 'not-supported',
    INVALID_STATE: 'invalid-state',
    // Reuses the transfer-failed surface: from a participant's point of view the
    // distinction between "collection failed" and "release failed" is not
    // actionable. The queued retry and the operator alert carry the detail.
    PAYOUT_FAILED: 'transfer-failed',
    // Dispute resolution (0044). These are surfaced distinctly because, unlike a
    // release failure, an operator resolving a dispute CAN act on each one: retry,
    // correct the amount, or check that funds were ever collected.
    REFUND_FAILED: 'refund-failed',
    INVALID_REFUND_AMOUNT: 'invalid-refund-amount',
    NOTHING_TO_REFUND: 'nothing-to-refund',
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
  // Validate the requested items before opening anything, so a malformed line
  // comes back as a field message rather than a constraint violation.
  let lineItems: CashSaleLineItemInput[] | undefined;
  if (input.lineItems && input.lineItems.length > 0) {
    const validated = validateCashSaleLineItems(input.lineItems);
    if (!validated.ok) {
      return { ok: false, error: 'invalid-terms', message: validated.message };
    }
    lineItems = validated.value;
  }

  const result = await orchestrator().initiateCashSale({
    buyerId: userId,
    itemId: input.itemId,
    sellerIdentityVersion: input.sellerIdentityVersion,
    buyerConfirmedSellerIdentity: true,
    agreedPriceCents: input.agreedPriceCents,
    lineItems,
  });
  const actionRes = actionResult(result);
  if (actionRes.ok) {
    await createNotification({
      userId: actionRes.sale.sellerId,
      type: 'SALE',
      title: 'New purchase request',
      body: 'A buyer wants to purchase from your listing.',
      link: `/sales/${actionRes.sale.id}`,
    });
    void emailNotify.newPurchaseRequest({
      userId: actionRes.sale.sellerId,
      itemTitle: actionRes.sale.itemTitle ?? 'your listing',
      contractId: actionRes.sale.id,
    });
  }
  return actionRes;
}

/**
 * Replace what a shopfront contract covers (0064).
 *
 * Both acceptances are cleared by the change, so each party must re-accept the
 * new contents. The contract chat is notified by the same database trigger that
 * mirrors every other contract event, so this action must not post its own
 * message or the note would appear twice.
 */
export async function updateCashSaleItems(
  cashSaleId: string,
  expectedTermsVersion: number,
  lineItems: CashSaleLineItemInput[],
): Promise<CashSaleActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'not-authenticated' };
  if (!cashSaleId || !Number.isInteger(expectedTermsVersion)) {
    return { ok: false, error: 'invalid-terms' };
  }

  const validated = validateCashSaleLineItems(lineItems);
  if (!validated.ok) {
    return { ok: false, error: 'invalid-terms', message: validated.message };
  }

  const result = actionResult(
    await orchestrator().replaceLineItems({
      actorId: userId,
      cashSaleId,
      expectedTermsVersion,
      lineItems: validated.value,
    }),
  );
  if (result.ok) {
    const recipientId = result.sale.buyerId === userId
      ? result.sale.sellerId
      : result.sale.buyerId;
    await createNotification({
      userId: recipientId,
      type: 'SALE',
      title: 'Contract items changed',
      body: 'The items in this contract were updated. Review and re-accept.',
      link: `/sales/${result.sale.id}`,
    });
  }
  return result;
}

/**
 * Read a contract's line items.
 *
 * Participant-scoped by RLS on `cash_sale_items`, but the orchestrator runs on
 * the service-role client, so membership is re-checked here for the same reason
 * every other write path does: authorization is enforced twice.
 */
export async function listCashSaleItems(
  cashSaleId: string,
): Promise<{ ok: true; items: CashSaleLineItem[] } | { ok: false; error: CashSaleActionError }> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'not-authenticated' };

  const supabase = await createClient();
  const { data: sale } = await supabase
    .from('cash_sales')
    .select('id, buyer_id, seller_id')
    .eq('id', cashSaleId)
    .maybeSingle();
  if (!sale) return { ok: false, error: 'cash-sale-not-found' };
  if (sale.buyer_id !== userId && sale.seller_id !== userId) {
    return { ok: false, error: 'not-participant' };
  }

  return { ok: true, items: await orchestrator().listLineItems(cashSaleId) };
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
  const result = actionResult(
    await orchestrator().updateTerms({
      actorId: userId,
      cashSaleId,
      expectedTermsVersion,
      terms,
    }),
  );
  if (result.ok) {
    const recipientId = result.sale.buyerId === userId
      ? result.sale.sellerId
      : result.sale.buyerId;
    await createNotification({
      userId: recipientId,
      type: 'SALE',
      title: 'Terms updated',
      body: 'The contract terms were revised. Review and re-accept to continue.',
      link: `/sales/${result.sale.id}`,
    });
  }
  return result;
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

  const result = actionResult(
    await orchestrator().proposePrice({
      actorId: userId,
      cashSaleId,
      expectedTermsVersion,
      agreedPriceCents,
    }),
  );
  if (result.ok) {
    const recipientId = result.sale.buyerId === userId
      ? result.sale.sellerId
      : result.sale.buyerId;
    await createNotification({
      userId: recipientId,
      type: 'SALE',
      title: 'Price proposed',
      body: 'A new price was proposed for your contract.',
      link: `/sales/${cashSaleId}`,
    });
  }
  return result;
}

/** Accept exactly the terms version shown; second acceptance starts payment. */
export async function acceptCashSaleTerms(
  cashSaleId: string,
  termsVersion: number,
): Promise<CashSaleActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'not-authenticated' };
  const result = actionResult(
    await orchestrator().acceptTerms({ actorId: userId, cashSaleId, termsVersion }),
  );
  if (result.ok) {
    const recipientId = result.sale.buyerId === userId
      ? result.sale.sellerId
      : result.sale.buyerId;
    await createNotification({
      userId: recipientId,
      type: 'SALE',
      title: 'Terms accepted',
      body: 'The other party accepted the contract terms.',
      link: `/sales/${cashSaleId}`,
    });
  }
  return result;
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
  const result = actionResult(
    await orchestrator().recordShipment({
      actorId: userId,
      cashSaleId,
      shipment: { carrier, trackingNumber },
    }),
  );
  if (result.ok) {
    await createNotification({
      userId: result.sale.buyerId,
      type: 'SALE',
      title: 'Item shipped',
      body: 'The seller has shipped your item.',
      link: `/sales/${cashSaleId}`,
    });
    void emailNotify.itemShipped({
      userId: result.sale.buyerId,
      contractType: 'sale',
      contractId: cashSaleId,
    });
  }
  return result;
}

export async function recordCashSaleReceipt(
  cashSaleId: string,
): Promise<CashSaleActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'not-authenticated' };
  const result = actionResult(
    await orchestrator().recordReceipt({ actorId: userId, cashSaleId }),
  );
  if (result.ok) {
    await createNotification({
      userId: result.sale.sellerId,
      type: 'SALE',
      title: 'Item received',
      body: 'The buyer confirmed receipt of your item.',
      link: `/sales/${cashSaleId}`,
    });
  }
  return result;
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
  const result = actionResult(
    await orchestrator().acceptInspection({ actorId: userId, cashSaleId }),
  );
  if (result.ok) {
    await createNotification({
      userId: result.sale.sellerId,
      type: 'SALE',
      title: 'Inspection approved',
      body: 'The buyer approved the item. Your payout is being processed.',
      link: `/sales/${cashSaleId}`,
    });
  }
  return result;
}

export async function confirmCashSaleHandover(
  cashSaleId: string,
): Promise<CashSaleActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'not-authenticated' };
  const result = actionResult(
    await orchestrator().confirmHandover({ actorId: userId, cashSaleId }),
  );
  if (result.ok) {
    const recipientId = result.sale.buyerId === userId
      ? result.sale.sellerId
      : result.sale.buyerId;
    await createNotification({
      userId: recipientId,
      type: 'SALE',
      title: 'Handover confirmed',
      body: 'The other party confirmed the in-person exchange.',
      link: `/sales/${result.sale.id}`,
    });
  }
  return result;
}

export async function cancelCashSaleAgreement(
  cashSaleId: string,
  reason?: string,
): Promise<CashSaleActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'not-authenticated' };
  const result = actionResult(
    await orchestrator().cancelAgreement({ actorId: userId, cashSaleId, reason }),
  );
  if (result.ok) {
    const recipientId = result.sale.buyerId === userId
      ? result.sale.sellerId
      : result.sale.buyerId;
    await createNotification({
      userId: recipientId,
      type: 'SALE',
      title: 'Contract cancelled',
      body: 'The other party cancelled the contract.',
      link: `/sales/${cashSaleId}`,
    });
  }
  return result;
}

export async function disputeCashSale(
  cashSaleId: string,
  reason: string,
): Promise<CashSaleActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'not-authenticated' };
  const result = actionResult(
    await orchestrator().raiseDispute({ actorId: userId, cashSaleId, reason }),
  );
  if (result.ok) {
    const recipientId = result.sale.buyerId === userId
      ? result.sale.sellerId
      : result.sale.buyerId;
    await createNotification({
      userId: recipientId,
      type: 'SALE',
      title: 'Dispute raised',
      body: 'A dispute has been raised on your contract. Please respond.',
      link: `/sales/${cashSaleId}`,
    });
    void emailNotify.disputeRaised({
      userId: recipientId,
      contractType: 'sale',
      contractId: cashSaleId,
    });
  }
  return result;
}

/**
 * Withdraw a dispute the caller raised (0084).
 *
 * The raiser-only rule is enforced in the orchestrator against `disputed_by`, not
 * here, because an exported Server Action is reachable by anyone who learns its id —
 * so the authorisation has to sit with the data, not with whichever UI called it.
 */
export async function withdrawCashSaleDispute(
  cashSaleId: string,
): Promise<CashSaleActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'not-authenticated' };
  if (!cashSaleId) return { ok: false, error: 'invalid-terms' };
  return actionResult(
    await orchestrator().withdrawDispute({ actorId: userId, cashSaleId }),
  );
}

/**
 * End a dispute by conceding it (0084).
 *
 * A Buyer may only release the Seller; a Seller may only refund the Buyer in full.
 * Both move money, so the outcome is re-validated against the caller's role in the
 * orchestrator — this function's own check only rejects values that are not
 * settlement outcomes at all, so a malformed call fails before touching the payment
 * seam.
 */
export async function settleCashSaleDispute(
  cashSaleId: string,
  outcome: PartySettlementOutcome,
): Promise<CashSaleActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'not-authenticated' };
  if (!cashSaleId) return { ok: false, error: 'invalid-terms' };
  if (outcome !== 'RELEASE_SELLER' && outcome !== 'REFUND_BUYER') {
    return {
      ok: false,
      error: 'invalid-terms',
      message: 'A partial refund has to be agreed by both sides, so support decides it.',
    };
  }
  return actionResult(
    await orchestrator().settleDisputeAsParty({ actorId: userId, cashSaleId, outcome }),
  );
}
