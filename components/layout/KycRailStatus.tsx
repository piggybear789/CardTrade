// components/layout/KycRailStatus.tsx
//
// Persistent verification state for the workspace rail (Req 13.3, 18.4).
//
// Reports the Identity_Gate — Connect onboarding APPROVED with settlements
// enabled — which is now the app's ONLY verification signal. This file used to
// assert that while `app/profile/page.tsx` rendered a separate identity card
// beside the payout card, so the rail and the account page could disagree about
// whether the same Member was verified. That second gate is gone, and the state
// shown here is derived from `verificationState` in `domain/identity/identityGate.ts`
// so the rail cannot drift from the predicate every other surface uses.
//
// The gate decides Bond relief on trades and private deals and whether a Member
// may list, sell or trade, so the rail carries it on every signed-in surface with
// a route into payout setup (`/profile#payouts`). Renders nothing for signed-out
// visitors, who have no status to report.

import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';

import { DittoShieldMark } from '@/components/brand/DittoShieldMark';
import { createClient } from '@/lib/supabase/server';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import {
  verificationState,
  type MerchantStatus,
  type VerificationState,
} from '@/domain/identity/identityGate';

/**
 * Rail presentation per Identity_Gate state: a badge plus the action that moves
 * the Member forward. VERIFIED is terminal, so it offers no action.
 *
 * Keyed on `VerificationState` rather than on `merchant_status` directly, so the
 * "approved but settlements not enabled is not verified" rule lives in one place
 * instead of being re-derived here.
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
  IN_PROGRESS: { label: 'Pending', variant: 'secondary', action: 'Check DittoShield progress' },
  NOT_APPROVED: { label: 'Rejected', variant: 'destructive', action: 'Retry DittoShield' },
  NOT_STARTED: { label: 'Unverified', variant: 'outline', action: 'Start DittoShield' },
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
    .select('merchant_status, merchant_settlements_enabled')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile) return null;

  const state = verificationState({
    merchantStatus: (profile.merchant_status ?? 'NONE') as MerchantStatus,
    settlementsEnabled: Boolean(profile.merchant_settlements_enabled),
  });
  const status = VERIFICATION_RAIL[state] ?? VERIFICATION_RAIL.NOT_STARTED;

  return (
    <section
      className="relative overflow-hidden rounded-lg border border-border/70 bg-muted/45 p-3"
      aria-labelledby="marketplace-identity"
    >
      <div className="flex gap-3">
        <DittoShieldMark className="size-11 self-start" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p id="marketplace-identity" className="market-label text-muted-foreground">
              DittoShield
            </p>
            <Badge variant={status.variant} aria-label={`DittoShield status: ${status.label}`}>
              {status.label}
            </Badge>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Anti-Impostor Verification
          </p>
        </div>
      </div>

      {status.action ? (
        <Link
          href="/profile#payouts"
          className="mt-2 flex items-center gap-2 rounded-md text-sm font-semibold text-foreground underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ShieldCheck className="size-4 shrink-0 text-gold" aria-hidden="true" />
          {status.action}
        </Link>
      ) : (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="size-4 shrink-0 text-trust" aria-hidden="true" />
          Collateral relief active
        </p>
      )}
    </section>
  );
}
