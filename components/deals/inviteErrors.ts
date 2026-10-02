// components/deals/inviteErrors.ts
//
// Member-facing copy for deal-invite action refusals. Kept next to the forms
// that render it rather than in the action module, which cannot export constants.

import type { DealInviteError } from '@/lib/actions/dealInvites';

export const DEAL_INVITE_ERROR_COPY: Record<DealInviteError, string> = {
  unauthenticated: 'Sign in to continue.',
  'invalid-input': 'Check the details and try again.',
  'no-region': 'Choose where you trade before starting a deal.',
  'region-mismatch': 'You can only deal with someone in your region.',
  'item-create-failed': 'That card could not be saved. Check the details and try again.',
  'not-found': 'That invite could not be found.',
  expired: 'This invite has expired.',
  revoked: 'This invite was cancelled.',
  claimed: 'Someone already joined this deal.',
  'self-join': 'You cannot join your own deal.',
  'not-host': 'Only the person who created this invite can cancel it.',
  'wrong-kind': 'This invite cannot be claimed that way.',
  'private-item-required': 'Describe the unlisted card for this deal.',
  rejected: 'That deal could not be opened. Please try again.',
};
