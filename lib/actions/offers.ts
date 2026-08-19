'use server';

// lib/actions/offers.ts
//
// Server Actions for buyer<->seller price Negotiation on listings (Phase 3).
// These are THIN wrappers that authenticate the caller and operate through the
// cookie-bound Supabase client so RLS enforces the two-party access rules on the
// `offers` table end-to-end:
//   * SELECT is granted only to the offer's buyer_id or seller_id.
//   * INSERT requires offered_by = auth.uid() and the caller to be one of the
//     two parties.
//   * UPDATE is granted to either party (transition rules are enforced here).
//
// A "negotiation" is the chain of offers between one buyer and one seller for a
// single item. Counters link back to the offer they replace via
// `parent_offer_id`; the newest PENDING offer in a chain is the "live" offer.
//
// Money is integer AUD cents end-to-end (`amount_cents`); the UI formats via
// `formatAud`. Every export is an async Server Action; shared shapes are
// `export type` only (type exports are erased and permitted in a 'use server'
// module).

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createNotification } from '@/lib/notifications/createNotification';
import { createDefaultCashSaleOrchestrator } from '@/domain/orchestrator/supabaseCashSaleRepository';
import { getPaymentService } from '@/domain/services';
import { formatAud } from '@/lib/format';
import { OFFER_AMOUNT_MIN, OFFER_AMOUNT_MAX } from '@/lib/marketplace-constants';
import { loadSellerIdentityDisclosure } from '@/lib/sellerIdentity';
import type { Tables, Enums } from '@/lib/supabase/database.types';
import { friendlyWriteFailure } from '@/lib/actions/writeFailure';

/** A persisted offer row. */
export type OfferRow = Tables<'offers'>;
/** The offer lifecycle status enum. */
export type OfferStatus = Enums<'offer_status'>;

/** A failed action result carrying a typed error code and optional detail. */
export interface ActionFailure<E extends string> {
  ok: false;
  error: E;
  detail?: string;
}

/** Resolve the current authenticated user id, or `null`. */
async function getUserId(
  client: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  const {
    data: { user },
  } = await client.auth.getUser();
  return user?.id ?? null;
}

/** Validate an offer amount is a whole number of cents within bounds. */
function isValidAmount(amountCents: number): boolean {
  return (
    Number.isInteger(amountCents) &&
    amountCents >= OFFER_AMOUNT_MIN &&
    amountCents <= OFFER_AMOUNT_MAX
  );
}

/** Normalize an optional message: trim, drop empties, cap length. */
function normalizeMessage(message: string | undefined | null): string | null {
  if (message == null) return null;
  const trimmed = message.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, 2000);
}

// ---------------------------------------------------------------------------
// makeOffer
// ---------------------------------------------------------------------------

/** Errors surfaced by {@link makeOffer}. */
export type MakeOfferError =
  | 'unauthenticated'
  | 'seller-identity-unverified'
  | 'seller-identity-changed'
  | 'confirmation-required'
  | 'item-not-found'
  | 'item-not-available'
  | 'self-offer'
  | 'invalid-amount'
  | 'persistence-error';

/** Result of {@link makeOffer}. */
export type MakeOfferResult =
  | { ok: true; offer: OfferRow }
  | ActionFailure<MakeOfferError>;

/**
 * Make a new PENDING offer on an item (opening a negotiation with its seller).
 *
 * The caller must be authenticated and VERIFIED and must NOT own the item. The
 * item is loaded (RLS returns it when AVAILABLE or owned) and must be AVAILABLE;
 * its `owner_id` becomes the offer's `seller_id`. The amount is validated to be
 * a whole number of cents in `1..99,999,999,999`.
 *
 * To keep a single active offer per buyer per item, any prior PENDING offer by
 * the same buyer on the same item is withdrawn first (set to WITHDRAWN).
 */
export async function makeOffer(
  itemId: string,
  amountCents: number,
  message: string | undefined,
  sellerIdentityVersion: string,
  buyerConfirmedSellerIdentity: boolean,
): Promise<MakeOfferResult> {
  const supabase = await createClient();

  const me = await getUserId(supabase);
  if (!me) return { ok: false, error: 'unauthenticated' };
  if (!buyerConfirmedSellerIdentity || !sellerIdentityVersion) {
    return { ok: false, error: 'confirmation-required' };
  }

  if (!isValidAmount(amountCents)) {
    return { ok: false, error: 'invalid-amount' };
  }

  // Load the item to resolve the seller (owner) and confirm availability.
  const { data: item } = await supabase
    .from('items')
    .select('id, owner_id, status, listing_kind')
    .eq('id', itemId)
    .maybeSingle();

  if (!item) return { ok: false, error: 'item-not-found' };
  if (item.owner_id === me) return { ok: false, error: 'self-offer' };
  // An offer is one amount against a whole listing, which means nothing on a
  // SHOPFRONT: "$40" for which cards? The request flow on a shopfront already
  // carries both the items and a price, so offers are refused rather than
  // silently recorded as an amount nobody can interpret (0064). The UI hides the
  // control; this is the second enforcement, since a Server Action is reachable
  // by anyone who knows its id.
  if (item.listing_kind === 'SHOPFRONT') {
    return { ok: false, error: 'item-not-available' };
  }
  if (item.status !== 'AVAILABLE') {
    return { ok: false, error: 'item-not-available' };
  }

  const sellerIdentity = await loadSellerIdentityDisclosure(item.owner_id);
  if (!sellerIdentity) {
    return { ok: false, error: 'seller-identity-unverified' };
  }
  if (sellerIdentity.version !== sellerIdentityVersion) {
    return { ok: false, error: 'seller-identity-changed' };
  }
  const buyerSellerIdentityConfirmedAt = new Date().toISOString();

  // Keep one active offer per buyer per item: withdraw any prior PENDING offer
  // this buyer already has open on this item. Best-effort; RLS scopes the update
  // to the caller's own offers.
  await supabase
    .from('offers')
    .update({ status: 'WITHDRAWN' })
    .eq('item_id', itemId)
    .eq('buyer_id', me)
    .eq('status', 'PENDING');

  const { data: inserted, error } = await supabase
    .from('offers')
    .insert({
      item_id: itemId,
      seller_id: item.owner_id,
      buyer_id: me,
      offered_by: me,
      amount_cents: amountCents,
      status: 'PENDING',
      message: normalizeMessage(message),
      seller_identity_version: sellerIdentity.version,
      buyer_seller_identity_confirmed_at: buyerSellerIdentityConfirmedAt,
    })
    .select('*')
    .single();

  if (error || !inserted) {
    return {
      ok: false,
      error: 'persistence-error',
      detail: friendlyWriteFailure(error, 'Failed to create offer'),
    };
  }

  // Best-effort: notify the seller of the new offer. Never blocks the result.
  await createNotification({
    userId: item.owner_id,
    type: 'OFFER',
    title: 'New offer received',
    body: `You received an offer of ${formatAud(amountCents)}.`,
    link: '/offers',
  });

  return { ok: true, offer: inserted as OfferRow };
}

// ---------------------------------------------------------------------------
// counterOffer
// ---------------------------------------------------------------------------

/** Errors surfaced by {@link counterOffer}. */
export type CounterOfferError =
  | 'unauthenticated'
  | 'offer-not-found'
  | 'not-participant'
  | 'cannot-counter-own-offer'
  | 'invalid-status'
  | 'invalid-amount'
  | 'persistence-error';

/** Result of {@link counterOffer}. */
export type CounterOfferResult =
  | { ok: true; offer: OfferRow }
  | ActionFailure<CounterOfferError>;

/**
 * Counter the latest offer in a negotiation. The recipient of a PENDING offer
 * (a party who did NOT make it) responds with a new amount: the original offer
 * is marked COUNTERED and a NEW PENDING offer is inserted with
 * `parent_offer_id = offerId`, preserving the buyer/seller pair and setting
 * `offered_by = caller`.
 *
 * Only PENDING offers can be countered, and the caller must be a party but not
 * the one who made the offer being countered.
 */
export async function counterOffer(
  offerId: string,
  amountCents: number,
  message?: string,
): Promise<CounterOfferResult> {
  const supabase = await createClient();

  const me = await getUserId(supabase);
  if (!me) return { ok: false, error: 'unauthenticated' };

  if (!isValidAmount(amountCents)) {
    return { ok: false, error: 'invalid-amount' };
  }

  // RLS returns the offer only to its two parties, so a missing row is either
  // absent or not visible to the caller.
  const { data: original } = await supabase
    .from('offers')
    .select('*')
    .eq('id', offerId)
    .maybeSingle();

  if (!original) return { ok: false, error: 'offer-not-found' };
  const offer = original as OfferRow;

  if (offer.buyer_id !== me && offer.seller_id !== me) {
    return { ok: false, error: 'not-participant' };
  }
  if (offer.status !== 'PENDING') {
    return { ok: false, error: 'invalid-status' };
  }
  // The party who made the offer cannot counter their own offer.
  if (offer.offered_by === me) {
    return { ok: false, error: 'cannot-counter-own-offer' };
  }

  // Mark the original as COUNTERED. RLS permits either party to update.
  const { error: updateError } = await supabase
    .from('offers')
    .update({ status: 'COUNTERED' })
    .eq('id', offerId)
    .eq('status', 'PENDING');

  if (updateError) {
    return {
      ok: false,
      error: 'persistence-error',
      detail: updateError.message,
    };
  }

  const { data: inserted, error } = await supabase
    .from('offers')
    .insert({
      item_id: offer.item_id,
      seller_id: offer.seller_id,
      buyer_id: offer.buyer_id,
      offered_by: me,
      amount_cents: amountCents,
      status: 'PENDING',
      parent_offer_id: offerId,
      message: normalizeMessage(message),
      seller_identity_version: offer.seller_identity_version,
      buyer_seller_identity_confirmed_at: offer.buyer_seller_identity_confirmed_at,
    })
    .select('*')
    .single();

  if (error || !inserted) {
    // Rollback original offer to PENDING if counter insertion failed
    await supabase
      .from('offers')
      .update({ status: 'PENDING' })
      .eq('id', offerId)
      .eq('status', 'COUNTERED');

    return {
      ok: false,
      error: 'persistence-error',
      detail: friendlyWriteFailure(error, 'Failed to create counter offer'),
    };
  }

  // Best-effort: notify the OTHER party (the one who did not counter).
  const counterRecipient =
    offer.buyer_id === me ? offer.seller_id : offer.buyer_id;
  await createNotification({
    userId: counterRecipient,
    type: 'OFFER',
    title: 'Counter offer received',
    body: `You received a counter offer of ${formatAud(amountCents)}.`,
    link: '/offers',
  });

  return { ok: true, offer: inserted as OfferRow };
}

// ---------------------------------------------------------------------------
// respondToOffer
// ---------------------------------------------------------------------------

/** The response a party can take on a PENDING offer. */
export type OfferAction = 'accept' | 'decline' | 'withdraw';

/** Errors surfaced by {@link respondToOffer}. */
export type RespondToOfferError =
  | 'unauthenticated'
  | 'offer-not-found'
  | 'not-participant'
  | 'invalid-status'
  | 'not-permitted'
  | 'sale-failed'
  | 'persistence-error';

/**
 * Result of {@link respondToOffer}. On an `accept`, a Cash_Sale escrow is
 * opened at the agreed price and its id is returned as `saleId` so the UI can
 * route the parties to the sale.
 */
export type RespondToOfferResult =
  | { ok: true; offer: OfferRow; saleId?: string }
  | ActionFailure<RespondToOfferError>;

/**
 * Respond to a PENDING offer.
 *
 *   * `accept`   — only the party who did NOT make the offer may accept. This
 *                  OPENS A CASH_SALE ESCROW at the agreed price (reserving the
 *                  item and requesting the buyer's transfer via the payment
 *                  service) and then marks the offer ACCEPTED. If the escrow
 *                  cannot be opened (e.g. the item is no longer AVAILABLE), the
 *                  offer is left PENDING and `sale-failed` is returned.
 *   * `decline`  — only the non-offering party may decline; sets DECLINED.
 *   * `withdraw` — only the offering party may withdraw; sets WITHDRAWN.
 *
 * Only PENDING offers can transition; any other status yields `invalid-status`.
 */
export async function respondToOffer(
  offerId: string,
  action: OfferAction,
): Promise<RespondToOfferResult> {
  const supabase = await createClient();

  const me = await getUserId(supabase);
  if (!me) return { ok: false, error: 'unauthenticated' };

  const { data: existing } = await supabase
    .from('offers')
    .select('*')
    .eq('id', offerId)
    .maybeSingle();

  if (!existing) return { ok: false, error: 'offer-not-found' };
  const offer = existing as OfferRow;

  if (offer.buyer_id !== me && offer.seller_id !== me) {
    return { ok: false, error: 'not-participant' };
  }
  if (offer.status !== 'PENDING') {
    return { ok: false, error: 'invalid-status' };
  }

  const madeByMe = offer.offered_by === me;
  const otherParty = offer.buyer_id === me ? offer.seller_id : offer.buyer_id;

  // ---- withdraw: only the offering party ----
  if (action === 'withdraw') {
    if (!madeByMe) return { ok: false, error: 'not-permitted' };
    const { data: updated, error } = await supabase
      .from('offers')
      .update({ status: 'WITHDRAWN' })
      .eq('id', offerId)
      .eq('status', 'PENDING')
      .select('*')
      .maybeSingle();
    if (error) return { ok: false, error: 'persistence-error', detail: error.message };
    if (!updated) return { ok: false, error: 'invalid-status' };
    await notifyOfferOutcome(otherParty, 'WITHDRAWN', offer.amount_cents);
    return { ok: true, offer: updated as OfferRow };
  }

  // ---- accept / decline: only the recipient (non-offering party) ----
  if (madeByMe) return { ok: false, error: 'not-permitted' };

  if (action === 'decline') {
    const { data: updated, error } = await supabase
      .from('offers')
      .update({ status: 'DECLINED' })
      .eq('id', offerId)
      .eq('status', 'PENDING')
      .select('*')
      .maybeSingle();
    if (error) return { ok: false, error: 'persistence-error', detail: error.message };
    if (!updated) return { ok: false, error: 'invalid-status' };
    await notifyOfferOutcome(otherParty, 'DECLINED', offer.amount_cents);
    return { ok: true, offer: updated as OfferRow };
  }

  // ---- accept: open the purchase contract FIRST, then mark ACCEPTED ----
  // The contract reserves the item at the agreed price and carries the buyer's
  // seller-identity acknowledgement, but collects no money: both parties still
  // have to accept fulfillment terms in the contract room (Req 4.21). Opening it
  // before the status change means a failure (e.g. the item was just reserved
  // elsewhere) leaves the offer PENDING rather than stranding an ACCEPTED offer.
  const cashSales = createDefaultCashSaleOrchestrator({ payments: getPaymentService() });
  const saleResult = await cashSales.initiateCashSale({
    buyerId: offer.buyer_id,
    itemId: offer.item_id,
    agreedPriceCents: offer.amount_cents,
    sellerIdentityVersion: offer.seller_identity_version ?? '',
    buyerConfirmedSellerIdentity: Boolean(offer.buyer_seller_identity_confirmed_at),
  });
  if (!saleResult.ok) {
    return { ok: false, error: 'sale-failed', detail: saleResult.error };
  }
  const saleId = saleResult.sale.id;

  const { data: updated, error } = await supabase
    .from('offers')
    .update({ status: 'ACCEPTED' })
    .eq('id', offerId)
    .eq('status', 'PENDING')
    .select('*')
    .maybeSingle();
  if (error || !updated) {
    // If updating offer failed, rollback the newly initiated cash sale so the item is not locked
    try {
      const admin = createAdminClient();
      await admin.from('cash_sales').update({ status: 'CANCELLED' }).eq('id', saleId);
      await admin.from('items').update({ status: 'AVAILABLE' }).eq('id', offer.item_id);
    } catch {
      // best-effort cleanup
    }
    return { ok: false, error: 'persistence-error', detail: error?.message ?? 'Offer status conflict' };
  }

  // Best-effort: decline any other PENDING offers on this now-reserved item so
  // other buyers aren't left with dangling live offers. Uses the service-role
  // client because those offers belong to other buyer/seller pairs.
  try {
    const admin = createAdminClient();
    await admin
      .from('offers')
      .update({ status: 'DECLINED' })
      .eq('item_id', offer.item_id)
      .eq('status', 'PENDING')
      .neq('id', offerId);
  } catch {
    // best-effort; the item reservation already takes it off-market.
  }

  // Notify the buyer (the offering party) that their offer was accepted and a
  // sale has been opened.
  await createNotification({
    userId: offer.buyer_id,
    type: 'SALE',
    title: 'Offer accepted',
    body: `Your offer of ${formatAud(offer.amount_cents)} was accepted. Agree the fulfillment terms to continue.`,
    link: `/sales/${saleId}`,
  });

  // Notify the seller so they can navigate to the contract room directly.
  await createNotification({
    userId: offer.seller_id,
    type: 'SALE',
    title: 'Sale started',
    body: `You accepted an offer of ${formatAud(offer.amount_cents)}. Open the contract to set fulfillment terms.`,
    link: `/sales/${saleId}`,
  });

  return { ok: true, offer: (updated as OfferRow) ?? offer, saleId };
}

/** Best-effort notification to the counterparty about an offer outcome. */
async function notifyOfferOutcome(
  recipientId: string,
  status: OfferStatus,
  amountCents: number,
): Promise<void> {
  const TITLE: Record<OfferStatus, string> = {
    ACCEPTED: 'Offer accepted',
    DECLINED: 'Offer declined',
    WITHDRAWN: 'Offer withdrawn',
    PENDING: 'Offer updated',
    COUNTERED: 'Offer countered',
  };
  await createNotification({
    userId: recipientId,
    type: 'OFFER',
    title: TITLE[status] ?? 'Offer updated',
    body: `An offer of ${formatAud(amountCents)} was ${status.toLowerCase()}.`,
    link: '/offers',
  });
}

// ---------------------------------------------------------------------------
// listOffersForItem
// ---------------------------------------------------------------------------

/** Errors surfaced by {@link listOffersForItem}. */
export type ListOffersForItemError = 'unauthenticated' | 'persistence-error';

/** Result of {@link listOffersForItem}. */
export type ListOffersForItemResult =
  | { ok: true; offers: OfferRow[] }
  | ActionFailure<ListOffersForItemError>;

/**
 * Return the negotiation thread for an item between the caller and their
 * counterparty, ordered oldest-first. RLS returns only offers the caller is a
 * party to, so a buyer sees their own thread and a seller sees the threads they
 * are involved in for that item.
 */
export async function listOffersForItem(
  itemId: string,
): Promise<ListOffersForItemResult> {
  const supabase = await createClient();

  const me = await getUserId(supabase);
  if (!me) return { ok: false, error: 'unauthenticated' };

  const { data, error } = await supabase
    .from('offers')
    .select('*')
    .eq('item_id', itemId)
    .order('created_at', { ascending: true });

  if (error) {
    return { ok: false, error: 'persistence-error', detail: error.message };
  }

  return { ok: true, offers: (data ?? []) as OfferRow[] };
}

// ---------------------------------------------------------------------------
// listMyOffers
// ---------------------------------------------------------------------------

/** The caller's role in a negotiation. */
export type OfferRole = 'buyer' | 'seller';

/** A negotiation summarized for the account "Offers" tab. */
export interface MyOfferEntry {
  /** The id of the latest (live) offer in the negotiation. */
  offerId: string;
  itemId: string;
  /** Item title when RLS allows reading the item; otherwise null. */
  itemTitle: string | null;
  /** First image object path when readable; otherwise null. */
  itemImagePath: string | null;
  /** The counterparty's user id. */
  counterpartyId: string;
  /** The counterparty's public display name (from public_profiles) or null. */
  counterpartyName: string | null;
  /** The latest offered amount, in integer AUD cents. */
  amountCents: number;
  /** The latest offer's status. */
  status: OfferStatus;
  /** Whether the caller is the buyer or the seller in this negotiation. */
  role: OfferRole;
  /** True when the caller made the latest offer. */
  offeredByMe: boolean;
  /**
   * True when the latest offer is PENDING and was made by the counterparty —
   * i.e. it is the caller's turn to accept / decline / counter.
   */
  isMyTurn: boolean;
  /** True when the caller made the latest PENDING offer and may withdraw it. */
  canWithdraw: boolean;
  /** ISO timestamp of the latest offer. */
  updatedAt: string;
}

/** Errors surfaced by {@link listMyOffers}. */
export type ListMyOffersError = 'unauthenticated' | 'persistence-error';

/** Result of {@link listMyOffers}. */
export type ListMyOffersResult =
  | { ok: true; offers: MyOfferEntry[] }
  | ActionFailure<ListMyOffersError>;

/** Stable key for a negotiation: one item + one buyer + one seller. */
function negotiationKey(offer: OfferRow): string {
  return `${offer.item_id}::${offer.buyer_id}::${offer.seller_id}`;
}

/**
 * List the caller's negotiations (as buyer or seller), newest activity first.
 * Offers are grouped into negotiations (item + buyer + seller); each entry
 * carries the latest offer, enriched with the item title + first image (via
 * `items`, tolerating null under RLS) and the counterparty's display name (via
 * `public_profiles`). Also computes the caller's role and whether it's their
 * turn to respond.
 */
export async function listMyOffers(): Promise<ListMyOffersResult> {
  const supabase = await createClient();

  const me = await getUserId(supabase);
  if (!me) return { ok: false, error: 'unauthenticated' };

  // RLS scopes this to offers where the caller is buyer_id or seller_id.
  const { data, error } = await supabase
    .from('offers')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return { ok: false, error: 'persistence-error', detail: error.message };
  }

  const rows = (data ?? []) as OfferRow[];

  // Collapse each negotiation to its latest offer. Rows arrive newest-first, so
  // the first row seen per key is the live offer.
  const latestByKey = new Map<string, OfferRow>();
  for (const row of rows) {
    const key = negotiationKey(row);
    if (!latestByKey.has(key)) {
      latestByKey.set(key, row);
    }
  }

  const latest = Array.from(latestByKey.values());
  if (latest.length === 0) {
    return { ok: true, offers: [] };
  }

  // Batch the enrichment lookups; each tolerates missing rows (null).
  const itemIds = Array.from(new Set(latest.map((o) => o.item_id)));
  const counterpartyIds = Array.from(
    new Set(
      latest.map((o) => (o.buyer_id === me ? o.seller_id : o.buyer_id)),
    ),
  );

  const [itemsRes, profilesRes] = await Promise.all([
    supabase.from('items').select('id, title, image_paths').in('id', itemIds),
    supabase
      .from('public_profiles')
      .select('id, display_name')
      .in('id', counterpartyIds),
  ]);

  const itemById = new Map<string, { title: string; imagePath: string | null }>(
    (itemsRes.data ?? []).map((it) => [
      it.id as string,
      {
        title: it.title as string,
        imagePath: ((it.image_paths as string[] | null) ?? [])[0] ?? null,
      },
    ]),
  );

  const nameById = new Map<string, string | null>(
    (profilesRes.data ?? []).map((p) => [
      p.id as string,
      (p.display_name as string | null) ?? null,
    ]),
  );

  const entries: MyOfferEntry[] = latest.map((offer) => {
    const role: OfferRole = offer.buyer_id === me ? 'buyer' : 'seller';
    const counterpartyId = role === 'buyer' ? offer.seller_id : offer.buyer_id;
    const offeredByMe = offer.offered_by === me;
    const isPending = offer.status === 'PENDING';
    const item = itemById.get(offer.item_id) ?? null;
    return {
      offerId: offer.id,
      itemId: offer.item_id,
      itemTitle: item?.title ?? null,
      itemImagePath: item?.imagePath ?? null,
      counterpartyId,
      counterpartyName: nameById.get(counterpartyId) ?? null,
      amountCents: offer.amount_cents,
      status: offer.status,
      role,
      offeredByMe,
      isMyTurn: isPending && !offeredByMe,
      canWithdraw: isPending && offeredByMe,
      updatedAt: offer.updated_at,
    };
  });

  return { ok: true, offers: entries };
}