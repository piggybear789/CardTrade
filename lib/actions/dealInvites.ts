'use server';

// lib/actions/dealInvites.ts
//
// Private-deal invites: a shareable link that, on claim, opens a Cash_Sale or a
// Trade. The invite is not a contract. Writes go through the service role;
// members may only SELECT their own unused/used invites under RLS.

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createPrivateTradeItem } from '@/lib/actions/listings';
import { fail, ok, type ActionResult } from '@/lib/actions/result';
import { createNotification } from '@/lib/notifications/createNotification';
import { cashSaleRefusalMessage } from '@/lib/cashSaleErrors';
import { loadSellerIdentityDisclosure } from '@/lib/sellerIdentity';
import { getPaymentService, operationalRegions } from '@/domain/services';
import { createDefaultCashSaleOrchestrator } from '@/domain/orchestrator/supabaseCashSaleRepository';
import { checkRegionCompatibility, regionMismatchMessage } from '@/domain/region';
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

export type DealInviteError =
  | 'unauthenticated'
  | 'invalid-input'
  | 'no-region'
  | 'region-mismatch'
  | 'seller-identity-unverified'
  | 'item-create-failed'
  | 'not-found'
  | 'expired'
  | 'revoked'
  | 'claimed'
  | 'self-join'
  | 'not-host'
  | 'wrong-kind'
  | 'private-item-required'
  | 'buyer-confirmation-required'
  | 'no-payment-method'
  | 'rejected';

export type PrivateDealItemInput = {
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
  contractPath: string | null;
}

export type ClaimDealInviteInput = {
  token: string;
  item?: PrivateDealItemInput;
  buyerConfirmedSellerIdentity?: boolean;
};

async function currentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

export async function createDealInvite(
  input: CreateDealInviteInput,
): Promise<ActionResult<{ token: string; path: string }, DealInviteError>> {
  const userId = await currentUserId();
  if (!userId) return fail('unauthenticated', 'Sign in to start a deal.');

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

  if (input.kind === 'CASH_SALE') {
    hostRole = input.hostRole;
    priceCents = input.priceCents;
    if (input.hostRole === 'SELLER') {
      const identity = await loadSellerIdentityDisclosure(userId);
      if (!identity) {
        return fail(
          'seller-identity-unverified',
          'Verify your identity before selling a card through a private deal.',
        );
      }
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
}

export async function revokeDealInvite(
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
}

export async function listMyDealInvites(
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
}

export async function getDealInvitePreview(
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
    contractPath: null,
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

  let item: DealInvitePreview['item'] = null;
  if (invite.host_item_id) {
    const { data: itemRow } = await admin
      .from('items')
      .select('id, title, image_paths, fmv_cents')
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
    }
  }

  const { data: host } = await admin
    .from('profiles')
    .select('display_name')
    .eq('id', invite.host_id)
    .maybeSingle();

  const sellerId =
    invite.kind === 'CASH_SALE' && invite.host_role === 'SELLER' ? invite.host_id : null;
  const sellerIdentity = sellerId ? await loadSellerIdentityDisclosure(sellerId) : null;

  return {
    token,
    status,
    id: invite.id,
    kind: invite.kind,
    hostRole: invite.host_role,
    hostId: invite.host_id,
    hostName: (host?.display_name as string | undefined)?.trim() || 'A member',
    isHost: userId === invite.host_id,
    priceCents: invite.price_cents,
    wantedDescription: invite.wanted_description,
    offerMessage: invite.offer_message,
    expiresAt: invite.expires_at,
    item,
    sellerIdentity,
    contractPath,
  };
}

export async function claimDealInvite(
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
  if (invite.host_id === userId) {
    return fail('self-join', 'You cannot join your own deal.');
  }

  const hostRegion = await requireTradingRegion(invite.host_id);
  if (!hostRegion.ok) return fail('region-mismatch', hostRegion.message);
  const joinerRegion = await requireTradingRegion(userId);
  if (!joinerRegion.ok) return joinerRegion;
  const mismatch = checkRegionCompatibility(
    joinerRegion.data,
    hostRegion.data,
    operationalRegions(),
  );
  if (mismatch) return fail('region-mismatch', regionMismatchMessage(mismatch));

  if (invite.kind === 'CASH_SALE' && invite.host_role === 'SELLER') {
    if (!input.buyerConfirmedSellerIdentity) {
      return fail(
        'buyer-confirmation-required',
        'Confirm the verified seller before opening the agreement.',
      );
    }
  }

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
    .select('id')
    .maybeSingle();
  if (!locked) {
    return fail('claimed', 'Someone already joined this deal.');
  }

  const opened = await openClaimedInvite(invite, userId, joinerItemId);
  if (!opened.ok) {
    await admin
      .from('deal_invites')
      .update({ claimed_at: null, claimed_by: null })
      .eq('id', invite.id)
      .eq('claimed_by', userId);
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
}

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

  const identity = await loadSellerIdentityDisclosure(sellerId);
  if (!identity) {
    return fail(
      'seller-identity-unverified',
      'The seller has not verified their identity yet.',
    );
  }

  const result = await createDefaultCashSaleOrchestrator({
    payments: getPaymentService(),
  }).initiateCashSale({
    buyerId,
    itemId,
    sellerIdentityVersion: identity.version,
    buyerConfirmedSellerIdentity: true,
    agreedPriceCents: invite.price_cents ?? undefined,
  });
  if (!result.ok) {
    return fail(
      result.error === 'BUYER_NO_PAYMENT_METHOD'
        ? 'no-payment-method'
        : result.error === 'REGION_MISMATCH'
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
