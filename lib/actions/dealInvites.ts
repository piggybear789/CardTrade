'use server';

// lib/actions/dealInvites.ts
//
// Private-deal invites: a shareable link that, on claim, opens a Cash_Sale or a
// Trade. The invite is not a contract. Writes go through the service role;
// members may only SELECT their own unused/used invites under RLS.

import { withActionLog } from '@/lib/errors/withActionLog';
import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createPrivateTradeItem } from '@/lib/actions/listings';
import { fail, ok, type ActionResult } from '@/lib/actions/result';
import { createNotification } from '@/lib/notifications/createNotification';
import { cashSaleRefusalMessage } from '@/lib/cashSaleErrors';
import { loadSellerIdentityDisclosure, readSellerPayReadiness } from '@/lib/sellerIdentity';
import { readIdentityGate } from '@/lib/identityGate';
import { removeImages, verifyStoredImages } from '@/lib/storage/itemImages';
import { readImageDims } from '@/lib/images/dimensions';
import { validateItemSubmission } from '@/domain/validation';
import { getPaymentService, operationalRegions } from '@/domain/services';
import { createDefaultCashSaleOrchestrator } from '@/domain/orchestrator/supabaseCashSaleRepository';
import { checkRegionCompatibility, regionCurrency, regionMismatchMessage } from '@/domain/region';
import {
  cashPriceProblem,
  DEAL_INVITE_TTL_MS,
  inviteStatus,
  privateItemProblem,
  wantedDescriptionProblem,
  joinerPutsUpACard,
  cashDealParties,
} from '@/domain/deals/dealInvite';
import type { Tables } from '@/lib/supabase/database.types';
import type { SellerIdentityDisclosure } from '@/domain/orchestrator/merchantOnboarding';

type InviteRow = Tables<'deal_invites'>;

// NO IDENTITY OR CARD CODES. Creating and joining a deal need neither: the checks
// sit where money or a hold moves — the sale room's Pay step
// (`acceptCashSaleTerms`) and swap terms acceptance (`acceptTradeTerms`).
export type DealInviteError =
  | 'unauthenticated'
  | 'invalid-input'
  | 'no-region'
  | 'region-mismatch'
  | 'item-create-failed'
  | 'not-found'
  | 'expired'
  | 'revoked'
  | 'claimed'
  | 'self-join'
  | 'not-host'
  | 'wrong-kind'
  | 'private-item-required'
  | 'rejected';

/**
 * What still stands between the host and the deal going through.
 *
 * - `ready` — nothing: a seller can be paid, a trader can enter the swap.
 * - `identity-needed` — Stripe Identity is not done yet.
 * - `payout-setup-needed` — a seller is verified but has no buyer-safe disclosure
 *   yet, which only payout setup writes today (`merchant_identity_disclosure_consented_at`).
 */
export type HostReadiness = 'ready' | 'identity-needed' | 'payout-setup-needed';

export type PrivateDealItemInput = {
  /** Short label for the card. Blank derivations fall back to the description. */
  title?: string;
  description: string;
  category: string;
  condition: string;
  fmvCents: number;
  images: string[];
};

export type CreateDealInviteInput =
  | {
      kind: 'CASH_SALE';
      hostRole: 'SELLER';
      item: PrivateDealItemInput;
      priceCents: number;
      message?: string | null;
    }
  | {
      kind: 'CASH_SALE';
      hostRole: 'BUYER';
      wantedDescription: string;
      priceCents: number;
      message?: string | null;
    }
  | {
      kind: 'TRADE';
      item: PrivateDealItemInput;
      wantedDescription: string;
      cashAmountCents: number;
      cashDirection: 'PROPOSER_PAYS' | 'COUNTERPART_PAYS';
      declaredValueCents?: number | null;
      message?: string | null;
    };

export interface DealInviteSummary {
  id: string;
  token: string;
  kind: InviteRow['kind'];
  hostRole: InviteRow['host_role'];
  priceCents: number | null;
  hostItemTitle: string | null;
  wantedDescription: string | null;
  expiresAt: string;
  createdAt: string;
  path: string;
}

export interface DealInvitePreview {
  token: string;
  status: ReturnType<typeof inviteStatus> | 'not-found';
  id: string | null;
  kind: InviteRow['kind'] | null;
  hostRole: InviteRow['host_role'];
  hostId: string | null;
  hostName: string | null;
  isHost: boolean;
  priceCents: number | null;
  wantedDescription: string | null;
  offerMessage: string | null;
  expiresAt: string | null;
  item: {
    id: string;
    title: string;
    imagePath: string | null;
    fmvCents: number;
  } | null;
  sellerIdentity: SellerIdentityDisclosure | null;
  /**
   * The host's standing, for the status line on the invite and the host's own
   * "verify now" prompt. Informational only: joining no longer depends on it. Null
   * on a legacy host-BUYER invite, where the host has nothing to verify.
   */
  hostReadiness: HostReadiness | null;
  /** ISO 4217 code the deal is priced in, from the host's trading region. */
  currency: string | null;
  /**
   * The host's trading region. A deal runs inside one region, so a brand-new joiner's
   * country picker starts here.
   */
  hostRegion: string | null;
  /**
   * Why the signed-in viewer cannot claim this invite, or `null` when nothing
   * knowable blocks them.
   *
   * DISCLOSURE, NOT ENFORCEMENT — `claimDealInvite` re-checks every condition and
   * is the only thing that decides. This exists so the join form can say "you need
   * to verify" BEFORE the member describes a card and uploads photos, which is the
   * work that was previously thrown away: the refusal landed after
   * `createHiddenItem` had already written an `items` row and its Storage objects,
   * and only the invite lock was rolled back. Three orphaned rows with live images
   * are what surfaced it, one per retry.
   *
   * Both this and the refusal read {@link claimBlock}, so the wording cannot drift.
   */
  viewerBlock: { reason: DealInviteError; message: string } | null;
  contractPath: string | null;
  /**
   * What the host may still change, for the edit dialog on the link screen. Only
   * for the host of an open invite whose card they put up — never for a guest, a
   * settled invite, or a legacy host-BUYER invite, which has no card to edit.
   */
  editable: DealInviteEditable | null;
}

/** The whole card and the terms, as the edit dialog starts from them. */
export interface DealInviteEditable {
  title: string;
  description: string;
  category: string;
  condition: string;
  /** Every photo, in order. `item` above carries only the first. */
  imagePaths: string[];
  /** The sale price. Null on a trade. */
  priceCents: number | null;
  /** What the host's card is worth. Null on a sale. */
  valueCents: number | null;
  /** What the host wants for it. Null on a sale. */
  wantedDescription: string | null;
}

export type UpdateDealInviteInput = {
  inviteId: string;
  /** The card as edited. `images` are object paths: kept photos first, then new uploads. */
  item: Omit<PrivateDealItemInput, 'fmvCents'>;
} & (
  | { kind: 'CASH_SALE'; priceCents: number }
  | { kind: 'TRADE'; valueCents: number; wantedDescription: string }
);

export type ClaimDealInviteInput = {
  token: string;
  item?: PrivateDealItemInput;
};

/**
 * Reads through the request-cached lookup rather than `auth.getUser()`, which
 * revalidates the JWT against the auth server on every call. The purchases and
 * sales pages both list invites alongside their own auth-gated reads.
 */
async function currentUserId(): Promise<string | null> {
  const user = await getCachedAuthUser();
  return user?.id ?? null;
}

function invitePath(token: string): string {
  return `/t/${token}`;
}

function newToken(): string {
  return randomBytes(18).toString('base64url');
}

async function requireTradingRegion(
  userId: string,
): Promise<ActionResult<string, DealInviteError>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('profiles')
    .select('region_code')
    .eq('id', userId)
    .maybeSingle();
  const region = (data?.region_code as string | null) ?? null;
  const mismatch = checkRegionCompatibility(region, region, operationalRegions());
  if (mismatch) {
    return fail('no-region', regionMismatchMessage(mismatch));
  }
  return ok(region as string);
}

async function createHiddenItem(
  item: PrivateDealItemInput,
): Promise<ActionResult<string, DealInviteError>> {
  const created = await createPrivateTradeItem({
    title: item.title,
    description: item.description,
    category: item.category,
    condition: item.condition,
    fmvCents: item.fmvCents,
    images: item.images,
  });
  if (!created.ok) {
    return fail(
      'item-create-failed',
      created.message ?? 'That card could not be saved.',
    );
  }
  if (!created.data.hidden) {
    return fail('item-create-failed', 'A private deal can only use an unlisted card.');
  }
  return ok(created.data.id);
}

/**
 * Undo a hidden Item created for a claim that then failed.
 *
 * `claimDealInvite` writes the joiner's card BEFORE it can know the contract will
 * open, so a later refusal has to compensate or the row and its Storage objects
 * leak. Scoped to `hidden = true` so a defect in the caller can never reach a real
 * listing, and best-effort like `removeImages`: the refusal the caller is already
 * returning is the more useful error.
 */
async function discardHiddenItem(itemId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from('items')
      .select('image_paths')
      .eq('id', itemId)
      .maybeSingle();
    await admin.from('items').delete().eq('id', itemId).eq('hidden', true);
    await removeImages(admin, (data?.image_paths as string[] | null) ?? []);
  } catch {
    // Best-effort. Never mask the refusal that triggered the cleanup.
  }
}

/**
 * Every reason a viewer cannot claim an invite that is knowable before any work
 * is done, or `null` when none applies.
 *
 * ONE FUNCTION FOR TWO CALLERS. `claimDealInvite` uses it to refuse early and
 * `getDealInvitePreview` uses it to disclose, so the join form's warning and the
 * eventual refusal are the same sentence by construction rather than by two people
 * remembering to edit both.
 *
 * NO IDENTITY_GATE HERE, for either party. Joining opens a room where the two of
 * them agree terms; nothing is paid or held yet. The gate is enforced where money
 * moves: a sale's Pay step checks the seller (`acceptCashSaleTerms`), and a swap's
 * terms acceptance checks both traders (`acceptTradeTerms`), before any charge or
 * card hold. Region still gates here, because the room is a contract in one
 * jurisdiction and there is no Pay step that could make a cross-border one work.
 */
async function claimBlock(
  invite: InviteRow,
  viewerId: string,
): Promise<{ reason: DealInviteError; message: string } | null> {
  if (invite.host_id === viewerId) {
    return { reason: 'self-join', message: 'You cannot join your own deal.' };
  }

  const hostRegion = await requireTradingRegion(invite.host_id);
  if (!hostRegion.ok) {
    return { reason: 'region-mismatch', message: hostRegion.message };
  }
  const viewerRegion = await requireTradingRegion(viewerId);
  if (!viewerRegion.ok) {
    return { reason: 'no-region', message: viewerRegion.message };
  }
  const mismatch = checkRegionCompatibility(
    viewerRegion.data,
    hostRegion.data,
    operationalRegions(),
  );
  if (mismatch) {
    return { reason: 'region-mismatch', message: regionMismatchMessage(mismatch) };
  }

  if (invite.kind === 'CASH_SALE' && !invite.host_role) {
    return { reason: 'wrong-kind', message: 'That cash deal is missing a host role.' };
  }

  return null;
}

/**
 * Where the host stands. See {@link HostReadiness}.
 *
 * A seller needs a buyer-safe disclosure, not just the gate: the Buyer confirms the
 * verified name at Pay. A verified seller without one is `payout-setup-needed`,
 * never `identity-needed`, because sending an already-verified member back to a
 * check they passed is the false negative this path was once reported for.
 */
async function readHostReadiness(invite: InviteRow): Promise<HostReadiness | null> {
  if (invite.kind === 'TRADE') {
    return (await readIdentityGate(invite.host_id)).satisfied ? 'ready' : 'identity-needed';
  }
  if (invite.host_role !== 'SELLER') return null;
  return (await readSellerPayReadiness(invite.host_id)).state;
}

/**
 * Whether the host can edit this invite's card and terms: a trade, or a sale the
 * host is SELLING. A legacy host-BUYER invite has no card of the host's to edit.
 * The same rule is enforced again inside `update_deal_invite`.
 */
function inviteIsEditable(invite: InviteRow): boolean {
  if (!invite.host_item_id) return false;
  return invite.kind === 'TRADE' || invite.host_role === 'SELLER';
}

/** `update_deal_invite` raises one of these; everything else is a failed write. */
function updateRefusal(message: string): { reason: DealInviteError; message: string } {
  if (message.includes('invite-claimed')) {
    return { reason: 'claimed', message: "Someone already joined, so this deal can't be changed." };
  }
  if (message.includes('invite-revoked')) {
    return { reason: 'revoked', message: 'This deal was cancelled.' };
  }
  if (message.includes('invite-expired')) {
    return { reason: 'expired', message: 'This deal has expired.' };
  }
  if (message.includes('invite-not-host')) {
    return { reason: 'not-host', message: 'Only the person who started this deal can change it.' };
  }
  if (message.includes('invite-not-editable') || message.includes('invite-item-unavailable')) {
    return {
      reason: 'wrong-kind',
      message: "This deal can't be changed. Cancel it and start a new one.",
    };
  }
  return { reason: 'rejected', message: 'Your changes could not be saved. Please retry.' };
}

async function loadHiddenItem(
  itemId: string,
  expectedOwnerId: string,
): Promise<ActionResult<{ id: string; hidden: boolean; ownerId: string; status: string }, DealInviteError>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('items')
    .select('id, hidden, owner_id, status')
    .eq('id', itemId)
    .maybeSingle();
  const item = data
    ? {
        id: data.id as string,
        hidden: Boolean(data.hidden),
        ownerId: data.owner_id as string,
        status: data.status as string,
      }
    : null;
  const problem = privateItemProblem(item, expectedOwnerId);
  if (problem) return fail('private-item-required', problem);
  return ok(item!);
}

export const createDealInvite = withActionLog('dealInvites.createDealInvite', async function createDealInvite(
  input: CreateDealInviteInput,
): Promise<ActionResult<{ token: string; path: string }, DealInviteError>> {
  const userId = await currentUserId();
  if (!userId) return fail('unauthenticated', 'Sign in to start a private deal.');

  const region = await requireTradingRegion(userId);
  if (!region.ok) return region;

  if (input.kind === 'CASH_SALE') {
    const priceProblem = cashPriceProblem(input.priceCents);
    if (priceProblem) return fail('invalid-input', priceProblem, 'priceCents');
  }

  let hostItemId: string | null = null;
  let hostRole: InviteRow['host_role'] = null;
  let priceCents: number | null = null;
  let wantedDescription: string | null = null;
  let cashAmountCents = 0;
  let cashDirection: InviteRow['cash_direction'] = 'PROPOSER_PAYS';
  let declaredValueCents: number | null = null;
  const message = input.message?.trim() || null;

  // NO IDENTITY_GATE ON CREATING A LINK. Stripe Identity is asked for where money or
  // a hold moves, not here: see `claimBlock`.
  if (input.kind === 'CASH_SALE') {
    hostRole = input.hostRole;
    priceCents = input.priceCents;
    if (input.hostRole === 'SELLER') {
      const created = await createHiddenItem({
        ...input.item,
        fmvCents: input.priceCents,
      });
      if (!created.ok) return created;
      hostItemId = created.data;
    } else {
      const wanted = wantedDescriptionProblem(input.wantedDescription, true);
      if (wanted) return fail('invalid-input', wanted, 'wantedDescription');
      wantedDescription = input.wantedDescription.trim();
    }
  } else {
    const wanted = wantedDescriptionProblem(input.wantedDescription, true);
    if (wanted) return fail('invalid-input', wanted, 'wantedDescription');
    wantedDescription = input.wantedDescription.trim();
    if (
      !Number.isInteger(input.cashAmountCents) ||
      input.cashAmountCents < 0 ||
      input.cashAmountCents > 100_000_000
    ) {
      return fail('invalid-input', 'Enter a valid cash amount up to $1,000,000.');
    }
    cashAmountCents = input.cashAmountCents;
    cashDirection = input.cashDirection;
    declaredValueCents = input.declaredValueCents ?? input.item.fmvCents;
    const created = await createHiddenItem(input.item);
    if (!created.ok) return created;
    hostItemId = created.data;
  }

  const token = newToken();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('deal_invites')
    .insert({
      token,
      host_id: userId,
      kind: input.kind,
      host_role: hostRole,
      host_item_id: hostItemId,
      price_cents: priceCents,
      cash_amount_cents: cashAmountCents,
      cash_direction: cashDirection,
      declared_value_cents: declaredValueCents,
      wanted_description: wantedDescription,
      offer_message: message,
      expires_at: new Date(Date.now() + DEAL_INVITE_TTL_MS).toISOString(),
    })
    .select('token')
    .single();

  if (error || !data) {
    return fail('rejected', 'That deal could not be created. Please retry.');
  }

  revalidatePath('/trades');
  revalidatePath('/sales');
  revalidatePath('/purchases');
  return ok({ token: data.token, path: invitePath(data.token) });
});

export const revokeDealInvite = withActionLog('dealInvites.revokeDealInvite', async function revokeDealInvite(
  inviteId: string,
): Promise<ActionResult<{ id: string }, DealInviteError>> {
  const userId = await currentUserId();
  if (!userId) return fail('unauthenticated', 'Sign in to revoke a deal.');

  const admin = createAdminClient();
  const { data } = await admin
    .from('deal_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', inviteId)
    .eq('host_id', userId)
    .is('claimed_at', null)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();

  if (!data) {
    return fail('not-host', 'That invite is no longer waiting for someone to join.');
  }
  revalidatePath('/trades');
  revalidatePath('/sales');
  revalidatePath('/purchases');
  return ok({ id: data.id });
});

/**
 * Change an invite nobody has joined: its card, photos and terms. The link stays
 * the same, so whoever already has it sees the edit.
 *
 * Everything that can be checked without the lock is checked here — the price, the
 * card's fields, that every NEW photo is the host's own upload — and then
 * `update_deal_invite` writes the card and the terms in one transaction on the
 * invite row, the row a claim locks. A claim that got there first makes the edit a
 * no-op refusal; see 0124.
 */
export const updateDealInvite = withActionLog('dealInvites.updateDealInvite', async function updateDealInvite(
  input: UpdateDealInviteInput,
): Promise<ActionResult<{ path: string }, DealInviteError>> {
  const userId = await currentUserId();
  if (!userId) return fail('unauthenticated', 'Sign in to change your deal.');

  const admin = createAdminClient();
  const { data } = await admin
    .from('deal_invites')
    .select('*')
    .eq('id', input.inviteId)
    .maybeSingle();
  const invite = data as InviteRow | null;
  if (!invite || invite.host_id !== userId) {
    return fail('not-host', 'Only the person who started this deal can change it.');
  }

  // What the card has now: a kept photo keeps its measured size, and any other path
  // is a new upload, whose ownership is only a claim from the browser until proved.
  const { data: current } = invite.host_item_id
    ? await admin
        .from('items')
        .select('image_paths, image_dims')
        .eq('id', invite.host_item_id)
        .maybeSingle()
    : { data: null };
  const currentPaths = (current?.image_paths as string[] | null) ?? [];
  const currentDims = readImageDims(current?.image_dims, currentPaths.length);
  const dimsByPath = new Map(currentPaths.map((path, index) => [path, currentDims[index]]));
  const uploaded = input.item.images.filter((path) => !dimsByPath.has(path));
  try {
    await verifyStoredImages(admin, userId, uploaded);
  } catch (e) {
    return fail(
      'invalid-input',
      e instanceof Error ? e.message : 'One of these photos is not yours.',
      'images',
    );
  }

  // PROVED FIRST, THEN DISPOSABLE. From here the new uploads are known to be the
  // host's own, and an edit that goes nowhere leaves nothing referring to them.
  // Deleting before the proof would let a crafted request delete someone else's.
  async function refuse(
    reason: DealInviteError,
    message: string,
    field?: string,
  ): Promise<ActionResult<{ path: string }, DealInviteError>> {
    await removeImages(admin, uploaded);
    return fail(reason, message, field);
  }

  const status = inviteStatus({
    expiresAt: invite.expires_at,
    revokedAt: invite.revoked_at,
    claimedAt: invite.claimed_at,
  });
  if (status !== 'open') {
    const refusal = updateRefusal(`invite-${status}`);
    return refuse(refusal.reason, refusal.message);
  }
  if (invite.kind !== input.kind || !inviteIsEditable(invite)) {
    const refusal = updateRefusal('invite-not-editable');
    return refuse(refusal.reason, refusal.message);
  }

  let priceCents: number | null = null;
  let valueCents: number | null = null;
  let wantedDescription: string | null = null;
  if (input.kind === 'CASH_SALE') {
    const problem = cashPriceProblem(input.priceCents);
    if (problem) return refuse('invalid-input', problem, 'priceCents');
    priceCents = input.priceCents;
  } else {
    const wanted = wantedDescriptionProblem(input.wantedDescription, true);
    if (wanted) return refuse('invalid-input', wanted, 'wantedDescription');
    wantedDescription = input.wantedDescription.trim();
    valueCents = input.valueCents;
  }

  // On a sale the card is worth its price, as `createDealInvite` records it. A typed
  // title wins over the description; `createPrivateTradeItem` derives the same fallback
  // when it is blank, so the two paths cannot disagree.
  const validated = validateItemSubmission({
    title: input.item.title,
    description: input.item.description,
    category: input.item.category,
    condition: input.item.condition,
    fmvCents: priceCents ?? valueCents,
    images: input.item.images,
  });
  if (!validated.ok) {
    return refuse('invalid-input', validated.message, validated.field);
  }
  const images = validated.value.images;

  const { data: previousPaths, error } = await admin.rpc('update_deal_invite', {
    p_invite_id: invite.id,
    p_host_id: userId,
    p_price_cents: priceCents,
    p_declared_value_cents: valueCents,
    p_wanted_description: wantedDescription,
    p_item_title: validated.value.title,
    p_item_description: validated.value.description,
    p_item_category: validated.value.category,
    p_item_condition: validated.value.condition,
    p_item_fmv_cents: validated.value.fmvCents,
    p_item_image_paths: images,
    p_item_image_dims: images.map((path) => dimsByPath.get(path) ?? null),
  });
  if (error) {
    const refusal = updateRefusal(error.message);
    return refuse(refusal.reason, refusal.message);
  }

  const kept = new Set(images);
  await removeImages(
    admin,
    ((previousPaths as string[] | null) ?? []).filter((path) => !kept.has(path)),
  );

  revalidatePath(invitePath(invite.token));
  revalidatePath('/trades');
  revalidatePath('/sales');
  return ok({ path: invitePath(invite.token) });
});

export const listMyDealInvites = withActionLog('dealInvites.listMyDealInvites', async function listMyDealInvites(
  kind?: InviteRow['kind'],
  hostRole?: NonNullable<InviteRow['host_role']>,
): Promise<ActionResult<DealInviteSummary[], DealInviteError>> {
  const userId = await currentUserId();
  if (!userId) return fail('unauthenticated', 'Sign in to see your deals.');

  const supabase = await createClient();
  let query = supabase
    .from('deal_invites')
    .select(
      'id, token, kind, host_role, price_cents, host_item_id, wanted_description, expires_at, created_at, claimed_at, revoked_at',
    )
    .eq('host_id', userId)
    .is('claimed_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (kind) query = query.eq('kind', kind);
  if (hostRole) query = query.eq('host_role', hostRole);

  const { data, error } = await query;
  if (error) return fail('rejected', error.message);

  const rows = (data ?? []) as Array<
    Pick<
      InviteRow,
      | 'id'
      | 'token'
      | 'kind'
      | 'host_role'
      | 'price_cents'
      | 'host_item_id'
      | 'wanted_description'
      | 'expires_at'
      | 'created_at'
    >
  >;
  const itemIds = rows.map((row) => row.host_item_id).filter((id): id is string => Boolean(id));
  const titles = new Map<string, string>();
  if (itemIds.length > 0) {
    const { data: items } = await supabase
      .from('items')
      .select('id, title')
      .in('id', itemIds);
    for (const item of items ?? []) {
      titles.set(item.id as string, item.title as string);
    }
  }

  return ok(
    rows.map((row) => ({
      id: row.id,
      token: row.token,
      kind: row.kind,
      hostRole: row.host_role,
      priceCents: row.price_cents,
      hostItemTitle: row.host_item_id ? titles.get(row.host_item_id) ?? null : null,
      wantedDescription: row.wanted_description,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      path: invitePath(row.token),
    })),
  );
});

export const getDealInvitePreview = withActionLog('dealInvites.getDealInvitePreview', async function getDealInvitePreview(
  token: string,
): Promise<DealInvitePreview> {
  const empty: DealInvitePreview = {
    token,
    status: 'not-found',
    id: null,
    kind: null,
    hostRole: null,
    hostId: null,
    hostName: null,
    isHost: false,
    priceCents: null,
    wantedDescription: null,
    offerMessage: null,
    expiresAt: null,
    item: null,
    sellerIdentity: null,
    hostReadiness: null,
    currency: null,
    hostRegion: null,
    viewerBlock: null,
    contractPath: null,
    editable: null,
  };
  if (!token || token.length < 16) return empty;

  const userId = await currentUserId();
  const admin = createAdminClient();
  const { data } = await admin
    .from('deal_invites')
    .select('*')
    .eq('token', token)
    .maybeSingle();
  const invite = data as InviteRow | null;
  if (!invite) return empty;

  const status = inviteStatus({
    expiresAt: invite.expires_at,
    revokedAt: invite.revoked_at,
    claimedAt: invite.claimed_at,
  });

  let contractPath: string | null = null;
  if (status === 'claimed') {
    if (invite.cash_sale_id && (userId === invite.host_id || userId === invite.claimed_by)) {
      contractPath = `/sales/${invite.cash_sale_id}`;
    }
    if (invite.trade_id && (userId === invite.host_id || userId === invite.claimed_by)) {
      contractPath = `/trades/${invite.trade_id}`;
    }
  }

  const isHost = userId === invite.host_id;
  let item: DealInvitePreview['item'] = null;
  let editable: DealInviteEditable | null = null;
  if (invite.host_item_id) {
    const { data: itemRow } = await admin
      .from('items')
      .select('id, title, description, category, condition, image_paths, fmv_cents')
      .eq('id', invite.host_item_id)
      .maybeSingle();
    if (itemRow) {
      const paths = (itemRow.image_paths as string[] | null) ?? [];
      item = {
        id: itemRow.id as string,
        title: itemRow.title as string,
        imagePath: paths[0] ?? null,
        fmvCents: itemRow.fmv_cents as number,
      };
      if (isHost && status === 'open' && inviteIsEditable(invite)) {
        editable = {
          title: itemRow.title as string,
          description: itemRow.description as string,
          category: itemRow.category as string,
          condition: itemRow.condition as string,
          imagePaths: paths,
          priceCents: invite.kind === 'CASH_SALE' ? invite.price_cents : null,
          valueCents:
            invite.kind === 'TRADE'
              ? (invite.declared_value_cents ?? (itemRow.fmv_cents as number))
              : null,
          wantedDescription: invite.kind === 'TRADE' ? invite.wanted_description : null,
        };
      }
    }
  }

  const { data: host } = await admin
    .from('profiles')
    .select('display_name, region_code')
    .eq('id', invite.host_id)
    .maybeSingle();

  const sellerId =
    invite.kind === 'CASH_SALE' && invite.host_role === 'SELLER' ? invite.host_id : null;

  // Only for a signed-in non-host viewer of a live invite: the host gets
  // `DealInviteShare`, a guest gets the sign-in preview, and a settled invite has
  // nothing left to block.
  const [sellerIdentity, hostReadiness, viewerBlock] = await Promise.all([
    sellerId ? loadSellerIdentityDisclosure(sellerId) : Promise.resolve(null),
    status === 'open' ? readHostReadiness(invite) : Promise.resolve(null),
    userId && userId !== invite.host_id && status === 'open'
      ? claimBlock(invite, userId)
      : Promise.resolve(null),
  ]);

  return {
    token,
    status,
    id: invite.id,
    kind: invite.kind,
    hostRole: invite.host_role,
    hostId: invite.host_id,
    hostName: (host?.display_name as string | undefined)?.trim() || 'A member',
    isHost,
    priceCents: invite.price_cents,
    wantedDescription: invite.wanted_description,
    offerMessage: invite.offer_message,
    expiresAt: invite.expires_at,
    item,
    sellerIdentity,
    hostReadiness,
    currency: regionCurrency((host?.region_code as string | null) ?? null),
    hostRegion: (host?.region_code as string | null) ?? null,
    viewerBlock,
    contractPath,
    editable,
  };
});

export const claimDealInvite = withActionLog('dealInvites.claimDealInvite', async function claimDealInvite(
  input: ClaimDealInviteInput,
): Promise<ActionResult<{ path: string }, DealInviteError>> {
  const userId = await currentUserId();
  if (!userId) return fail('unauthenticated', 'Sign in to join this deal.');

  const admin = createAdminClient();
  const { data } = await admin
    .from('deal_invites')
    .select('*')
    .eq('token', input.token)
    .maybeSingle();
  const invite = data as InviteRow | null;
  if (!invite) return fail('not-found', 'That invite could not be found.');

  const status = inviteStatus({
    expiresAt: invite.expires_at,
    revokedAt: invite.revoked_at,
    claimedAt: invite.claimed_at,
  });
  if (status === 'expired') return fail('expired', 'This invite has expired.');
  if (status === 'revoked') return fail('revoked', 'This invite was cancelled.');
  if (status === 'claimed') {
    const path =
      invite.cash_sale_id && (userId === invite.host_id || userId === invite.claimed_by)
        ? `/sales/${invite.cash_sale_id}`
        : invite.trade_id && (userId === invite.host_id || userId === invite.claimed_by)
          ? `/trades/${invite.trade_id}`
          : null;
    if (path) return ok({ path });
    return fail('claimed', 'Someone already joined this deal.');
  }
  // BEFORE the joiner's card is written, not after, so a refusal never leaves an
  // orphaned hidden item and its photos behind.
  const blocked = await claimBlock(invite, userId);
  if (blocked) return fail(blocked.reason, blocked.message);

  let joinerItemId: string | null = null;
  if (joinerPutsUpACard(invite.kind, invite.host_role)) {
    if (!input.item) {
      return fail('private-item-required', 'Describe the card you are putting up.');
    }
    const created = await createHiddenItem(
      invite.kind === 'CASH_SALE'
        ? { ...input.item, fmvCents: invite.price_cents ?? input.item.fmvCents }
        : input.item,
    );
    if (!created.ok) return created;
    joinerItemId = created.data;
  }

  const now = new Date().toISOString();
  const { data: locked } = await admin
    .from('deal_invites')
    .update({ claimed_at: now, claimed_by: userId })
    .eq('id', invite.id)
    .is('claimed_at', null)
    .is('revoked_at', null)
    .gt('expires_at', now)
    .select('*')
    .maybeSingle();
  if (!locked) {
    // The card was created for a claim that lost the race, so it belongs to nothing.
    if (joinerItemId) await discardHiddenItem(joinerItemId);
    return fail('claimed', 'Someone already joined this deal.');
  }

  // FROM THE LOCKED ROW, not the one read above. The host can edit the terms until
  // this moment (`update_deal_invite`), and the room must open on the terms as they
  // stood when the claim won the row, not as they were a request earlier.
  const opened = await openClaimedInvite(locked as InviteRow, userId, joinerItemId);
  if (!opened.ok) {
    await admin
      .from('deal_invites')
      .update({ claimed_at: null, claimed_by: null })
      .eq('id', invite.id)
      .eq('claimed_by', userId);
    // Releasing the lock without this leaves the item behind, and the invite is
    // claimable again — so a member retrying accumulates one orphan per attempt.
    if (joinerItemId) await discardHiddenItem(joinerItemId);
    return opened;
  }

  await admin
    .from('deal_invites')
    .update(
      invite.kind === 'CASH_SALE'
        ? { cash_sale_id: opened.data.contractId }
        : { trade_id: opened.data.contractId },
    )
    .eq('id', invite.id);

  revalidatePath('/trades');
  revalidatePath('/sales');
  revalidatePath('/purchases');
  revalidatePath(opened.data.path);
  return ok({ path: opened.data.path });
});

async function openClaimedInvite(
  invite: InviteRow,
  joinerId: string,
  joinerItemId: string | null,
): Promise<ActionResult<{ path: string; contractId: string }, DealInviteError>> {
  if (invite.kind === 'TRADE') {
    if (!invite.host_item_id || !joinerItemId) {
      return fail('private-item-required', 'Both sides need an unlisted card.');
    }
    const hostItem = await loadHiddenItem(invite.host_item_id, invite.host_id);
    if (!hostItem.ok) return hostItem;
    const joinerItem = await loadHiddenItem(joinerItemId, joinerId);
    if (!joinerItem.ok) return joinerItem;

    const admin = createAdminClient();
    const { data, error } = await admin.rpc('open_trade_negotiation', {
      p_initiator_id: invite.host_id,
      p_counterpart_id: joinerId,
      p_initiator_item_id: invite.host_item_id,
      p_counterpart_item_id: joinerItemId,
      p_cash_amount_cents: invite.cash_amount_cents,
      p_cash_direction: invite.cash_direction,
      p_declared_value_cents: invite.declared_value_cents,
      p_offer_message: invite.offer_message,
      p_counterpart_goods_description: null,
    });
    const row = data as { id: string } | null;
    if (error || !row?.id) {
      return fail('rejected', error?.message ?? 'That trade could not be opened.');
    }
    await createNotification({
      userId: invite.host_id,
      type: 'TRADE',
      title: 'Someone joined your deal',
      body: 'A trader accepted your private trade invite.',
      link: `/trades/${row.id}`,
    });
    return ok({ path: `/trades/${row.id}`, contractId: row.id as string });
  }

  if (!invite.host_role) {
    return fail('wrong-kind', 'That cash deal is missing a host role.');
  }
  const { sellerId, buyerId } = cashDealParties(
    invite.host_role,
    invite.host_id,
    joinerId,
  );
  const itemId = invite.host_role === 'SELLER' ? invite.host_item_id : joinerItemId;
  if (!itemId) return fail('private-item-required', 'This deal needs a card.');
  const item = await loadHiddenItem(itemId, sellerId);
  if (!item.ok) return item;
  if (invite.price_cents == null) return fail('wrong-kind', 'That cash deal is missing a price.');

  // No card and no verified seller needed to open the room. The Buyer confirms the
  // verified seller, and adds a card if they have none, on the Pay step.
  const result = await createDefaultCashSaleOrchestrator({
    payments: getPaymentService(),
  }).openPrivateDealCashSale({
    buyerId,
    itemId,
    agreedPriceCents: invite.price_cents,
  });
  if (!result.ok) {
    return fail(
      result.error === 'REGION_MISMATCH'
        ? 'region-mismatch'
        : result.error === 'SELF_PURCHASE'
          ? 'self-join'
          : 'rejected',
      result.detail ?? cashSaleRefusalMessage(result.error),
    );
  }

  await createNotification({
    userId: invite.host_id,
    type: 'SALE',
    title: 'Someone joined your deal',
    body: 'A member claimed your private deal invite.',
    link: `/sales/${result.sale.id}`,
  });
  return ok({ path: `/sales/${result.sale.id}`, contractId: result.sale.id });
}
