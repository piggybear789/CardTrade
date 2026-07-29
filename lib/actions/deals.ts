'use server';

// lib/actions/deals.ts
//
// Server Actions for the PRIVATE 1:1 BINDING DEAL ("deal room"). A deal is not a
// public listing: one member creates it SOLO (details only), shares a private
// LINK, and whoever opens that link JOINS as the counterparty. The two of them
// then agree a handover, BOTH tick "I'm happy with the deal", and only then does
// the binding contract engage — collateral escrow holds on both parties.
//
// State machine (cardtrade.deal_state):
//
//   INVITED ──join via link──> TERMS ──terms complete──> CONFIRMATION
//      │  (created, unjoined)   │                            │
//      │                        │                            │ both confirmed
//      ▼                        ▼                            ▼
//   CANCELLED <──cancel──┴──────────────────── ESCROW_PENDING
//                                                      │ holds active
//                                                      ▼
//                                                ESCROW_LOCKED
//                                                  │        │
//                                    both marked   │        │ dispute
//                                       complete   ▼        ▼
//                                            COMPLETED   DISPUTED
//
// Authorization model:
//   * Every action runs through the cookie-bound client so RLS enforces the
//     two-party access rules on `deals` / `deal_events` (only creator_id or
//     counterparty_id may select; either party may update; parties may insert
//     events). A non-participant sees no row, surfaced as `not-participant`.
//   * The SERVICE-ROLE admin client is used ONLY where RLS makes the write/read
//     impossible for an end user: (a) looking up a deal by its `share_token`
//     (there is deliberately no token-based RLS policy — the token IS the
//     capability, validated here, and only a MINIMAL PREVIEW is returned),
//     (b) the guarded join write that sets `counterparty_id` (the joiner is not
//     yet a participant, so RLS would hide the row), (c) reading/creating the
//     provider payer ref for the escrow step, and (d) inserting/updating
//     `deal_holds`, which has no end-user insert policy.
//
// IDENTITY OR MONEY: a deal does NOT require KYC. Verification is offered on the
// way in (see `app/deals/new/page.tsx`) and may be skipped — an unverified party
// backs the deal with collateral instead. `domain/deal/dealCollateral.ts` owns
// that rule; when both parties are verified no collateral is held at all.
//
// CRITICAL RULE mirrored from the database: a BEFORE UPDATE trigger on `deals`
// NULLS both `*_confirmed_at` columns and bumps `terms_updated_at` whenever a
// substantive term changes. These actions never try to preserve confirmations
// across a terms edit — the DB owns that, and the UI surfaces it as
// "Terms changed — both parties must confirm again".
//
// Money is integer AUD cents end-to-end; the UI formats via `formatAud`.
// Every export is an async Server Action or an erased `export type`.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createNotification } from '@/lib/notifications/createNotification';
import { getPaymentService } from '@/domain/services';
import {
  resolveDealCollateral,
  type DealCollateralOutcome,
} from '@/domain/deal/dealCollateral';
import { formatAud } from '@/lib/format';
import {
  removeImages,
  uploadImages,
  type ImageUpload,
} from '@/lib/storage/itemImages';
import {
  DEAL_CASH_MAX,
  DEAL_CASH_MIN,
  DEAL_COLLATERAL_MAX,
  DEAL_COLLATERAL_MIN,
  DEAL_DEFAULT_COLLATERAL_CENTS,
  DEAL_DELIVERY_COST_MAX,
  DEAL_DELIVERY_COST_MIN,
  DEAL_EVENT_COMPLETE_MARKED,
  DEAL_OFFER_KINDS,
  DEAL_PHOTOS_MAX,
  DEAL_PHOTOS_MIN,
  DEAL_REASON_MAX,
  DEAL_ROLES,
  DEAL_TEXT_MAX,
  DEAL_TITLE_MAX,
  DEAL_TITLE_MIN,
} from '@/lib/marketplace-constants';
import type { Enums, Tables, TablesUpdate } from '@/lib/supabase/database.types';

// ---------------------------------------------------------------------------
// Shared shapes (type-only exports are erased and permitted in 'use server')
// ---------------------------------------------------------------------------

/** A persisted deal row. */
export type DealRow = Tables<'deals'>;
/** A deal audit/timeline row. */
export type DealEventRow = Tables<'deal_events'>;
/** A collateral hold row belonging to a deal. */
export type DealHoldRow = Tables<'deal_holds'>;
/** The deal lifecycle state enum. */
export type DealState = Enums<'deal_state'>;
/** How the two parties hand over: meet in person, or ship/deliver. */
export type HandoverMethod = Enums<'handover_method'>;

/** A failed action result carrying a typed error code and optional detail. */
export interface ActionFailure<E extends string> {
  ok: false;
  error: E;
  detail?: string;
}

/** Errors common to the authentication + participant guard. */
export type DealAuthError = 'unauthenticated' | 'not-participant';

/** The caller's public-facing view of one party in the deal. */
export interface DealParty {
  id: string;
  displayName: string | null;
  rating: number | null;
  ratingCount: number;
  isVerified: boolean;
  /** True when this party has ticked "I'm happy with the deal". */
  confirmedAt: string | null;
  /**
   * Which side this party is on. The creator's declared `creator_role`, and its
   * mirror for the counterparty (a BUYER's counterparty is the SELLER).
   */
  role: DealRole | null;
  /** Completed cash sales — the same reputation figure the sale contract shows. */
  completedSales: number;
  /** Completed cash purchases. */
  completedPurchases: number;
}

// ---------------------------------------------------------------------------
// Internal helpers (not exported — a 'use server' module may only export
// async functions, and these are deliberately server-internal anyway)
// ---------------------------------------------------------------------------

type CookieClient = Awaited<ReturnType<typeof createClient>>;

/** Resolve the current authenticated user id, or `null`. */
async function getUserId(client: CookieClient): Promise<string | null> {
  const {
    data: { user },
  } = await client.auth.getUser();
  return user?.id ?? null;
}

/**
 * Read each party's verification flag. Reads the `public_profiles` view, which
 * exposes only `is_verified` (never the underlying KYC detail) and is readable
 * by any authenticated member. Verification is no longer a gate — it decides how
 * much collateral the deal holds (see {@link collateralForDeal}).
 */
async function readVerification(
  client: CookieClient,
  partyIds: string[],
): Promise<Map<string, boolean>> {
  const { data } = await client
    .from('public_profiles')
    .select('id, is_verified')
    .in('id', partyIds);
  return new Map(
    (data ?? []).map((row) => [row.id as string, Boolean(row.is_verified)]),
  );
}

/** Trim a free-text field, dropping empties and capping length. */
function normalizeText(
  value: string | null | undefined,
  max = DEAL_TEXT_MAX,
): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, max);
}

function finiteCoord(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

/**
 * Render a DELIVERY handover as human-readable `delivery_details`: the postage
 * price (which is what makes the handover complete) plus any shipping notes the
 * parties added. `delivery_cost_cents` stays the machine-readable source of
 * truth for the money.
 */
function describeDelivery(costCents: number, notes: string | null): string {
  const priceLine =
    costCents === 0
      ? 'Delivered — free delivery.'
      : `Delivered — ${formatAud(costCents)} delivery on top of the cash amount.`;
  return notes ? `${priceLine}\n${notes}` : priceLine;
}

/** True when the handover terms are fully specified for the chosen method. */
function areTermsComplete(deal: DealRow): boolean {
  if (deal.handover_method === 'IN_PERSON') {
    return Boolean(deal.meeting_location && deal.meeting_location.trim());
  }
  if (deal.handover_method === 'DELIVERY') {
    return Boolean(deal.delivery_details && deal.delivery_details.trim());
  }
  return false;
}

/** The tuned bounds the pure collateral policy is evaluated against. */
const DEAL_COLLATERAL_POLICY = {
  defaultCents: DEAL_DEFAULT_COLLATERAL_CENTS,
  minCents: DEAL_COLLATERAL_MIN,
  maxCents: DEAL_COLLATERAL_MAX,
};

/**
 * Collateral held per party when the binding contract engages, per
 * `domain/deal/dealCollateral.ts`: nothing when both parties are identity
 * verified, otherwise BOTH post the deal's stake (its agreed
 * `collateral_cents`, else its cash component, else the flat default).
 *
 * Pass `counterparty: null` for an unjoined deal — the outcome then describes
 * only the creator, and `stakeCents` is what both sides would post if an
 * unverified member takes the share link.
 */
function collateralForDeal(
  deal: DealRow,
  verified: { creator: boolean; counterparty: boolean | null },
): DealCollateralOutcome {
  return resolveDealCollateral({
    creator: verified.creator,
    counterparty: verified.counterparty,
    basis: {
      collateralCents: deal.collateral_cents,
      cashAmountCents: deal.cash_amount_cents,
    },
    policy: DEAL_COLLATERAL_POLICY,
  });
}

/**
 * The other party's user id, given the caller — or `null` when the deal has not
 * been joined yet (a link-created deal starts with no counterparty).
 */
function otherPartyOf(deal: DealRow, me: string): string | null {
  return deal.creator_id === me ? deal.counterparty_id : deal.creator_id;
}

/** Append a timeline row. Best-effort: never fails the caller's happy path. */
async function logDealEvent(
  client: CookieClient,
  input: {
    dealId: string;
    actorId: string | null;
    event: string;
    fromState?: DealState | null;
    toState?: DealState | null;
    detail?: string | null;
  },
): Promise<void> {
  try {
    await client.from('deal_events').insert({
      deal_id: input.dealId,
      actor_id: input.actorId,
      event: input.event,
      from_state: input.fromState ?? null,
      to_state: input.toState ?? null,
      detail: input.detail ?? null,
    });
  } catch {
    // The audit row is a side effect of a successful mutation, not a gate.
  }
}

/**
 * Resolve-or-create the deal's participant-only chat thread and link it to the
 * deal, returning the conversation id (or `null` when it cannot be opened).
 *
 * Runs through the SERVICE-ROLE client because the guarded resolve-or-create is
 * a `security definer`-style RPC granted to `service_role` only: it re-checks
 * that the actor is one of the two parties, dedupes on `deal_id`, and links the
 * thread in one transaction (mirrors `attach_cash_sale_conversation`).
 */
async function openDealConversation(
  dealId: string,
  actorId: string,
): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('ensure_deal_conversation', {
      p_deal_id: dealId,
      p_actor_id: actorId,
    });
    if (error) return null;
    return (data as string | null) ?? null;
  } catch {
    return null;
  }
}

/** Best-effort in-app notification about a deal. */
async function notifyDeal(
  userId: string,
  title: string,
  body: string,
  dealId: string,
): Promise<void> {
  await createNotification({
    userId,
    type: 'TRADE',
    title,
    body,
    link: `/deals/${dealId}`,
  });
}

type ParticipantContext = {
  supabase: CookieClient;
  userId: string;
  deal: DealRow;
  iAmCreator: boolean;
};

/**
 * Authenticate the caller and confirm they are one of the deal's two parties,
 * returning the loaded row. Because RLS hides deals from non-participants, a
 * missing row is reported as `not-participant`.
 */
async function requireParticipant(
  dealId: string,
): Promise<
  { ok: true; ctx: ParticipantContext } | ActionFailure<DealAuthError>
> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);
  if (!userId) return { ok: false, error: 'unauthenticated' };

  const { data } = await supabase
    .from('deals')
    .select('*')
    .eq('id', dealId)
    .maybeSingle();
  if (!data) return { ok: false, error: 'not-participant' };

  const deal = data as DealRow;
  if (deal.creator_id !== userId && deal.counterparty_id !== userId) {
    return { ok: false, error: 'not-participant' };
  }

  return {
    ok: true,
    ctx: { supabase, userId, deal, iAmCreator: deal.creator_id === userId },
  };
}

// ---------------------------------------------------------------------------
// createDeal — create a private deal SOLO; a share link brings the other party
// ---------------------------------------------------------------------------

/** Which side the creator is on. Decides the meaning of the cash component. */
export type DealRole = Enums<'deal_role'>;

/** What a TRADER creator is putting up. `ITEMS` requires photos. */
export type DealOfferKind = (typeof DEAL_OFFER_KINDS)[number];

/** A photo of the goods the creator brings (raw file or base64 payload). */
export type DealPhotoUpload = ImageUpload;

/** Input for {@link createDeal}. There is no counterparty at creation time. */
export interface CreateDealInput {
  title: string;
  /**
   * The side the caller is on:
   * - `BUYER`  — the caller pays `cashAmountCents`.
   * - `SELLER` — the caller receives `cashAmountCents`, and must attach photos.
   * - `TRADER` — the caller puts up `offerKinds`; `ITEMS` requires photos.
   */
  role: DealRole;
  /** Everything the parties should know: condition, grading, terms, extras. */
  description?: string;
  /**
   * Cash component in integer AUD cents. Required for `BUYER` (what they pay)
   * and `SELLER` (what they receive); for `TRADER` it is required only when
   * `offerKinds` includes `CASH`.
   */
  cashAmountCents?: number;
  /** `TRADER` only: what the caller puts up (at least one kind). */
  offerKinds?: DealOfferKind[];
  /** Photos of the goods the caller brings. */
  photos?: DealPhotoUpload[];
  /** How the goods change hands: meet face to face, or ship/deliver. */
  handoverMethod: HandoverMethod;
  /** Required when `handoverMethod === 'IN_PERSON'`. */
  meetingLocation?: string;
  /** Optional Mapbox coords for an in-person meeting pin. */
  meetingLat?: number | null;
  meetingLng?: number | null;
  meetingPlaceId?: string | null;
  /** Optional ISO timestamp for an in-person meeting. */
  meetingAt?: string | null;
  /**
   * `DELIVERY` only: postage cost in integer AUD cents, charged ON TOP of
   * `cashAmountCents`. Required for a delivery handover; `0` means free.
   */
  deliveryCostCents?: number;
  /** Optional shipping notes for a `DELIVERY` handover (carrier, timing…). */
  deliveryDetails?: string;
}

/** Errors surfaced by {@link createDeal}. */
export type CreateDealError =
  | 'unauthenticated'
  | 'invalid-title'
  | 'invalid-role'
  | 'invalid-offer-kinds'
  | 'invalid-cash'
  | 'photos-required'
  | 'too-many-photos'
  | 'upload-failed'
  | 'invalid-handover'
  | 'missing-meeting-location'
  | 'invalid-delivery-cost'
  | 'persistence-error';

/** Result of {@link createDeal}: the new deal plus its shareable join token. */
export type CreateDealResult =
  | { ok: true; dealId: string; shareToken: string }
  | ActionFailure<CreateDealError>;

/**
 * Create a private 1:1 deal SOLO (step 1 of the flow) — details only, no
 * counterparty.
 *
 * The caller must be authenticated and must declare which SIDE they are on.
 * Identity verification is NOT required: an unverified creator backs the deal
 * with collateral once both parties confirm (see `domain/deal/dealCollateral.ts`).
 * The role decides what the rest of the input means:
 *
 * | role   | cash component            | photos                        |
 * |--------|---------------------------|-------------------------------|
 * | BUYER  | what the caller PAYS      | not needed (they bring cash)  |
 * | SELLER | what the caller RECEIVES  | REQUIRED — they bring goods   |
 * | TRADER | only when `CASH` is offered| REQUIRED when `ITEMS` offered |
 *
 * `cash_payer_id` is set to the caller when they are the one paying (BUYER, or a
 * TRADER putting cash up). A SELLER's payer is the joiner, who does not exist
 * yet, so it stays NULL and is filled in by {@link joinDealByToken}.
 *
 * The METHOD OF EXCHANGE is also settled here: `IN_PERSON` needs a meeting
 * location (a time is optional), `DELIVERY` needs delivery details. Either party
 * can still renegotiate it later via {@link updateTerms}.
 *
 * The deal is inserted in `INVITED` ("created, awaiting someone to join via the
 * link") with the caller as `creator_id` and `counterparty_id` NULL. The
 * returned `shareToken` is the capability the creator shares; whoever opens the
 * link joins via {@link joinDealByToken}. Nobody is notified yet — there is
 * nobody to notify.
 */
export async function createDeal(
  input: CreateDealInput,
): Promise<CreateDealResult> {
  const supabase = await createClient();

  const me = await getUserId(supabase);
  if (!me) return { ok: false, error: 'unauthenticated' };

  // No KYC gate: an unverified creator may open a deal and back it with
  // collateral instead (resolved at confirmation time by `collateralForDeal`).
  const title = (input.title ?? '').trim();
  if (title.length < DEAL_TITLE_MIN || title.length > DEAL_TITLE_MAX) {
    return { ok: false, error: 'invalid-title' };
  }

  const role = input.role;
  if (!DEAL_ROLES.includes(role)) {
    return { ok: false, error: 'invalid-role' };
  }

  // A trader must say what they are putting up; the other roles put up nothing
  // beyond their side of the cash/goods split, so the column stays empty.
  let offerKinds: DealOfferKind[] = [];
  if (role === 'TRADER') {
    const requested = input.offerKinds ?? [];
    offerKinds = DEAL_OFFER_KINDS.filter((kind) => requested.includes(kind));
    if (offerKinds.length === 0) {
      return { ok: false, error: 'invalid-offer-kinds' };
    }
  }

  // Cash is mandatory when it IS the deal (buy/sell) or when a trader offers it.
  const cashRequired =
    role === 'BUYER' || role === 'SELLER' || offerKinds.includes('CASH');
  const rawCash = cashRequired ? input.cashAmountCents : undefined;
  const cashAmountCents = rawCash == null ? null : Math.round(rawCash);
  if (cashRequired && cashAmountCents === null) {
    return { ok: false, error: 'invalid-cash' };
  }
  if (
    cashAmountCents !== null &&
    (!Number.isInteger(cashAmountCents) ||
      cashAmountCents < DEAL_CASH_MIN ||
      cashAmountCents > DEAL_CASH_MAX)
  ) {
    return { ok: false, error: 'invalid-cash' };
  }

  // The method of exchange, agreed up front so the joiner sees it in the
  // preview. The method decides which detail is mandatory (same rule as
  // `updateTerms`), and a complete handover lets the join advance the deal
  // straight to CONFIRMATION.
  const handoverMethod = input.handoverMethod;
  if (handoverMethod !== 'IN_PERSON' && handoverMethod !== 'DELIVERY') {
    return { ok: false, error: 'invalid-handover' };
  }
  const meetingLocation = normalizeText(input.meetingLocation);
  if (handoverMethod === 'IN_PERSON' && !meetingLocation) {
    return { ok: false, error: 'missing-meeting-location' };
  }

  // Delivery is priced separately from the goods: the cost is its own amount,
  // charged on top of the cash component. It doubles as the handover detail, so
  // stating it is what makes a DELIVERY handover complete.
  let deliveryCostCents: number | null = null;
  let deliveryDetails: string | null = null;
  if (handoverMethod === 'DELIVERY') {
    const raw = input.deliveryCostCents;
    if (raw == null) {
      return { ok: false, error: 'invalid-delivery-cost' };
    }
    deliveryCostCents = Math.round(raw);
    if (
      !Number.isInteger(deliveryCostCents) ||
      deliveryCostCents < DEAL_DELIVERY_COST_MIN ||
      deliveryCostCents > DEAL_DELIVERY_COST_MAX
    ) {
      return { ok: false, error: 'invalid-delivery-cost' };
    }
    deliveryDetails = describeDelivery(
      deliveryCostCents,
      normalizeText(input.deliveryDetails),
    );
  }

  // Photos of the goods the creator brings — the arbitration evidence base.
  const photos = input.photos ?? [];
  const photosRequired = role === 'SELLER' || offerKinds.includes('ITEMS');
  if (photosRequired && photos.length < DEAL_PHOTOS_MIN) {
    return { ok: false, error: 'photos-required' };
  }
  if (photos.length > DEAL_PHOTOS_MAX) {
    return { ok: false, error: 'too-many-photos' };
  }

  const admin = createAdminClient();
  let photoPaths: string[] = [];
  if (photos.length > 0) {
    try {
      photoPaths = await uploadImages(admin, me, photos);
    } catch (e) {
      return {
        ok: false,
        error: 'upload-failed',
        detail: e instanceof Error ? e.message : 'Photo upload failed.',
      };
    }
  }

  const { data: inserted, error } = await supabase
    .from('deals')
    .insert({
      creator_id: me,
      counterparty_id: null,
      state: 'INVITED',
      title,
      description: normalizeText(input.description),
      creator_role: role,
      creator_offer_kinds: offerKinds,
      creator_photo_paths: photoPaths,
      // Keep the creator's goods inside their owned contribution as well as the
      // shared summary, so the bilateral room is complete immediately.
      creator_item_text: photosRequired ? normalizeText(input.description) : null,
      handover_method: handoverMethod,
      meeting_location: handoverMethod === 'IN_PERSON' ? meetingLocation : null,
      meeting_lat:
        handoverMethod === 'IN_PERSON' ? finiteCoord(input.meetingLat) : null,
      meeting_lng:
        handoverMethod === 'IN_PERSON' ? finiteCoord(input.meetingLng) : null,
      meeting_place_id:
        handoverMethod === 'IN_PERSON'
          ? normalizeText(input.meetingPlaceId)
          : null,
      meeting_at: handoverMethod === 'IN_PERSON' ? (input.meetingAt ?? null) : null,
      delivery_details: deliveryDetails,
      delivery_cost_cents: deliveryCostCents,
      cash_amount_cents: cashAmountCents,
      // A SELLER is paid by the joiner, who does not exist yet: leave the payer
      // NULL and let the join (or the agreed terms) fill it in.
      cash_payer_id: cashAmountCents !== null && role !== 'SELLER' ? me : null,
    })
    .select('*')
    .single();

  if (error || !inserted) {
    await removeImages(admin, photoPaths);
    return {
      ok: false,
      error: 'persistence-error',
      detail: error?.message ?? 'Failed to create the deal.',
    };
  }

  const deal = inserted as DealRow;

  await logDealEvent(supabase, {
    dealId: deal.id,
    actorId: me,
    event: 'DEAL_CREATED',
    toState: 'INVITED',
    detail: title,
  });

  return { ok: true, dealId: deal.id, shareToken: deal.share_token };
}

// ---------------------------------------------------------------------------
// getDealByToken / joinDealByToken — the share-link join
// ---------------------------------------------------------------------------

/** States a share link can no longer be joined from (or previewed usefully). */
const CLOSED_STATES: DealState[] = ['CANCELLED', 'COMPLETED', 'DISPUTED'];

/** The minimal, safe-to-show summary behind a share link. */
export interface DealPreview {
  dealId: string;
  title: string;
  description: string | null;
  creatorName: string | null;
  creatorVerified: boolean;
  /** Which side the creator is on — decides how the cash reads to the joiner. */
  creatorRole: DealRole | null;
  /** For a TRADER creator: what they put up (`CARDS` / `CASH` / `ITEMS`). */
  creatorOfferKinds: DealOfferKind[];
  /** Storage object paths for photos of the goods the creator brings. */
  creatorPhotoPaths: string[];
  /** What the creator brings. */
  creatorItemText: string | null;
  /** What the joiner would be expected to bring. */
  counterpartyItemText: string | null;
  cashAmountCents: number | null;
  /** True when the creator is the one paying the cash component. */
  cashPayerIsCreator: boolean;
  /** The proposed method of exchange, or `null` if not stated yet. */
  handoverMethod: HandoverMethod | null;
  /** Where to meet, when `handoverMethod === 'IN_PERSON'`. */
  meetingLocation: string | null;
  /** Optional ISO meeting time for an in-person handover. */
  meetingAt: string | null;
  /** How it ships, when `handoverMethod === 'DELIVERY'`. */
  deliveryDetails: string | null;
  /** Delivery cost in integer AUD cents, charged on top of the cash amount. */
  deliveryCostCents: number | null;
  state: DealState;
  /** True when somebody has already joined as the counterparty. */
  alreadyJoined: boolean;
  /** True when the viewer IS that counterparty (send them to the room). */
  joinedByMe: boolean;
  /** True when the viewer created this deal (their own link). */
  iAmCreator: boolean;
}

/** Errors surfaced by {@link getDealByToken}. */
export type GetDealByTokenError = 'not-found' | 'closed';

/** Result of {@link getDealByToken}. */
export type GetDealByTokenResult =
  | { ok: true; preview: DealPreview }
  | ActionFailure<GetDealByTokenError>;

/** Look a deal up by its share token with the SERVICE-ROLE client. */
async function findDealByToken(token: string): Promise<DealRow | null> {
  const trimmed = (token ?? '').trim();
  if (!trimmed) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from('deals')
    .select('*')
    .eq('share_token', trimmed)
    .maybeSingle();

  return (data as DealRow | null) ?? null;
}

/**
 * Preview the deal behind a share link.
 *
 * The token IS the capability: there is deliberately no token-based RLS policy,
 * so the lookup runs through the SERVICE-ROLE client and this action returns
 * ONLY a minimal preview — never the full row, never anything about the joiner.
 * The viewer may be unauthenticated (the join page shows "sign in to join"), in
 * which case the viewer-relative flags are all false.
 */
export async function getDealByToken(
  token: string,
): Promise<GetDealByTokenResult> {
  const deal = await findDealByToken(token);
  if (!deal) return { ok: false, error: 'not-found' };
  if (CLOSED_STATES.includes(deal.state)) {
    return { ok: false, error: 'closed' };
  }

  const supabase = await createClient();
  const me = await getUserId(supabase);

  // `public_profiles` is readable by any member; fall back to the service-role
  // client so an unauthenticated visitor still sees who they'd be dealing with.
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from('public_profiles')
    .select('display_name, is_verified')
    .eq('id', deal.creator_id)
    .maybeSingle();

  return {
    ok: true,
    preview: {
      dealId: deal.id,
      title: deal.title,
      description: deal.description,
      creatorName: (profile?.display_name as string | null) ?? null,
      creatorVerified: Boolean(profile?.is_verified),
      creatorRole: deal.creator_role,
      creatorOfferKinds: (deal.creator_offer_kinds ?? []) as DealOfferKind[],
      creatorPhotoPaths: deal.creator_photo_paths ?? [],
      creatorItemText: deal.creator_item_text,
      counterpartyItemText: deal.counterparty_item_text,
      cashAmountCents: deal.cash_amount_cents,
      cashPayerIsCreator: deal.cash_payer_id === deal.creator_id,
      handoverMethod: deal.handover_method,
      meetingLocation: deal.meeting_location,
      meetingAt: deal.meeting_at,
      deliveryDetails: deal.delivery_details,
      deliveryCostCents: deal.delivery_cost_cents,
      state: deal.state,
      alreadyJoined: deal.counterparty_id !== null,
      joinedByMe: me !== null && deal.counterparty_id === me,
      iAmCreator: me !== null && deal.creator_id === me,
    },
  };
}

/** Errors surfaced by {@link joinDealByToken}. */
export type JoinDealError =
  | 'unauthenticated'
  | 'not-found'
  | 'already-joined'
  | 'self-join'
  | 'closed'
  | 'persistence-error';

/** Result of {@link joinDealByToken}. */
export type JoinDealResult =
  | { ok: true; dealId: string }
  | ActionFailure<JoinDealError>;

/**
 * Join a deal as its counterparty using the share link's token (INVITED ->
 * TERMS, or straight to CONFIRMATION when the creator already specified a
 * complete handover).
 *
 * The write runs through the SERVICE-ROLE client because the joiner is not yet a
 * participant, so RLS would hide the row from them. It is guarded with
 * `.is('counterparty_id', null).eq('state','INVITED')` so two people opening the
 * same link concurrently cannot both join — the loser gets `already-joined`.
 *
 * The joiner is NOT required to be KYC VERIFIED. If either party is unverified
 * the deal still becomes binding — `confirmDeal` re-reads both parties'
 * verification and holds collateral on BOTH sides instead.
 */
export async function joinDealByToken(token: string): Promise<JoinDealResult> {
  const supabase = await createClient();
  const me = await getUserId(supabase);
  if (!me) return { ok: false, error: 'unauthenticated' };

  const deal = await findDealByToken(token);
  if (!deal) return { ok: false, error: 'not-found' };

  if (deal.creator_id === me) return { ok: false, error: 'self-join' };

  // Idempotent: the counterparty re-opening the link just goes back to the room.
  if (deal.counterparty_id === me) return { ok: true, dealId: deal.id };
  if (deal.counterparty_id !== null) {
    return { ok: false, error: 'already-joined' };
  }
  if (deal.state !== 'INVITED') return { ok: false, error: 'closed' };

  const admin = createAdminClient();
  // A SELLER-created deal records "how much I receive", so the joiner is the
  // payer. That could not be recorded at creation time — nobody had joined yet.
  const joinerPaysCash =
    deal.creator_role === 'SELLER' && deal.cash_amount_cents !== null;

  // The creator states the method of exchange up front, so a joined deal whose
  // handover is already complete opens at the confirmation stage rather than
  // making the parties re-agree terms they can both already see.
  const nextState: DealState = areTermsComplete(deal) ? 'CONFIRMATION' : 'TERMS';

  const { data: joined, error } = await admin
    .from('deals')
    .update({
      counterparty_id: me,
      joined_at: new Date().toISOString(),
      state: nextState,
      ...(joinerPaysCash ? { cash_payer_id: me } : {}),
    })
    .eq('id', deal.id)
    .is('counterparty_id', null)
    .eq('state', 'INVITED')
    .select('*')
    .maybeSingle();

  if (error) {
    return { ok: false, error: 'persistence-error', detail: error.message };
  }
  // Lost the race: somebody else joined between the read and the guarded write.
  if (!joined) return { ok: false, error: 'already-joined' };

  await logDealEvent(supabase, {
    dealId: deal.id,
    actorId: me,
    event: 'COUNTERPARTY_JOINED',
    fromState: 'INVITED',
    toState: nextState,
  });

  // A joined deal has two parties, so its chat can exist now. Best-effort: the
  // room heals a missing thread on first view via `ensureDealConversation`.
  await openDealConversation(deal.id, me);

  await notifyDeal(
    deal.creator_id,
    'Someone joined your deal',
    nextState === 'CONFIRMATION'
      ? `Your deal "${deal.title}" was joined. Both of you can confirm it now.`
      : `Your deal "${deal.title}" was joined. Agree the handover next.`,
    deal.id,
  );

  return { ok: true, dealId: deal.id };
}

// ---------------------------------------------------------------------------
// updateTerms — agree the handover (step 3); clears both confirmations
// ---------------------------------------------------------------------------

/** Input for {@link updateTerms}. */
export interface UpdateTermsInput {
  handoverMethod: HandoverMethod;
  /** Required when `handoverMethod === 'IN_PERSON'`. */
  meetingLocation?: string;
  /** Optional Mapbox coords for an in-person meeting pin. */
  meetingLat?: number | null;
  meetingLng?: number | null;
  meetingPlaceId?: string | null;
  /** Optional ISO timestamp for an in-person meeting. */
  meetingAt?: string | null;
  /** Optional shipping notes when `handoverMethod === 'DELIVERY'`. */
  deliveryDetails?: string;
  /**
   * Required when `handoverMethod === 'DELIVERY'`: postage cost in integer AUD
   * cents, charged ON TOP of the cash component. `0` means free delivery.
   */
  deliveryCostCents?: number | null;
  title?: string;
  description?: string;
  /** What the caller brings; participants cannot edit the other side. */
  myItemText?: string;
  /**
   * The caller's retained Storage paths plus any newly selected image uploads.
   * Retained paths must already belong to the caller's side of this deal.
   */
  myPhotos?: (string | DealPhotoUpload)[];
  /** Cash component in integer AUD cents, or null to remove it. */
  cashAmountCents?: number | null;
  /** Which party pays the cash component. */
  cashPayerId?: string | null;
  /**
   * Agreed Fair_Market_Value for the exchange in integer AUD cents. When
   * collateral is required, each participant's hold is 100% of this value.
   */
  collateralCents?: number | null;
}

/** Errors surfaced by {@link updateTerms}. */
export type UpdateTermsError =
  | DealAuthError
  | 'not-joined'
  | 'invalid-state'
  | 'invalid-title'
  | 'item-details-required'
  | 'photos-required'
  | 'too-many-photos'
  | 'invalid-photo'
  | 'upload-failed'
  | 'invalid-cash'
  | 'invalid-collateral'
  | 'invalid-payer'
  | 'missing-meeting-location'
  | 'invalid-delivery-cost'
  | 'persistence-error';

/** Result of {@link updateTerms}. */
export type UpdateTermsResult =
  | { ok: true; state: DealState; confirmationsCleared: boolean }
  | ActionFailure<UpdateTermsError>;

/**
 * Update the deal's substantive terms — including the agreed handover (an
 * IN_PERSON meeting with a location and optional time, or a DELIVERY with its
 * own postage cost).
 *
 * Delivery cost is a substantive term in its own right: the database trigger
 * clears both confirmations when it changes, so renegotiating postage sends the
 * deal back for re-confirmation just like changing the cash amount does.
 *
 * Allowed from TERMS **and** CONFIRMATION: editing from CONFIRMATION is the
 * point of the critical rule — the database trigger clears BOTH confirmations
 * and bumps `terms_updated_at`, so the parties must re-tick "I'm happy with the
 * deal". This action never attempts to preserve confirmations.
 *
 * When the deal was in TERMS and the handover is now fully specified, the deal
 * advances to CONFIRMATION.
 */
export async function updateTerms(
  dealId: string,
  input: UpdateTermsInput,
): Promise<UpdateTermsResult> {
  const guard = await requireParticipant(dealId);
  if (!guard.ok) return guard;
  const { supabase, userId, deal, iAmCreator } = guard.ctx;

  // Terms are agreed BETWEEN two parties — nobody has joined the link yet.
  if (deal.counterparty_id === null) {
    return { ok: false, error: 'not-joined' };
  }
  if (deal.state !== 'TERMS' && deal.state !== 'CONFIRMATION') {
    return { ok: false, error: 'invalid-state' };
  }

  // Handover validation — the method decides which detail is mandatory. For a
  // delivery that is the POSTAGE COST (priced separately from the goods); an
  // omitted cost falls back to whatever the deal already agreed.
  const meetingLocation = normalizeText(input.meetingLocation);
  if (input.handoverMethod === 'IN_PERSON' && !meetingLocation) {
    return { ok: false, error: 'missing-meeting-location' };
  }

  let deliveryCostCents: number | null = null;
  let deliveryDetails: string | null = null;
  if (input.handoverMethod === 'DELIVERY') {
    const raw = input.deliveryCostCents ?? deal.delivery_cost_cents;
    if (raw == null) {
      return { ok: false, error: 'invalid-delivery-cost' };
    }
    deliveryCostCents = Math.round(raw);
    if (
      !Number.isInteger(deliveryCostCents) ||
      deliveryCostCents < DEAL_DELIVERY_COST_MIN ||
      deliveryCostCents > DEAL_DELIVERY_COST_MAX
    ) {
      return { ok: false, error: 'invalid-delivery-cost' };
    }
    deliveryDetails = describeDelivery(
      deliveryCostCents,
      normalizeText(input.deliveryDetails),
    );
  }

  const patch: TablesUpdate<'deals'> = {
    handover_method: input.handoverMethod,
    meeting_location: input.handoverMethod === 'IN_PERSON' ? meetingLocation : null,
    meeting_lat:
      input.handoverMethod === 'IN_PERSON' ? finiteCoord(input.meetingLat) : null,
    meeting_lng:
      input.handoverMethod === 'IN_PERSON' ? finiteCoord(input.meetingLng) : null,
    meeting_place_id:
      input.handoverMethod === 'IN_PERSON'
        ? normalizeText(input.meetingPlaceId)
        : null,
    meeting_at: input.handoverMethod === 'IN_PERSON' ? (input.meetingAt ?? null) : null,
    delivery_details: deliveryDetails,
    delivery_cost_cents: deliveryCostCents,
  };

  if (input.title !== undefined) {
    const title = input.title.trim();
    if (title.length < DEAL_TITLE_MIN || title.length > DEAL_TITLE_MAX) {
      return { ok: false, error: 'invalid-title' };
    }
    patch.title = title;
  }
  if (input.description !== undefined) {
    patch.description = normalizeText(input.description);
  }
  // A participant owns only their side of the exchange. Shared terms remain
  // editable by either party, but the other party's evidence is read-only.
  if (input.myItemText !== undefined) {
    patch[iAmCreator ? 'creator_item_text' : 'counterparty_item_text'] =
      normalizeText(input.myItemText);
  }

  if (input.cashAmountCents !== undefined) {
    if (input.cashAmountCents === null) {
      patch.cash_amount_cents = null;
      patch.cash_payer_id = null;
    } else {
      const cents = Math.round(input.cashAmountCents);
      if (
        !Number.isInteger(cents) ||
        cents < DEAL_CASH_MIN ||
        cents > DEAL_CASH_MAX
      ) {
        return { ok: false, error: 'invalid-cash' };
      }
      patch.cash_amount_cents = cents;
    }
  }

  if (input.cashPayerId !== undefined) {
    if (input.cashPayerId === null) {
      patch.cash_payer_id = null;
    } else if (
      input.cashPayerId !== deal.creator_id &&
      input.cashPayerId !== deal.counterparty_id
    ) {
      return { ok: false, error: 'invalid-payer' };
    } else {
      patch.cash_payer_id = input.cashPayerId;
    }
  }

  if (input.collateralCents !== undefined) {
    if (input.collateralCents === null) {
      patch.collateral_cents = null;
    } else {
      const cents = Math.round(input.collateralCents);
      if (
        !Number.isInteger(cents) ||
        cents < DEAL_COLLATERAL_MIN ||
        cents > DEAL_COLLATERAL_MAX
      ) {
        return { ok: false, error: 'invalid-collateral' };
      }
      patch.collateral_cents = cents;
    }
  }

  const myRole = iAmCreator ? deal.creator_role : mirrorRole(deal.creator_role);
  const myCurrentPhotos = iAmCreator
    ? deal.creator_photo_paths
    : deal.counterparty_photo_paths;
  const resultingItemText =
    input.myItemText === undefined
      ? iAmCreator
        ? deal.creator_item_text
        : deal.counterparty_item_text
      : normalizeText(input.myItemText);
  const goodsRequired = iAmCreator
    ? myRole === 'SELLER' ||
      (myRole === 'TRADER' &&
        deal.creator_offer_kinds.some((kind) => kind === 'CARDS' || kind === 'ITEMS'))
    : myRole === 'SELLER' || myRole === 'TRADER';

  let newlyUploadedPaths: string[] = [];
  let droppedPhotoPaths: string[] = [];
  if (input.myPhotos !== undefined) {
    const retainedPaths = input.myPhotos.filter(
      (photo): photo is string => typeof photo === 'string',
    );
    if (
      new Set(retainedPaths).size !== retainedPaths.length ||
      retainedPaths.some((path) => !myCurrentPhotos.includes(path))
    ) {
      return { ok: false, error: 'invalid-photo' };
    }

    const newPhotos = input.myPhotos.filter(
      (photo): photo is DealPhotoUpload => typeof photo !== 'string',
    );
    const finalCount = retainedPaths.length + newPhotos.length;
    if (goodsRequired && finalCount < DEAL_PHOTOS_MIN) {
      return { ok: false, error: 'photos-required' };
    }
    if (finalCount > DEAL_PHOTOS_MAX) {
      return { ok: false, error: 'too-many-photos' };
    }
    if (goodsRequired && !resultingItemText) {
      return { ok: false, error: 'item-details-required' };
    }

    if (newPhotos.length > 0) {
      try {
        newlyUploadedPaths = await uploadImages(createAdminClient(), userId, newPhotos);
      } catch (error) {
        return {
          ok: false,
          error: 'upload-failed',
          detail: error instanceof Error ? error.message : 'Photo upload failed.',
        };
      }
    }

    patch[iAmCreator ? 'creator_photo_paths' : 'counterparty_photo_paths'] = [
      ...retainedPaths,
      ...newlyUploadedPaths,
    ];
    droppedPhotoPaths = myCurrentPhotos.filter((path) => !retainedPaths.includes(path));
  } else if (goodsRequired) {
    if (!resultingItemText) return { ok: false, error: 'item-details-required' };
    if (myCurrentPhotos.length < DEAL_PHOTOS_MIN) {
      return { ok: false, error: 'photos-required' };
    }
  }

  const hadConfirmation =
    deal.creator_confirmed_at !== null || deal.counterparty_confirmed_at !== null;

  const { data: updated, error } = await supabase
    .from('deals')
    .update(patch)
    .eq('id', dealId)
    .in('state', ['TERMS', 'CONFIRMATION'])
    .select('*')
    .maybeSingle();

  if (error) {
    await removeImages(createAdminClient(), newlyUploadedPaths);
    return { ok: false, error: 'persistence-error', detail: error.message };
  }
  if (!updated) {
    await removeImages(createAdminClient(), newlyUploadedPaths);
    return { ok: false, error: 'invalid-state' };
  }

  // The database now references the final set, so removed evidence objects can
  // be cleaned up without risking a broken deal if the update failed.
  await removeImages(createAdminClient(), droppedPhotoPaths);

  let next = updated as DealRow;

  // Step 3 -> step 4: a complete handover opens the confirmation stage.
  if (next.state === 'TERMS' && areTermsComplete(next)) {
    const { data: advanced } = await supabase
      .from('deals')
      .update({ state: 'CONFIRMATION' })
      .eq('id', dealId)
      .eq('state', 'TERMS')
      .select('*')
      .maybeSingle();
    if (advanced) next = advanced as DealRow;
  }

  // The trigger clears confirmations on any substantive change.
  const confirmationsCleared =
    hadConfirmation &&
    next.creator_confirmed_at === null &&
    next.counterparty_confirmed_at === null;

  await logDealEvent(supabase, {
    dealId,
    actorId: userId,
    event: 'TERMS_UPDATED',
    fromState: deal.state,
    toState: next.state,
    detail:
      input.handoverMethod === 'IN_PERSON'
        ? `In person — ${meetingLocation}`
        : (deliveryDetails ?? 'Delivery'),
  });

  if (confirmationsCleared) {
    await logDealEvent(supabase, {
      dealId,
      actorId: userId,
      event: 'CONFIRMATIONS_CLEARED',
      fromState: next.state,
      toState: next.state,
      detail: 'Terms changed — both parties must confirm again.',
    });
  }

  const otherParty = otherPartyOf(deal, userId);
  if (otherParty) {
    await notifyDeal(
      otherParty,
      'Deal terms changed',
      confirmationsCleared
        ? `Terms changed on "${next.title}" — both parties must confirm again.`
        : `The terms of "${next.title}" were updated.`,
      dealId,
    );
  }

  return { ok: true, state: next.state, confirmationsCleared };
}

// ---------------------------------------------------------------------------
// confirmDeal / unconfirmDeal — dual confirmation, then the binding contract
// ---------------------------------------------------------------------------

/** Errors surfaced by {@link confirmDeal}. */
export type ConfirmDealError =
  | DealAuthError
  | 'not-joined'
  | 'invalid-state'
  | 'terms-incomplete'
  | 'contribution-incomplete'
  | 'escrow-failed'
  | 'persistence-error';

/** Result of {@link confirmDeal}. */
export type ConfirmDealResult =
  | {
      ok: true;
      state: DealState;
      /** True when this confirmation was the second one and escrow engaged. */
      bothConfirmed: boolean;
      /** Per-party collateral held, in integer AUD cents (when escrow engaged). */
      collateralCents?: number;
    }
  | ActionFailure<ConfirmDealError>;

/**
 * Resolve a party's payment-provider payer ref, creating one on demand.
 *
 * Uses the SERVICE-ROLE client because `profiles` RLS is owner-only and the
 * escrow step must place a hold on BOTH parties. Only the payer ref is read or
 * written — no other profile data is touched or returned to the caller.
 */
async function resolvePayerId(profileId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('profiles')
    .select('payer_id, display_name, contact_email')
    .eq('id', profileId)
    .maybeSingle();

  const existing = (data?.payer_id as string | null) ?? null;
  if (existing) return existing;

  try {
    // Name/email are required by the real provider's Payer create and ignored
    // by the Mock; nothing else from the profile is read or returned.
    const payer = await getPaymentService().createPayer(profileId, {
      displayName: (data?.display_name as string | null) ?? undefined,
      email: (data?.contact_email as string | null) ?? undefined,
    });
    await admin
      .from('profiles')
      .update({ payer_id: payer.payerId })
      .eq('id', profileId);
    return payer.payerId;
  } catch {
    return null;
  }
}

/** Revert an escrow attempt: back to CONFIRMATION with both ticks cleared. */
async function revertToConfirmation(
  supabase: CookieClient,
  dealId: string,
): Promise<void> {
  await supabase
    .from('deals')
    .update({
      state: 'CONFIRMATION',
      creator_confirmed_at: null,
      counterparty_confirmed_at: null,
    })
    .eq('id', dealId);
}

/**
 * Tick "I'm happy with the deal" for the caller (step 4), and — when BOTH
 * parties have now confirmed — engage the binding contract (step 5).
 *
 * Guards: CONFIRMATION only, and the handover terms must be complete. Identity
 * verification is NOT a gate — both parties' verification is re-read here (never
 * trusted from the client) only to size the collateral: verified-to-verified
 * engages with no holds at all, otherwise BOTH parties post the deal's stake.
 *
 * Engagement sequence: CONFIRMATION -> ESCROW_PENDING, place a collateral hold
 * for EACH party that needs one via the payment service, record the `deal_holds`
 * rows with the service-role client (the table has no end-user insert policy),
 * then ESCROW_PENDING -> ESCROW_LOCKED. If any hold fails, every placed hold is
 * voided, the deal reverts to CONFIRMATION with both confirmations cleared, and
 * a typed `escrow-failed` error is returned.
 */
export async function confirmDeal(dealId: string): Promise<ConfirmDealResult> {
  const guard = await requireParticipant(dealId);
  if (!guard.ok) return guard;
  const { supabase, userId, deal, iAmCreator } = guard.ctx;

  const counterpartyId = deal.counterparty_id;
  // A deal only becomes binding between TWO parties.
  if (counterpartyId === null) {
    return { ok: false, error: 'not-joined' };
  }
  if (deal.state !== 'CONFIRMATION') {
    return { ok: false, error: 'invalid-state' };
  }

  if (!areTermsComplete(deal)) {
    return { ok: false, error: 'terms-incomplete' };
  }

  // A binding trade needs an auditable description and photo evidence for every
  // side that brings goods. A BUYER may legitimately bring cash only.
  const creatorBringsGoods =
    deal.creator_role === 'SELLER' ||
    (deal.creator_role === 'TRADER' &&
      deal.creator_offer_kinds.some((kind) => kind === 'CARDS' || kind === 'ITEMS'));
  const counterpartyRole = mirrorRole(deal.creator_role);
  const counterpartyBringsGoods =
    counterpartyRole === 'SELLER' || counterpartyRole === 'TRADER';
  const creatorContributionComplete =
    !creatorBringsGoods ||
    (Boolean(deal.creator_item_text?.trim()) && deal.creator_photo_paths.length > 0);
  const counterpartyContributionComplete =
    !counterpartyBringsGoods ||
    (Boolean(deal.counterparty_item_text?.trim()) &&
      deal.counterparty_photo_paths.length > 0);
  if (!creatorContributionComplete || !counterpartyContributionComplete) {
    return { ok: false, error: 'contribution-incomplete' };
  }

  const myColumn = iAmCreator ? 'creator_confirmed_at' : 'counterparty_confirmed_at';
  const now = new Date().toISOString();

  const { data: confirmed, error } = await supabase
    .from('deals')
    .update({ [myColumn]: now } as TablesUpdate<'deals'>)
    .eq('id', dealId)
    .eq('state', 'CONFIRMATION')
    .select('*')
    .maybeSingle();

  if (error) return { ok: false, error: 'persistence-error', detail: error.message };
  if (!confirmed) return { ok: false, error: 'invalid-state' };

  const afterConfirm = confirmed as DealRow;

  await logDealEvent(supabase, {
    dealId,
    actorId: userId,
    event: 'PARTY_CONFIRMED',
    fromState: 'CONFIRMATION',
    toState: 'CONFIRMATION',
    detail: 'Happy with the deal.',
  });

  const bothConfirmed =
    afterConfirm.creator_confirmed_at !== null &&
    afterConfirm.counterparty_confirmed_at !== null;

  if (!bothConfirmed) {
    const otherParty = otherPartyOf(deal, userId);
    if (otherParty) {
      await notifyDeal(
        otherParty,
        'The other party confirmed',
        `They're happy with "${deal.title}". Confirm to engage the binding contract.`,
        dealId,
      );
    }
    return { ok: true, state: 'CONFIRMATION', bothConfirmed: false };
  }

  // ---- Binding contract engages: the "bank" step ----
  const { data: pending } = await supabase
    .from('deals')
    .update({ state: 'ESCROW_PENDING' })
    .eq('id', dealId)
    .eq('state', 'CONFIRMATION')
    .not('creator_confirmed_at', 'is', null)
    .not('counterparty_confirmed_at', 'is', null)
    .select('*')
    .maybeSingle();

  // Another concurrent confirmation already moved the deal on; nothing to do.
  if (!pending) {
    return { ok: true, state: afterConfirm.state, bothConfirmed: true };
  }

  const pendingDeal = pending as DealRow;

  // Identity or money: both parties' verification is read here only to SIZE the
  // collateral. Verified-to-verified holds nothing; otherwise both post the
  // deal's stake, so the honest unverified party is never alone at risk.
  const verification = await readVerification(supabase, [
    pendingDeal.creator_id,
    counterpartyId,
  ]);
  const collateral = collateralForDeal(pendingDeal, {
    creator: Boolean(verification.get(pendingDeal.creator_id)),
    counterparty: Boolean(verification.get(counterpartyId)),
  });
  const collateralCents = collateral.perPartyCents;

  await logDealEvent(supabase, {
    dealId,
    actorId: userId,
    event: 'BOTH_CONFIRMED',
    fromState: 'CONFIRMATION',
    toState: 'ESCROW_PENDING',
    detail: collateral.required
      ? `Placing ${formatAud(collateralCents)} collateral on each party.`
      : 'Both parties are identity verified — no collateral required.',
  });

  const payments = getPaymentService();
  const parties = [pendingDeal.creator_id, counterpartyId];
  const placed: { partyId: string; holdRef: string }[] = [];
  let failureDetail: string | null = null;

  if (collateral.required) {
    for (const partyId of parties) {
      const payerId = await resolvePayerId(partyId);
      if (!payerId) {
        failureDetail = 'A party has no payment method on file.';
        break;
      }
      try {
        const hold = await payments.placeHold({
          payerId,
          amount: collateralCents,
          ref: `deal:${dealId}:${partyId}`,
        });
        if (hold.status !== 'ACTIVE') {
          failureDetail = 'A collateral hold could not be placed.';
          break;
        }
        placed.push({ partyId, holdRef: hold.holdId });
      } catch (e) {
        failureDetail = e instanceof Error ? e.message : 'Collateral hold failed.';
        break;
      }
    }
  }

  if (failureDetail) {
    // Compensate: release anything already held, then hand control back to the
    // parties with both confirmations cleared.
    for (const { holdRef } of placed) {
      try {
        await payments.voidHold(holdRef);
      } catch {
        // Best-effort release; the provider is the source of truth.
      }
    }
    await revertToConfirmation(supabase, dealId);
    await logDealEvent(supabase, {
      dealId,
      actorId: userId,
      event: 'ESCROW_FAILED',
      fromState: 'ESCROW_PENDING',
      toState: 'CONFIRMATION',
      detail: failureDetail,
    });
    return { ok: false, error: 'escrow-failed', detail: failureDetail };
  }

  // Record the holds with the service-role client (no end-user insert policy).
  // Nothing to record when both parties are verified and no hold was placed.
  if (placed.length > 0) {
    try {
      const admin = createAdminClient();
      const { error: holdError } = await admin.from('deal_holds').insert(
        placed.map(({ partyId, holdRef }) => ({
          deal_id: dealId,
          party_id: partyId,
          hold_ref: holdRef,
          amount_cents: collateralCents,
          status: 'ACTIVE' as const,
        })),
      );
      if (holdError) throw new Error(holdError.message);
    } catch (e) {
      for (const { holdRef } of placed) {
        try {
          await payments.voidHold(holdRef);
        } catch {
          // best-effort
        }
      }
      await revertToConfirmation(supabase, dealId);
      const detail =
        e instanceof Error ? e.message : 'Could not record the collateral holds.';
      await logDealEvent(supabase, {
        dealId,
        actorId: userId,
        event: 'ESCROW_FAILED',
        fromState: 'ESCROW_PENDING',
        toState: 'CONFIRMATION',
        detail,
      });
      return { ok: false, error: 'escrow-failed', detail };
    }
  }

  const { data: locked } = await supabase
    .from('deals')
    .update({ state: 'ESCROW_LOCKED' })
    .eq('id', dealId)
    .eq('state', 'ESCROW_PENDING')
    .select('state')
    .maybeSingle();

  const finalState: DealState = locked
    ? (locked.state as DealState)
    : 'ESCROW_PENDING';

  await logDealEvent(supabase, {
    dealId,
    actorId: null,
    event: 'ESCROW_LOCKED',
    fromState: 'ESCROW_PENDING',
    toState: finalState,
    detail: collateral.required
      ? `${formatAud(collateralCents)} collateral held per party.`
      : 'Backed by both parties’ verified identity — no collateral held.',
  });

  for (const partyId of parties) {
    await notifyDeal(
      partyId,
      'Deal is binding',
      collateral.required
        ? `Both parties confirmed "${pendingDeal.title}". ${formatAud(
            collateralCents,
          )} collateral is now held on each side.`
        : `Both parties confirmed "${pendingDeal.title}". It's binding, backed by your verified identities.`,
      dealId,
    );
  }

  return { ok: true, state: finalState, bothConfirmed: true, collateralCents };
}

/** Errors surfaced by {@link unconfirmDeal}. */
export type UnconfirmDealError =
  | DealAuthError
  | 'not-joined'
  | 'invalid-state'
  | 'persistence-error';

/** Result of {@link unconfirmDeal}. */
export type UnconfirmDealResult =
  | { ok: true; state: DealState }
  | ActionFailure<UnconfirmDealError>;

/**
 * Withdraw the caller's own confirmation while the deal is still in
 * CONFIRMATION (i.e. before the binding contract engages). Only the caller's own
 * `*_confirmed_at` is cleared; the other party's tick is untouched.
 */
export async function unconfirmDeal(
  dealId: string,
): Promise<UnconfirmDealResult> {
  const guard = await requireParticipant(dealId);
  if (!guard.ok) return guard;
  const { supabase, userId, deal, iAmCreator } = guard.ctx;

  if (deal.counterparty_id === null) {
    return { ok: false, error: 'not-joined' };
  }
  if (deal.state !== 'CONFIRMATION') {
    return { ok: false, error: 'invalid-state' };
  }

  const myColumn = iAmCreator ? 'creator_confirmed_at' : 'counterparty_confirmed_at';

  const { data: updated, error } = await supabase
    .from('deals')
    .update({ [myColumn]: null } as TablesUpdate<'deals'>)
    .eq('id', dealId)
    .eq('state', 'CONFIRMATION')
    .select('state')
    .maybeSingle();

  if (error) return { ok: false, error: 'persistence-error', detail: error.message };
  if (!updated) return { ok: false, error: 'invalid-state' };

  await logDealEvent(supabase, {
    dealId,
    actorId: userId,
    event: 'PARTY_UNCONFIRMED',
    fromState: 'CONFIRMATION',
    toState: 'CONFIRMATION',
    detail: 'Confirmation withdrawn.',
  });

  const otherParty = otherPartyOf(deal, userId);
  if (otherParty) {
    await notifyDeal(
      otherParty,
      'Confirmation withdrawn',
      `The other party withdrew their confirmation on "${deal.title}".`,
      dealId,
    );
  }

  return { ok: true, state: 'CONFIRMATION' };
}

// ---------------------------------------------------------------------------
// cancelDeal / completeDeal / raiseDealDispute
// ---------------------------------------------------------------------------

/** Errors surfaced by {@link cancelDeal}. */
export type CancelDealError =
  | DealAuthError
  | 'not-permitted'
  | 'invalid-state'
  | 'persistence-error';

/** Result of {@link cancelDeal}. */
export type CancelDealResult =
  | { ok: true; state: DealState }
  | ActionFailure<CancelDealError>;

/** States a deal may still be cancelled from — never once it is binding. */
const CANCELLABLE_STATES: DealState[] = ['INVITED', 'TERMS', 'CONFIRMATION'];

/**
 * Cancel the deal before it becomes binding. Either party may cancel from
 * INVITED / TERMS / CONFIRMATION. Once collateral is locked the deal is binding,
 * so `not-permitted` is returned — the parties must complete or dispute.
 *
 * This deliberately still works on an UNJOINED deal: it is how a creator kills a
 * share link nobody has taken up. There is simply nobody to notify.
 */
export async function cancelDeal(
  dealId: string,
  reason?: string,
): Promise<CancelDealResult> {
  const guard = await requireParticipant(dealId);
  if (!guard.ok) return guard;
  const { supabase, userId, deal } = guard.ctx;

  if (!CANCELLABLE_STATES.includes(deal.state)) {
    return {
      ok: false,
      error: 'not-permitted',
      detail:
        deal.state === 'ESCROW_LOCKED'
          ? 'This deal is binding — mark it complete or raise a dispute.'
          : `A ${deal.state.toLowerCase()} deal cannot be cancelled.`,
    };
  }

  const cancelReason = normalizeText(reason, DEAL_REASON_MAX);

  const { data: updated, error } = await supabase
    .from('deals')
    .update({
      state: 'CANCELLED',
      cancelled_by: userId,
      cancel_reason: cancelReason,
    })
    .eq('id', dealId)
    .in('state', CANCELLABLE_STATES)
    .select('state')
    .maybeSingle();

  if (error) return { ok: false, error: 'persistence-error', detail: error.message };
  if (!updated) return { ok: false, error: 'invalid-state' };

  await logDealEvent(supabase, {
    dealId,
    actorId: userId,
    event: 'DEAL_CANCELLED',
    fromState: deal.state,
    toState: 'CANCELLED',
    detail: cancelReason,
  });

  // An unjoined deal has nobody to tell — the creator is scrapping their link.
  const otherParty = otherPartyOf(deal, userId);
  if (otherParty) {
    await notifyDeal(
      otherParty,
      'Deal cancelled',
      cancelReason
        ? `"${deal.title}" was cancelled: ${cancelReason}`
        : `"${deal.title}" was cancelled.`,
      dealId,
    );
  }

  return { ok: true, state: 'CANCELLED' };
}

/** Errors surfaced by {@link completeDeal}. */
export type CompleteDealError =
  | DealAuthError
  | 'not-joined'
  | 'invalid-state'
  | 'already-recorded'
  | 'persistence-error';

/** Result of {@link completeDeal}. */
export type CompleteDealResult =
  | {
      ok: true;
      state: DealState;
      /** True when the caller's mark completed the deal (both sides marked). */
      completed: boolean;
      /** True when the caller is still waiting on the other party. */
      waitingForOther: boolean;
    }
  | ActionFailure<CompleteDealError>;

/**
 * Mark the handover complete from ESCROW_LOCKED. BOTH parties must mark before
 * the deal finishes.
 *
 * The confirmation columns are NOT reused here — they carry "happy with the
 * terms" and are cleared by the terms trigger. Instead each party's mark is a
 * `deal_events` row with event `COMPLETE_MARKED`; once both parties have one,
 * both collateral holds are voided and the deal moves to COMPLETED.
 */
export async function completeDeal(
  dealId: string,
): Promise<CompleteDealResult> {
  const guard = await requireParticipant(dealId);
  if (!guard.ok) return guard;
  const { supabase, userId, deal } = guard.ctx;

  const counterpartyId = deal.counterparty_id;
  if (counterpartyId === null) {
    return { ok: false, error: 'not-joined' };
  }
  if (deal.state !== 'ESCROW_LOCKED') {
    return { ok: false, error: 'invalid-state' };
  }

  const { data: existingMarks, error: readError } = await supabase
    .from('deal_events')
    .select('actor_id')
    .eq('deal_id', dealId)
    .eq('event', DEAL_EVENT_COMPLETE_MARKED);

  if (readError) {
    return { ok: false, error: 'persistence-error', detail: readError.message };
  }

  const markedBy = new Set(
    (existingMarks ?? [])
      .map((row) => row.actor_id as string | null)
      .filter((id): id is string => Boolean(id)),
  );
  if (markedBy.has(userId)) {
    return { ok: false, error: 'already-recorded' };
  }

  const { error: insertError } = await supabase.from('deal_events').insert({
    deal_id: dealId,
    actor_id: userId,
    event: DEAL_EVENT_COMPLETE_MARKED,
    from_state: 'ESCROW_LOCKED',
    to_state: 'ESCROW_LOCKED',
    detail: 'Marked the handover complete.',
  });
  if (insertError) {
    return { ok: false, error: 'persistence-error', detail: insertError.message };
  }

  markedBy.add(userId);
  const otherParty =
    deal.creator_id === userId ? counterpartyId : deal.creator_id;

  if (!markedBy.has(otherParty)) {
    await notifyDeal(
      otherParty,
      'The other party marked the deal complete',
      `Mark "${deal.title}" complete to release both collateral holds.`,
      dealId,
    );
    return {
      ok: true,
      state: 'ESCROW_LOCKED',
      completed: false,
      waitingForOther: true,
    };
  }

  // Both marked: release the collateral and finish.
  const payments = getPaymentService();
  const { data: holds } = await supabase
    .from('deal_holds')
    .select('*')
    .eq('deal_id', dealId);

  const admin = createAdminClient();
  for (const hold of (holds ?? []) as DealHoldRow[]) {
    if (hold.status !== 'ACTIVE' || !hold.hold_ref) continue;
    try {
      await payments.voidHold(hold.hold_ref);
      await admin
        .from('deal_holds')
        .update({ status: 'VOIDED' })
        .eq('id', hold.id);
    } catch {
      // Best-effort release; the deal still completes and the provider retries.
    }
  }

  const { data: completedDeal, error: completeError } = await supabase
    .from('deals')
    .update({ state: 'COMPLETED' })
    .eq('id', dealId)
    .eq('state', 'ESCROW_LOCKED')
    .select('state')
    .maybeSingle();

  if (completeError) {
    return { ok: false, error: 'persistence-error', detail: completeError.message };
  }
  if (!completedDeal) return { ok: false, error: 'invalid-state' };

  await logDealEvent(supabase, {
    dealId,
    actorId: userId,
    event: 'DEAL_COMPLETED',
    fromState: 'ESCROW_LOCKED',
    toState: 'COMPLETED',
    detail: 'Both parties marked complete; collateral released.',
  });

  for (const partyId of [deal.creator_id, counterpartyId]) {
    await notifyDeal(
      partyId,
      'Deal completed',
      `"${deal.title}" is complete and the collateral holds were released.`,
      dealId,
    );
  }

  return { ok: true, state: 'COMPLETED', completed: true, waitingForOther: false };
}

/** Errors surfaced by {@link raiseDealDispute}. */
export type RaiseDealDisputeError =
  | DealAuthError
  | 'not-joined'
  | 'invalid-state'
  | 'invalid-reason'
  | 'persistence-error';

/** Result of {@link raiseDealDispute}. */
export type RaiseDealDisputeResult =
  | { ok: true; state: DealState }
  | ActionFailure<RaiseDealDisputeError>;

/**
 * Raise a dispute on a binding deal (ESCROW_LOCKED -> DISPUTED). Both collateral
 * holds stay locked so the funds remain available while the dispute is worked
 * through.
 */
export async function raiseDealDispute(
  dealId: string,
  reason: string,
): Promise<RaiseDealDisputeResult> {
  const guard = await requireParticipant(dealId);
  if (!guard.ok) return guard;
  const { supabase, userId, deal } = guard.ctx;

  if (deal.counterparty_id === null) {
    return { ok: false, error: 'not-joined' };
  }
  if (deal.state !== 'ESCROW_LOCKED') {
    return { ok: false, error: 'invalid-state' };
  }

  const detail = normalizeText(reason, DEAL_REASON_MAX);
  if (!detail) return { ok: false, error: 'invalid-reason' };

  const { data: updated, error } = await supabase
    .from('deals')
    .update({ state: 'DISPUTED' })
    .eq('id', dealId)
    .eq('state', 'ESCROW_LOCKED')
    .select('state')
    .maybeSingle();

  if (error) return { ok: false, error: 'persistence-error', detail: error.message };
  if (!updated) return { ok: false, error: 'invalid-state' };

  await logDealEvent(supabase, {
    dealId,
    actorId: userId,
    event: 'DISPUTE_RAISED',
    fromState: 'ESCROW_LOCKED',
    toState: 'DISPUTED',
    detail,
  });

  const otherParty = otherPartyOf(deal, userId);
  if (otherParty) {
    await notifyDeal(
      otherParty,
      'Dispute raised',
      `A dispute was raised on "${deal.title}": ${detail}`,
      dealId,
    );
  }

  return { ok: true, state: 'DISPUTED' };
}

// ---------------------------------------------------------------------------
// getDeal — the deal room's server-rendered snapshot
// ---------------------------------------------------------------------------

/** Everything the deal room needs for its first paint. */
export interface DealView {
  deal: DealRow;
  creator: DealParty;
  /** `null` until somebody joins the deal through its share link. */
  counterparty: DealParty | null;
  /** The token behind the creator's share link. */
  shareToken: string;
  /** True while the deal is created but unjoined (share the link). */
  awaitingJoin: boolean;
  holds: DealHoldRow[];
  /** Timeline, oldest first. */
  events: DealEventRow[];
  /** True when the caller is the deal's creator. */
  iAmCreator: boolean;
  /** The caller's own confirmation state. */
  myConfirmed: boolean;
  /** The other party's confirmation state. */
  theirConfirmed: boolean;
  /** True when BOTH parties are KYC VERIFIED — they post no collateral. */
  bothVerified: boolean;
  /** True when the handover terms are fully specified (step 2). */
  termsComplete: boolean;
  /** Party ids that have marked the handover complete (ESCROW_LOCKED). */
  completeMarkedBy: string[];
  /**
   * Per-party collateral that will be (or was) held, in integer AUD cents. `0`
   * when both parties are verified and the deal is backed by identity instead.
   */
  collateralCents: number;
  /**
   * What a hold would be worth if collateral were required — the figure to quote
   * while a party is still unverified, or before anybody has joined.
   */
  collateralStakeCents: number;
  /** True when collateral will actually be held on both sides. */
  collateralRequired: boolean;
  /**
   * The deal's participant-only chat thread, or `null` while the deal is
   * unjoined (a thread needs two participants) or the link has not been opened
   * yet — the room heals that case with {@link ensureDealConversation}.
   */
  conversationId: string | null;
}

/** Errors surfaced by {@link getDeal}. */
export type GetDealError = DealAuthError | 'not-found';

/** Result of {@link getDeal}. */
export type GetDealResult = { ok: true; view: DealView } | ActionFailure<GetDealError>;

/** Build a party view from the public profile row + confirmation timestamp. */
function toParty(
  id: string,
  profile:
    | {
        display_name?: string | null;
        rating?: number | null;
        rating_count?: number | null;
        is_verified?: boolean | null;
      }
    | undefined,
  confirmedAt: string | null,
  role: DealRole | null,
  stats: { completedSales: number; completedPurchases: number },
): DealParty {
  return {
    id,
    displayName: profile?.display_name ?? null,
    rating: profile?.rating ?? null,
    ratingCount: profile?.rating_count ?? 0,
    isVerified: Boolean(profile?.is_verified),
    confirmedAt,
    role,
    completedSales: stats.completedSales,
    completedPurchases: stats.completedPurchases,
  };
}

/** The other side of a declared role: a BUYER deals with a SELLER, and vice versa. */
function mirrorRole(role: DealRole | null): DealRole | null {
  if (role === 'BUYER') return 'SELLER';
  if (role === 'SELLER') return 'BUYER';
  return role;
}

/**
 * Load a deal for one of its two parties, together with both parties' PUBLIC
 * profile info (display name, rating, verified flag — via `public_profiles`),
 * the collateral holds, the chronological timeline, and the derived booleans the
 * deal room renders from.
 */
export async function getDeal(dealId: string): Promise<GetDealResult> {
  const guard = await requireParticipant(dealId);
  if (!guard.ok) return guard;
  const { supabase, userId, deal, iAmCreator } = guard.ctx;

  // Only query for the ids that actually exist — an unjoined deal has one party.
  const partyIds = [deal.creator_id, ...(deal.counterparty_id ? [deal.counterparty_id] : [])];

  const [profilesRes, holdsRes, eventsRes, statsResults] = await Promise.all([
    supabase
      .from('public_profiles')
      .select('id, display_name, rating, rating_count, is_verified')
      .in('id', partyIds),
    supabase.from('deal_holds').select('*').eq('deal_id', dealId),
    supabase
      .from('deal_events')
      .select('*')
      .eq('deal_id', dealId)
      .order('created_at', { ascending: true }),
    // Completed-sale counts come from an aggregate-only function, so neither
    // party gains read access to the other's contracts (same source as the cash
    // sale contract room).
    Promise.all(
      partyIds.map(async (id) => {
        const { data } = await supabase.rpc('member_sale_stats', {
          p_profile_id: id,
        });
        const row = (Array.isArray(data) ? data[0] : data) as
          | { completed_sales: number | null; completed_purchases: number | null }
          | null
          | undefined;
        return [
          id,
          {
            completedSales: row?.completed_sales ?? 0,
            completedPurchases: row?.completed_purchases ?? 0,
          },
        ] as const;
      }),
    ),
  ]);

  const profileById = new Map(
    (profilesRes.data ?? []).map((row) => [row.id as string, row]),
  );
  const statsById = new Map(statsResults);
  const noStats = { completedSales: 0, completedPurchases: 0 };

  const creator = toParty(
    deal.creator_id,
    profileById.get(deal.creator_id),
    deal.creator_confirmed_at,
    deal.creator_role,
    statsById.get(deal.creator_id) ?? noStats,
  );
  const counterparty =
    deal.counterparty_id === null
      ? null
      : toParty(
          deal.counterparty_id,
          profileById.get(deal.counterparty_id),
          deal.counterparty_confirmed_at,
          mirrorRole(deal.creator_role),
          statsById.get(deal.counterparty_id) ?? noStats,
        );

  const events = (eventsRes.data ?? []) as DealEventRow[];
  const completeMarkedBy = Array.from(
    new Set(
      events
        .filter((e) => e.event === DEAL_EVENT_COMPLETE_MARKED)
        .map((e) => e.actor_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const myConfirmed = iAmCreator
    ? deal.creator_confirmed_at !== null
    : deal.counterparty_confirmed_at !== null;
  const theirConfirmed = iAmCreator
    ? deal.counterparty_confirmed_at !== null
    : deal.creator_confirmed_at !== null;

  // Identity or money: verified-to-verified deals hold nothing, otherwise both
  // parties post the deal's stake when the binding contract engages.
  const collateral = collateralForDeal(deal, {
    creator: creator.isVerified,
    counterparty: counterparty === null ? null : counterparty.isVerified,
  });

  return {
    ok: true,
    view: {
      deal,
      creator,
      counterparty,
      shareToken: deal.share_token,
      awaitingJoin: deal.counterparty_id === null,
      holds: (holdsRes.data ?? []) as DealHoldRow[],
      events,
      iAmCreator,
      myConfirmed,
      theirConfirmed,
      bothVerified:
        counterparty !== null && creator.isVerified && counterparty.isVerified,
      termsComplete: areTermsComplete(deal),
      completeMarkedBy,
      collateralCents: collateral.perPartyCents,
      collateralStakeCents: collateral.stakeCents,
      collateralRequired: collateral.required,
      conversationId: deal.conversation_id ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// ensureDealConversation — open the deal's chat thread on demand
// ---------------------------------------------------------------------------

/** Errors surfaced by {@link ensureDealConversation}. */
export type EnsureDealConversationError =
  | DealAuthError
  | 'not-joined'
  | 'persistence-error';

/** Result of {@link ensureDealConversation}. */
export type EnsureDealConversationResult =
  | { ok: true; conversationId: string }
  | ActionFailure<EnsureDealConversationError>;

/**
 * Resolve the deal's chat thread, creating and linking it if needed.
 *
 * Deals joined before chat existed (or an interrupted join) have no thread, so
 * the deal room calls this on first view — the same self-healing path the cash
 * sale contract room uses. Authorization is enforced twice: the participant
 * guard here, and again inside the RPC.
 */
export async function ensureDealConversation(
  dealId: string,
): Promise<EnsureDealConversationResult> {
  const guard = await requireParticipant(dealId);
  if (!guard.ok) return guard;
  const { userId, deal } = guard.ctx;

  if (deal.counterparty_id === null) {
    return { ok: false, error: 'not-joined' };
  }
  if (deal.conversation_id) {
    return { ok: true, conversationId: deal.conversation_id };
  }

  const conversationId = await openDealConversation(dealId, userId);
  if (!conversationId) {
    return {
      ok: false,
      error: 'persistence-error',
      detail: 'Chat could not be opened.',
    };
  }
  return { ok: true, conversationId };
}

// ---------------------------------------------------------------------------
// listMyDeals
// ---------------------------------------------------------------------------

/** A deal summarized for the "My deals" list. */
export interface MyDealEntry {
  id: string;
  title: string;
  state: DealState;
  /** True when the caller created the deal. */
  iAmCreator: boolean;
  /** `null` while the deal is unjoined (nobody has opened the share link yet). */
  otherPartyId: string | null;
  /** `null` when there is no other party, or they have no display name set. */
  otherPartyName: string | null;
  /** ISO timestamp of the deal's last change (drives the relative time). */
  updatedAt: string;
  /** True when the caller has ticked "happy with the deal". */
  myConfirmed: boolean;
  /** True when the other party has ticked. */
  theirConfirmed: boolean;
}

/** Errors surfaced by {@link listMyDeals}. */
export type ListMyDealsError = 'unauthenticated' | 'persistence-error';

/** Result of {@link listMyDeals}. */
export type ListMyDealsResult =
  | { ok: true; deals: MyDealEntry[] }
  | ActionFailure<ListMyDealsError>;

/**
 * List every deal the caller is a party to, newest activity first, enriched with
 * the other party's public display name. RLS already scopes the read to deals
 * where the caller is `creator_id` or `counterparty_id`.
 */
export async function listMyDeals(): Promise<ListMyDealsResult> {
  const supabase = await createClient();

  const me = await getUserId(supabase);
  if (!me) return { ok: false, error: 'unauthenticated' };

  const { data, error } = await supabase
    .from('deals')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) {
    return { ok: false, error: 'persistence-error', detail: error.message };
  }

  const rows = (data ?? []) as DealRow[];
  if (rows.length === 0) return { ok: true, deals: [] };

  const otherIds = Array.from(
    new Set(
      rows
        .map((d) => otherPartyOf(d, me))
        .filter((id): id is string => id !== null),
    ),
  );
  const { data: profiles } = otherIds.length
    ? await supabase
        .from('public_profiles')
        .select('id, display_name')
        .in('id', otherIds)
    : { data: [] as { id: string; display_name: string | null }[] };

  const nameById = new Map(
    (profiles ?? []).map((p) => [
      p.id as string,
      (p.display_name as string | null) ?? null,
    ]),
  );

  const deals: MyDealEntry[] = rows.map((deal) => {
    const iAmCreator = deal.creator_id === me;
    const otherPartyId = otherPartyOf(deal, me);
    return {
      id: deal.id,
      title: deal.title,
      state: deal.state,
      iAmCreator,
      otherPartyId,
      otherPartyName: otherPartyId ? nameById.get(otherPartyId) ?? null : null,
      updatedAt: deal.updated_at,
      myConfirmed: iAmCreator
        ? deal.creator_confirmed_at !== null
        : deal.counterparty_confirmed_at !== null,
      theirConfirmed: iAmCreator
        ? deal.counterparty_confirmed_at !== null
        : deal.creator_confirmed_at !== null,
    };
  });

  return { ok: true, deals };
}
