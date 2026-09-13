// components/deals/inviteErrors.ts
//
// Member-facing copy for deal-invite action refusals. Kept next to the forms
// that render it rather than in the action module, which cannot export constants.

import type { DealInviteError } from '@/lib/actions/dealInvites';

export const DEAL_INVITE_ERROR_COPY: Record<DealInviteError, string> = {
  unauthenticated: 'Sign in to continue.',
  'invalid-input': 'Check the details and try again.',
  'no-region': 'Set your trading region in Account before starting a deal.',
  'region-mismatch': 'You can only deal with someone in your region.',
  // THESE THREE ARE ABOUT DIFFERENT PEOPLE. Collapsing them is what made a
  // host-BUYER invite tell the joiner "the seller is not verified" when the joiner
  // was the seller — see the codes in `lib/actions/dealInvites.ts`.
  'seller-identity-unverified': 'The seller needs to verify their identity first.',
  'own-identity-unverified': 'Verify your identity before you join this deal.',
  'counterparty-identity-unverified':
    'The other trader has not verified their identity yet.',
  'seller-disclosure-incomplete':
    'Selling needs payout setup finished so buyers can see who they are paying.',
  'item-create-failed': 'That card could not be saved. Check the details and try again.',
  'not-found': 'That invite could not be found.',
  expired: 'This invite has expired.',
  revoked: 'This invite was cancelled.',
  claimed: 'Someone already joined this deal.',
  'self-join': 'You cannot join your own deal.',
  'not-host': 'Only the person who created this invite can cancel it.',
  'wrong-kind': 'This invite cannot be claimed that way.',
  'private-item-required': 'Describe the unlisted card for this deal.',
  'buyer-confirmation-required': 'Confirm the verified seller before joining.',
  'no-payment-method': 'Add a payment method before joining this sale.',
  rejected: 'That deal could not be opened. Please try again.',
};
