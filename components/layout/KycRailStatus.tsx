// components/layout/KycRailStatus.tsx
//
// Persistent verification state for the workspace rail (Req 13.3, 18.4).
//
// Reports the Identity_Gate — since 0069 a Stripe Identity document-plus-selfie
// check, `identity_check_status = 'VERIFIED'`. It is the app's ONLY verification
// signal. This file used to assert that while `app/profile/page.tsx` rendered a
// separate identity card beside the payout card, so the rail and the account page
// could disagree about whether the same Member was verified. That second gate is
// gone, and the state shown here is derived from `verificationState` in
// `domain/identity/identityGate.ts` so the rail cannot drift from the predicate
// every other surface uses.
//
// CONNECT IS NOT THIS. Payout setup is a separate, later step and gates only whether
// a member can be PAID. The rail must keep routing to the identity check, because
// that is what moves the state it displays — pointing it at payout setup would offer
// an action that cannot change the badge beside it.
//
// The gate decides whether a Member may list, sell or trade, so the rail carries it
// on every signed-in surface with a route into verification. Renders nothing for
// signed-out visitors, who have no status to report.

import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';

import { createClient } from '@/lib/supabase/server';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import {
  verificationState,
  type IdentityCheckStatus,
  type VerificationState,
} from '@/domain/identity/identityGate';

/**
 * Rail presentation per Identity_Gate state: a badge plus the action that moves
 * the Member forward. VERIFIED is terminal, so it offers no action.
 *
 * Keyed on `VerificationState` rather than on the raw column, so the mapping from
 * check status to member-facing wording lives in one place instead of being
 * re-derived here.
 */
const VERIFICATION_RAIL: Record<
  VerificationState,
  {
    label: string;
    variant: NonNullable<BadgeProps['variant']>;
    action: string | null;
  }
> = {
  VERIFIED: { label: 'Verified', variant: 'default', action: null },
  IN_PROGRESS: { label: 'Pending', variant: 'secondary', action: 'Check verification' },
  NOT_APPROVED: { label: 'Rejected', variant: 'destructive', action: 'Retry verification' },
  NOT_STARTED: { label: 'Unverified', variant: 'outline', action: 'Start verification' },
};

/** The rail's identity block, read from the caller's own RLS-scoped profile. */
export async function KycRailStatus() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('identity_check_status')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile) return null;

  const state = verificationState({
    identityCheckStatus: (profile.identity_check_status ?? 'NONE') as IdentityCheckStatus,
  });
  const status = VERIFICATION_RAIL[state] ?? VERIFICATION_RAIL.NOT_STARTED;

  return (
    <section
      className="relative overflow-hidden rounded-lg border border-border/70 bg-muted/45 p-3"
      aria-labelledby="marketplace-identity"
    >
      <div className="flex gap-3">
        <ShieldCheck className="size-11 self-start text-trust" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p id="marketplace-identity" className="market-label text-muted-foreground">
              Identity
            </p>
            <Badge variant={status.variant} aria-label={`Identity status: ${status.label}`}>
              {status.label}
            </Badge>
          </div>
          <p className="mt-1 text-meta text-muted-foreground">
            Photo ID and selfie
          </p>
        </div>
      </div>

      {status.action ? (
        <Link
          href="/profile/payouts"
          className="mt-2 flex items-center gap-2 rounded-md text-body font-semibold text-foreground underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ShieldCheck className="size-4 shrink-0 text-gold" aria-hidden="true" />
          {status.action}
        </Link>
      ) : (
        <p className="mt-2 flex items-center gap-2 text-body text-muted-foreground">
          <ShieldCheck className="size-4 shrink-0 text-trust" aria-hidden="true" />
          Collateral relief active
        </p>
      )}
    </section>
  );
}
