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
    // A fraud-banned Seller's release (0059). Shares the transfer-failed surface
    // with PAYOUT_FAILED, and deliberately gets NO distinct member-facing code.
    //
    // THREE REASONS IT MUST NOT READ AS SOMETHING TO FIX. The orchestrator states
    // that this money belongs to the victim or the platform, so there is no action
    // that recovers it — unlike SELLER_NOT_PAYABLE, which resolves itself once
    // onboarding finishes. The orchestrator also deliberately does NOT notify on
    // this path. And the banned account cannot reach any contract surface anyway:
    // `proxy.ts` redirects it to /account-suspended, which is the only screen it
    // sees. Accordingly this code is also absent from CASH_SALE_REFUSAL_COPY,
    // whose header records that operator-side failures are excluded on purpose.
    SELLER_FRAUD_BANNED: 'transfer-failed',
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
      body: 'The items in this contract were updated. Review them before you pay.',
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

/** Save a new version of fulfillment terms. */
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
      title: 'Handover updated',
      body: 'The meeting or postage details on this purchase were updated.',
      link: `/sales/${result.sale.id}`,
    });
  }
  return result;
}

/**
 * Propose a new agreed price (Req 4.3). The contract chat is notified
 * automatically: every contract event is mirrored into the thread by a database
 * trigger, so this action must not post its own message or the note would appear
 * twice.
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
    // Always the buyer: only the seller can reach this, so the recipient is not in
    // question any more and deriving it from the actor would just be a way to get it
    // wrong later.
    await createNotification({
      userId: result.sale.buyerId,
      type: 'SALE',
      title: 'The seller changed the price',
      // NO FIGURE HERE, deliberately. `CashSaleRecord` carries no currency field, and
      // the only way to print an amount from here would be `formatAud`, which is a
      // deprecated alias — hardcoding AUD into a money string is precisely the
      // "charged in one currency, displayed in another" bug the region work exists to
      // prevent. The contract room formats it correctly, so send them there.
      body: 'The item price on your contract has changed. Review it in the room before you pay.',
      link: `/sales/${cashSaleId}`,
    });
  }
  return result;
}

/** Buyer starts collection on the terms version shown. There is no confirm step. */
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
    await createNotification({
      userId: result.sale.sellerId,
      type: 'SALE',
      title: 'Payment started',
      body: 'The buyer is paying. You will be told when the funds are held.',
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

// ---------------------------------------------------------------------------
// Return-conditional refund actions (0088)
// ---------------------------------------------------------------------------

/** Input for {@link saveCashSaleReturnAddress}. */
export interface ReturnAddressInput {
  label: string;
  placeId?: string | null;
  countryCode?: string | null;
  lat?: number | null;
  lng?: number | null;
}

/**
 * Save (or update) the Seller's return address for a return-conditional refund.
 *
 * Written to `cash_sale_return_details`, a sibling table that the Buyer can read
 * ONLY while a return is owed (RETURN_PENDING / RETURN_IN_TRANSIT). The address is
 * disclosed once the Buyer needs to post; it is never visible before a dispute or
 * after the sale closes.
 *
 * Upsert is deliberate: the Seller correcting a typo is an update, not a delete-and-
 * recreate, and the migration explicitly does NOT grant DELETE.
 */
export async function saveCashSaleReturnAddress(
  cashSaleId: string,
  address: ReturnAddressInput,
): Promise<CashSaleActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'not-authenticated' };
  if (!cashSaleId) return { ok: false, error: 'invalid-terms' };

  const label = address.label?.trim();
  if (!label || label.length < 1 || label.length > 2000) {
    return { ok: false, error: 'invalid-terms', message: 'A return address is required.' };
  }

  // Validate the sale is in a return state and the caller is the seller.
  const supabase = await createClient();
  const { data: sale } = await supabase
    .from('cash_sales')
    .select('id, buyer_id, seller_id, status')
    .eq('id', cashSaleId)
    .maybeSingle();
  if (!sale) return { ok: false, error: 'cash-sale-not-found' };
  if (sale.seller_id !== userId) return { ok: false, error: 'not-permitted' };
  if (sale.status !== 'RETURN_PENDING' && sale.status !== 'RETURN_IN_TRANSIT') {
    return { ok: false, error: 'invalid-state', message: 'No return is in progress.' };
  }

  // Upsert via the cookie-bound client (RLS checks seller_id = auth.uid()).
  const { error } = await supabase.from('cash_sale_return_details').upsert(
    {
      cash_sale_id: cashSaleId,
      seller_id: userId,
      address_label: label,
      place_id: address.placeId?.trim() || null,
      country_code: address.countryCode || null,
      latitude: address.lat ?? null,
      longitude: address.lng ?? null,
    },
    { onConflict: 'cash_sale_id' },
  );
  if (error) {
    return { ok: false, error: 'invalid-terms', message: 'Could not save the return address.' };
  }

  revalidatePath(`/sales/${cashSaleId}`);

  // Notify the buyer that a return address is now available.
  await createNotification({
    userId: sale.buyer_id,
    type: 'SALE',
    title: 'Return address provided',
    body: 'The seller added a return address. You can now post the item back.',
    link: `/sales/${cashSaleId}`,
  });

  // Return the sale record via the orchestrator for result shape consistency.
  // syncTracking is a read-back that happens to refresh carrier state.
  const result = actionResult(
    await orchestrator().syncTracking({ actorId: userId, cashSaleId }),
  );
  // Even if sync fails (no tracking yet), the address save itself succeeded.
  if (!result.ok) {
    return { ok: true, sale: { id: cashSaleId } as CashSaleRecord };
  }
  return result;
}

/**
 * Record the Buyer posting the return shipment (0088).
 *
 * Buyer-only and once-only. Registers the shipment with the tracking provider so a
 * carrier confirmation can arrive on its own and release the refund without either
 * party asserting anything. Mirrors {@link recordCashSaleShipment} for the outbound
 * leg.
 */
export async function recordCashSaleReturnShipment(
  cashSaleId: string,
  carrier: string,
  trackingNumber: string,
): Promise<CashSaleActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'not-authenticated' };
  const result = actionResult(
    await orchestrator().recordReturnShipment({
      actorId: userId,
      cashSaleId,
      carrier,
      trackingNumber,
    }),
  );
  if (result.ok) {
    // Notify the seller that the return is on its way.
    await createNotification({
      userId: result.sale.sellerId,
      type: 'SALE',
      title: 'Return shipped',
      body: 'The buyer has posted the item back to you.',
      link: `/sales/${cashSaleId}`,
    });
    void emailNotify.itemShipped({
      userId: result.sale.sellerId,
      contractType: 'sale',
      contractId: cashSaleId,
    });
  }
  return result;
}

/**
 * The Seller contests a return — it arrived empty, damaged, or never came (0088).
 *
 * Freezes the automatic refund and hands the case back to arbitration. CAPTURES AND
 * RELEASES NOTHING by itself. Mirrors {@link disputeCashSale} for the main sale
 * dispute.
 */
export async function disputeCashSaleReturn(
  cashSaleId: string,
  reason: string,
): Promise<CashSaleActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'not-authenticated' };
  const result = actionResult(
    await orchestrator().disputeReturn({
      actorId: userId,
      cashSaleId,
      reason,
    }),
  );
  if (result.ok) {
    // Notify the buyer that their return is being contested.
    await createNotification({
      userId: result.sale.buyerId,
      type: 'SALE',
      title: 'Return disputed',
      body: 'The seller has contested the return. The case is back with support.',
      link: `/sales/${cashSaleId}`,
    });
    void emailNotify.disputeRaised({
      userId: result.sale.buyerId,
      contractType: 'sale',
      contractId: cashSaleId,
    });
  }
  return result;
}
