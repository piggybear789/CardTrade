'use client';

// components/identity/IdentityCheckCard.tsx
//
// Step ONE of two: verify who you are. Step two is payout setup
// (`PayoutOnboarding`), and they are deliberately separate cards for separate
// questions — "who is this" and "where does money go".
//
// WHY THE SPLIT MATTERS HERE. This check needs no bank details and unlocks listing,
// selling and trade access on its own, so a member can start using the marketplace
// before thinking about payouts. Bundling them, as Connect onboarding used to, made
// the first thing a new seller saw a request for their bank account.
//
// NEVER CLAIMS MORE THAN IT HAS. Until 0069 the verified badge rested on Connect
// enabling transfers, which does not prove a document was checked — both steering
// docs recorded that as an accepted assurance limit. This card is that limit being
// closed, so its copy can finally say "photo ID" honestly.

import { useState, useTransition } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { BadgeCheckIcon, LoaderCircleIcon, ShieldAlertIcon, ShieldCheckIcon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

import { beginIdentityCheck } from '@/lib/actions/identity';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { IdentityCheckStatus } from '@/domain/identity/identityGate';

export interface IdentityCheckCardProps {
  status: IdentityCheckStatus;
  /** The document-backed name, once Stripe has reported one. */
  verifiedName?: string | null;
  /** Where the provider should return the member. Defaults to the verification tab. */
  returnPath?: string;
  /** Drop the surrounding Card chrome, for use inside a dialog or a grid cell. */
  compact?: boolean;
}

const BADGE: Record<
  IdentityCheckStatus,
  { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }
> = {
  VERIFIED: { label: 'Verified', variant: 'default' },
  PENDING: { label: 'In progress', variant: 'secondary' },
  FAILED: { label: 'Try again', variant: 'destructive' },
  NONE: { label: 'Setup required', variant: 'outline' },
};

export function IdentityCheckCard({
  status,
  verifiedName = null,
  returnPath = '/profile?tab=verification',
  compact = false,
}: IdentityCheckCardProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function start() {
    setError(null);
    startTransition(async () => {
      const result = await beginIdentityCheck(returnPath);
      if (!result.ok) {
        setError(result.message);
        toast.error(result.message);
        return;
      }
      // Full navigation, not a router push: the destination is Stripe's own origin.
      window.location.assign(result.data.url);
    });
  }

  const badge = BADGE[status];

  const body =
    status === 'VERIFIED' ? (
      // PLAIN TEXT, NO NESTED BOX. This was a bordered panel carrying its own copy
      // of the header's shield, so one fact rendered as a card inside a card and the
      // inner box outweighed the heading that introduced it. The card is already the
      // container; its content does not need a second one.
      <div className="space-y-tight text-body leading-snug">
        <p className="font-medium text-foreground">
          {verifiedName ? `Verified as ${verifiedName}` : 'Your identity is verified'}
        </p>
        <p className="text-muted-foreground">
          {/* Says exactly what a buyer sees and nothing more. Address and document
              numbers are never disclosed — only the name on the document. */}
          Buyers you have an agreed sale or trade with may be shown this name.
        </p>
      </div>
    ) : (
      <div className="space-y-group">
        {status === 'FAILED' ? (
          <p className="flex gap-snug text-body text-destructive">
            <HugeiconsIcon icon={ShieldAlertIcon} className="mt-0.5 size-4 shrink-0" aria-hidden />
            {/* Retryable, and said so. A document check fails for a blurry photo far
                more often than for anything sinister, and a dead end reads as a ban. */}
            That document could not be verified. You can try again.
          </p>
        ) : null}

        {status === 'PENDING' ? (
          <p className="text-body text-muted-foreground">
            Your document is being checked. This is usually quick — we will update this
            automatically.
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="text-body text-destructive">
            {error}
          </p>
        ) : null}

        <Button type="button" onClick={start} disabled={isPending} aria-busy={isPending}>
          {isPending ? (
            <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden />
          ) : (
            <HugeiconsIcon icon={BadgeCheckIcon} className="size-3.5" aria-hidden />
          )}
          {status === 'NONE' ? 'Verify with Stripe' : 'Try again'}
        </Button>

        <p className="text-body text-muted-foreground">
          One step on Stripe&apos;s pages, with a photo ID and a selfie — NoDitto never
          sees the document. No bank details needed for this.
        </p>
      </div>
    );

  if (compact) return body;

  return (
    // `id` is the in-page anchor if a fragment still lands here. The hosted
    // return and onboarding fallback now go to `/profile?tab=verification`.
    <Card id="identity" className="h-full scroll-mt-24 max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:shadow-none">
      <CardHeader className="pb-3">
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-snug text-lead">
              <HugeiconsIcon icon={ShieldCheckIcon} className="size-4 shrink-0 text-trust" aria-hidden />
              Identity
            </CardTitle>
            <CardDescription>Required before you can list, sell, or trade.</CardDescription>
          </div>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
