'use client';

// components/identity/IdentityReturnRefresh.tsx
//
// Reconcile identity verification state when a member lands back from Stripe's
// hosted check, on any page that can send them there.
//
// WHY IT IS NEEDED. `identity_check_status` moves on the provider's
// `identity.verification_session.*` webhook or on an explicit re-read. Returning
// from the hosted flow is a full navigation, so the page re-renders — but against
// whatever the database says, which is still PENDING until delivery lands. In local
// development without `stripe listen` that is never. This makes the return
// deterministic by asking the provider directly, then drops the marker so a refresh
// does not repeat the call.
//
// RETURNING DOES NOT PROVE THE CHECK PASSED. The member may have abandoned the flow
// or Stripe may still be processing, which is why this re-reads rather than assuming
// success — the same reason `PayoutReturnRefresh` exists on the Connect side.

import { useEffect, useRef, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

import { refreshIdentityCheck } from '@/lib/actions/identity';

export function IdentityReturnRefresh() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const handled = useRef(false);

  const marker = searchParams.get('identity');

  useEffect(() => {
    if (marker !== 'complete') return;
    if (handled.current) return;
    handled.current = true;

    startTransition(async () => {
      const result = await refreshIdentityCheck();

      if (result.ok && result.data.status === 'VERIFIED') {
        toast.success('Identity verified — you can list, sell, and trade.');
      } else if (result.ok && result.data.status === 'FAILED') {
        // Retryable, and said so: a document check fails for mundane reasons and a
        // dead end here reads as a ban.
        toast.error('We could not verify that document. You can try again.');
      } else {
        toast.info('Still checking your document. We will update this automatically.');
      }

      // Strip the marker so a manual reload does not re-run this.
      const next = new URLSearchParams(searchParams.toString());
      next.delete('identity');
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname);
      router.refresh();
    });
    // Keyed on the marker alone: the rest is stable for a given navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marker]);

  return null;
}
