'use client';

// components/identity/IdentityPendingPoll.tsx
//
// While a check is PENDING, re-read Stripe on an interval and refresh the tree
// when the answer changes. Members should not have to press "Check verification"
// — the webhook is the reliable path, and this covers a delayed or missing
// delivery (same reason IdentityReturnRefresh exists on the way back).

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { refreshIdentityCheck } from '@/lib/actions/identity';

const INTERVAL_MS = 10_000;

export function IdentityPendingPoll() {
  const router = useRouter();
  const announced = useRef(false);
  const ticks = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      if (document.visibilityState === 'hidden') return;
      const result = await refreshIdentityCheck();
      if (cancelled || !result.ok) return;
      ticks.current += 1;
      if (result.data.status === 'PENDING') return;

      // Skip the first-tick toast: a return from Stripe already announced the
      // outcome. Later ticks are the delayed webhook / mock settle case.
      if (ticks.current > 1 && !announced.current) {
        announced.current = true;
        if (result.data.status === 'VERIFIED') {
          toast.success('Identity verified — you can list, sell, and trade.');
        } else if (result.data.status === 'FAILED') {
          toast.error('We could not verify that document. You can try again.');
        }
      }
      router.refresh();
    }

    const id = window.setInterval(() => {
      void tick();
    }, INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    void tick();

    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [router]);

  return null;
}
