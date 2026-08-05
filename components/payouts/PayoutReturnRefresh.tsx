'use client';

// components/payouts/PayoutReturnRefresh.tsx
//
// Reconcile payout state when a member lands back from the provider's hosted
// onboarding flow, on any page that can send them there.
//
// WHY IT IS NEEDED. `merchant_status` moves only on the provider's
// `account.updated` webhook or on an explicit re-read. Returning from the hosted
// flow is a full navigation, so the page re-renders — but it re-renders against
// whatever the database says, which is still PENDING until delivery lands. In
// local development without `stripe listen` that is never. This makes the return
// deterministic by asking the provider directly, exactly as the /profile card
// does, then dropping the marker so a refresh does not repeat the call.
//
// Returning from the flow does NOT prove the member can be paid — that is why
// this re-reads rather than assuming success, and why every gate keeps reading
// `settlementsEnabled`.

import { useEffect, useRef, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

import { refreshPayoutStatus } from '@/lib/actions/merchant';
import { satisfiesIdentityGate } from '@/domain/identity/identityGate';

export function PayoutReturnRefresh() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const handled = useRef(false);

  const marker = searchParams.get('payouts');

  useEffect(() => {
    if (marker !== 'complete' && marker !== 'refresh') return;
    if (handled.current) return;
    handled.current = true;

    startTransition(async () => {
      if (marker === 'refresh') {
        toast.error('That setup link expired. Start it again to pick up where you left off.');
      } else {
        const result = await refreshPayoutStatus();
        // One definition of "verified", shared with every other surface.
        const verified =
          result.ok &&
          satisfiesIdentityGate({
            merchantStatus: result.data.merchantStatus,
            settlementsEnabled: result.data.settlementsEnabled,
          });
        toast[verified ? 'success' : 'info'](
          verified
            ? 'You are verified — go ahead.'
            : 'Still verifying. We will update this automatically.',
        );
      }

      // Strip the marker so a manual reload does not re-run this.
      const next = new URLSearchParams(searchParams.toString());
      next.delete('payouts');
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname);
      router.refresh();
    });
    // Keyed on the marker alone: the rest is stable for a given navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marker]);

  return null;
}
