// domain/deals/dealInvite.ts
//
// Pure guards for a private-deal invite. The invite is only a door: claim opens
// a Cash_Sale or a Trade. Nothing here talks to the database.

import { DEAL_CASH_MAX, DEAL_CASH_MIN } from '@/lib/marketplace-constants';

export const DEAL_INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const DEAL_INVITE_WANTED_MAX = 1000;

export type DealInviteKind = 'CASH_SALE' | 'TRADE';
export type DealInviteHostRole = 'SELLER' | 'BUYER';

export type DealInviteStatus =
  | 'open'
  | 'expired'
  | 'revoked'
  | 'claimed'
  | 'not-found';

export function dollarsToCents(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

export function inviteStatus(invite: {
  expiresAt: string;
  revokedAt: string | null;
  claimedAt: string | null;
  now?: Date;
}): Exclude<DealInviteStatus, 'not-found'> {
  if (invite.claimedAt) return 'claimed';
  if (invite.revokedAt) return 'revoked';
  const now = invite.now ?? new Date();
  if (new Date(invite.expiresAt).getTime() <= now.getTime()) return 'expired';
  return 'open';
}

export function cashPriceProblem(cents: number | null | undefined): string | null {
  if (cents == null || !Number.isInteger(cents)) {
    return 'Enter a price.';
  }
  if (cents < DEAL_CASH_MIN || cents > DEAL_CASH_MAX) {
    return 'Enter a price between $0.01 and the platform maximum.';
  }
  return null;
}

export function wantedDescriptionProblem(
  value: string | null | undefined,
  required: boolean,
): string | null {
  const trimmed = value?.trim() ?? '';
  if (required && trimmed === '') return 'Say what you want.';
  if (trimmed.length > DEAL_INVITE_WANTED_MAX) {
    return `Keep that under ${DEAL_INVITE_WANTED_MAX} characters.`;
  }
  return null;
}

/** Refuse attaching a catalog listing to a private deal. */
export function privateItemProblem(item: {
  hidden: boolean;
  ownerId: string;
  status: string;
} | null, expectedOwnerId: string): string | null {
  if (!item) return 'That item could not be found.';
  if (!item.hidden) return 'A private deal can only use an unlisted card.';
  if (item.ownerId !== expectedOwnerId) return 'You can only put up a card you own.';
  if (item.status !== 'AVAILABLE') return 'That card is no longer available.';
  return null;
}

/** The joiner describes a hidden card when the host did not bring the goods. */
export function joinerPutsUpACard(
  kind: DealInviteKind,
  hostRole: DealInviteHostRole | null,
): boolean {
  return kind === 'TRADE' || (kind === 'CASH_SALE' && hostRole === 'BUYER');
}

/** Who is seller and who is buyer once a cash invite is claimed. */
export function cashDealParties(
  hostRole: DealInviteHostRole,
  hostId: string,
  joinerId: string,
): { sellerId: string; buyerId: string } {
  if (hostRole === 'SELLER') return { sellerId: hostId, buyerId: joinerId };
  return { sellerId: joinerId, buyerId: hostId };
}
