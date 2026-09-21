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
        
      } else if (result.ok && result.data.status === 'FAILED') {
        // Retryable, and said so: a document check fails for mundane reasons and a
        // dead end here reads as a ban.
        toast.error('We could not verify that document. You can try again.');
      } else if (result.ok && result.data.progress === 'PROCESSING') {
        // The document is IN, which is the fact a returning member wants confirmed. The
        // page's own verification step carries the persistent version of this; the toast
        // is only the acknowledgement that the submission landed.
        toast.info('Document received. Stripe is checking it now.');
      } else if (result.ok) {
        // A session exists but nothing was submitted, so this is not a wait — saying
        // "still checking" would promise a result that is not coming.
        toast.info('Your identity check is not finished yet.');
      }

      // Strip the marker so a manual reload does not re-run this, then re-render
      // against what the read-back just wrote.
      //
      // `replaceState` + `refresh`, NOT `router.replace`. A `router.replace` to a new
      // query string is a navigation: the page segment re-suspends and the route's
      // `loading.tsx` skeleton covers a page that had just resolved, so the return
      // read as complete, blank, complete. `replaceState` rewrites the URL with no
      // navigation at all (the App Router keeps `useSearchParams` in step with it),
      // and `refresh` re-renders the server tree in place behind the current UI.
      // One render, no skeleton.
      const next = new URLSearchParams(searchParams.toString());
      next.delete('identity');
      const query = next.toString();
      window.history.replaceState(null, '', query ? `${pathname}?${query}` : pathname);
      router.refresh();
    });
    // Keyed on the marker alone: the rest is stable for a given navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marker]);

  return null;
}
