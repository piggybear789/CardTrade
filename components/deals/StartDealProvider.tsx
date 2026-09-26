'use client';

// Opens the private-deal composer. The form itself lives on `/deals/new`.
// Importing it here put the browser Supabase client on every catalog visit,
// because this provider is mounted in the root layout.

import {
  createContext,
  Suspense,
  use,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { DEAL_OPEN_PATH } from '@/components/deals/dealPaths';

const DEAL_QUERY = 'deal';

type StartDealContextValue = {
  openDeal: () => void;
};

const StartDealContext = createContext<StartDealContextValue | null>(null);

export function useStartDeal() {
  const value = use(StartDealContext);
  if (!value) {
    throw new Error('useStartDeal must be used within StartDealProvider');
  }
  return value;
}

function StartDealQueryOpener() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    if (searchParams.get(DEAL_QUERY) !== '1') return;
    router.replace(DEAL_OPEN_PATH);
  }, [router, searchParams]);

  return null;
}

export function StartDealProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const openDeal = useCallback(() => {
    router.push(DEAL_OPEN_PATH);
  }, [router]);

  return (
    <StartDealContext value={{ openDeal }}>
      {children}
      <Suspense fallback={null}>
        <StartDealQueryOpener />
      </Suspense>
    </StartDealContext>
  );
}
