'use client';

// components/identity/CounterpartyIdentity.tsx
//
// The COMMITMENT-POINT disclosure: the counterparty's full provider-verified
// legal name, shown when the User is about to pay, lock collateral, or accept a
// trade.
//
// Deliberately a client component that fetches on mount rather than a prop passed
// down from a page. The full name must not be embedded in the HTML of a listing
// or profile page that anyone can load — it is fetched only when this component
// actually renders, and `getCounterpartyIdentity` re-checks server-side that the
// caller really is transacting with this person. Passing it as a prop would move
// the authorisation decision into whichever page happened to render it.
//
// Renders nothing when the counterparty is unverified: their absence of a
// verified name is not something to announce here.

import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';

import { getCounterpartyIdentity } from '@/lib/actions/identity';
import { cn } from '@/lib/utils';

export interface CounterpartyIdentityProps {
  /** The other party's profile id. */
  counterpartyId: string;
  /** Their handle, used in the explanatory line. */
  displayName?: string | null;
  className?: string;
}

/** Full verified legal name of the person on the other side of a commitment. */
export function CounterpartyIdentity({
  counterpartyId,
  displayName,
  className,
}: CounterpartyIdentityProps) {
  const [legalName, setLegalName] = useState<string | null>(null);
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await getCounterpartyIdentity(counterpartyId);
      if (cancelled || !result.ok) return;
      setLegalName(result.data.legalName);
      setVerifiedAt(result.data.verifiedAt);
    })();
    return () => {
      cancelled = true;
    };
  }, [counterpartyId]);

  if (!legalName) return null;

  return (
    <div
      className={cn('flex gap-cozy rounded-lg border px-cozy py-snug', className)}
      role="note"
      aria-label="Verified identity of the other party"
    >
      <ShieldCheck className="text-trust mt-0.5 size-4 shrink-0" aria-hidden />
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
