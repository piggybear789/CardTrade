import 'server-only';

// lib/identityGate.ts
//
// Server-side reader for the Identity_Gate (Req 14).
//
// WHY A SEPARATE MODULE. The gate has to be enforced in the orchestrator layer as
// well as in the UI (Req 14.6), and a `'use server'` module may only export async
// functions, so the shared reader cannot live in an action file. This mirrors
// `lib/sellerIdentity.ts`.
//
// THE GATE IS SCOPED BY WHETHER A ROLE CAN RECEIVE MONEY. Selling for cash needs
// it, because the Seller receives the net. Trade escrow needs it, because captured
// collateral on an Objective_Fraud is paid to whichever trader was the victim, and
// a Member should not be able to enter a trade in which they could be owed
// restitution the platform cannot deliver. A cash Buyer does NOT need it: a Buyer
// is only ever refunded to their original card, so no transfer is ever sent to
// them and demanding payout onboarding would be friction with no purpose.
//
// The `merchant_*` columns are provider-controlled and excluded from client-facing
// selects, so this reads them through the admin client scoped to one Profile id.

import { createAdminClient } from '@/lib/supabase/admin';
import {
  satisfiesIdentityGate,
  verificationState,
  type MerchantStatus,
  type VerificationState,
} from '@/domain/identity/identityGate';

/** The gate outcome for one Profile. */
export interface IdentityGateStatus {
  satisfied: boolean;
  state: VerificationState;
}

/**
 * Read the Identity_Gate for a Profile.
 *
 * A missing Profile is reported as NOT_STARTED rather than throwing: the caller's
 * job is to refuse the action, and a typed refusal is more useful than an
 * exception (errors are values at this boundary).
 */
export async function readIdentityGate(profileId: string): Promise<IdentityGateStatus> {
  const { data } = await createAdminClient()
    .from('profiles')
    .select('merchant_status, merchant_settlements_enabled')
    .eq('id', profileId)
    .maybeSingle();

  const input = {
    merchantStatus: (data?.merchant_status ?? 'NONE') as MerchantStatus,
    settlementsEnabled: Boolean(data?.merchant_settlements_enabled),
  };

  return {
    satisfied: satisfiesIdentityGate(input),
    state: verificationState(input),
  };
}

/** Actions the Identity_Gate protects, for message construction. */
export type GatedAction = 'list' | 'sell' | 'trade' | 'deal';

/** What each gated action is called in a refusal message. */
const ACTION_LABEL: Record<GatedAction, string> = {
  list: 'publish a listing',
  sell: 'sell for cash',
  trade: 'start a trade',
  deal: 'agree a deal that involves cash',
};

/**
 * The member-facing refusal for a blocked action (Req 14.7).
 *
 * Names the blocked action and points at payout setup, because that is the only
 * thing that resolves it. Deliberately mentions no provider and no compliance
 * detail.
 */
export function identityGateMessage(
  action: GatedAction,
  state: VerificationState,
): string {
  const what = ACTION_LABEL[action];
  switch (state) {
    case 'IN_PROGRESS':
      return `Your payout setup is still being approved. You can ${what} once it completes.`;
    case 'NOT_APPROVED':
      return `Your payout setup was not approved, so you cannot ${what} yet. You can start it again from your account.`;
    case 'NOT_STARTED':
    default:
      return `Set up payouts before you ${what}, so we know who you are and have somewhere to send your money.`;
  }
}
