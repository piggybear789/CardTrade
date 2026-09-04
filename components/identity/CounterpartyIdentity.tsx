// components/identity/CounterpartyIdentity.tsx
//
// The COMMITMENT-POINT disclosure: the counterparty's full provider-verified
// legal name, shown when the User is about to pay, lock collateral, or accept a
// trade.
//
// PRESENTATION ONLY. It takes the resolved name and renders it; it does not
// fetch. It used to be a client component that called `getCounterpartyIdentity`
// in a `useEffect` and returned null until the answer came back, which meant a
// two-line block appeared a beat after the room had painted and pushed
// everything beneath it down the page.
//
// THE DISCLOSURE RULE IS UNCHANGED, and it now lives in the caller: this may
// only be rendered by a route that has ALREADY established the viewer is
// transacting with this person. `app/trades/[id]/page.tsx` qualifies — RLS
// grants the trade row to the two participants and a non-participant 404s
// before this is reached — and `getCounterpartyIdentity` re-checks the
// relationship server-side regardless of who calls it. What must never happen
// is a listing or profile page resolving this and putting a legal name in HTML
// anyone can load; those surfaces read `public_profiles`, which carries a given
// name and a badge only.
//
// Renders nothing when the counterparty is unverified: their absence of a
// verified name is not something to announce here.

import { HugeiconsIcon } from '@hugeicons/react';
import { ShieldCheckIcon } from '@hugeicons/core-free-icons';

import { cn } from '@/lib/utils';

export interface CounterpartyIdentityProps {
  /**
   * The resolved disclosure, from `getCounterpartyIdentity` on the server.
   * `null` when there is none, or when the caller could not release one.
   */
  identity?: { legalName: string | null; verifiedAt: string | null } | null;
  /** Their handle, used in the explanatory line. */
  displayName?: string | null;
  className?: string;
}

/** Full verified legal name of the person on the other side of a commitment. */
export function CounterpartyIdentity({
  identity,
  displayName,
  className,
}: CounterpartyIdentityProps) {
  const legalName = identity?.legalName;
  if (!legalName) return null;

  const verifiedAt = identity?.verifiedAt;

  return (
    <div
      className={cn('flex items-center gap-cozy', className)}
      role="note"
      aria-label="Verified identity of the other party"
    >
      <HugeiconsIcon icon={ShieldCheckIcon} className="size-4 shrink-0 text-trust" aria-hidden />
      <div className="min-w-0 space-y-tight text-body leading-snug">
        <p className="font-medium text-foreground">
          You are dealing with <span className="break-words">{legalName}</span>
        </p>
        {/* Says only what the provider actually establishes. It must NOT claim a
            government document or selfie was checked: Connect verifies a payout
            recipient's identity, but can defer document collection, so asserting a
            document check would overstate the assurance (Req 20.3). */}
        <p className="text-muted-foreground">
          {displayName ? `${displayName} had ` : 'They had '}
          this name verified by our payment provider
          {verifiedAt ? ` on ${new Date(verifiedAt).toLocaleDateString('en-AU')}` : ''}.
        </p>
      </div>
    </div>
  );
}
