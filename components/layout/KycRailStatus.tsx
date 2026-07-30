// components/layout/KycRailStatus.tsx
//
// Persistent identity-verification state for the workspace rail (Req 1.4, 2.x).
// Verification is provider-approved Managed Merchant onboarding
// (`merchant_status = APPROVED` with settlements enabled), not the standalone
// KYC payer check — it gates Bond relief on trades and private deals, so the
// rail carries it on every signed-in surface with a route into payout setup
// (`/profile#payouts`). Renders nothing for signed-out visitors, who have no
// status to report.

import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';

import { DittoShieldMark } from '@/components/brand/DittoShieldMark';
import { createClient } from '@/lib/supabase/server';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import type { Enums } from '@/lib/supabase/database.types';

type MerchantStatus = Enums<'merchant_status'>;

/**
 * Rail presentation per `merchant_status`: a badge plus the action that moves
 * the user forward. APPROVED-with-settlements is terminal, so it offers no
 * action.
 */
const VERIFICATION_RAIL: Record<
  MerchantStatus,
  {
    label: string;
    variant: NonNullable<BadgeProps['variant']>;
    action: string | null;
  }
> = {
  APPROVED: { label: 'Verified', variant: 'default', action: null },
  PENDING: { label: 'Pending', variant: 'secondary', action: 'Check DittoShield progress' },
  REJECTED: { label: 'Rejected', variant: 'destructive', action: 'Retry DittoShield' },
  NONE: { label: 'Unverified', variant: 'outline', action: 'Start DittoShield' },
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

  const merchantStatus = profile.merchant_status as MerchantStatus;
  // APPROVED without settlements enabled is not yet actually verified; show it
  // the same as PENDING rather than a false "Verified" badge.
  const effectiveStatus: MerchantStatus =
    merchantStatus === 'APPROVED' && !profile.merchant_settlements_enabled
      ? 'PENDING'
      : merchantStatus;
  const status = VERIFICATION_RAIL[effectiveStatus] ?? VERIFICATION_RAIL.NONE;

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
