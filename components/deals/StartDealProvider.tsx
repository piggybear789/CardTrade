'use client';

// components/deals/StartDealProvider.tsx
//
// Compose a private deal in a dialog instead of a page. Mounted once in the
// root layout so the homepage, header, and leftover `/deals/new` links all
// open the same form. Guest triggers send people to sign-up with `?deal=1`.

import {
  createContext,
  Suspense,
  use,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { DealComposeForm } from '@/components/deals/DealComposeForm';
import { Dialog, DialogContent } from '@/components/ui/dialog';

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

function StartDealQueryOpener({ openDeal }: { openDeal: () => void }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (searchParams.get(DEAL_QUERY) !== '1') return;
    openDeal();

    const next = new URLSearchParams(searchParams.toString());
    next.delete(DEAL_QUERY);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [openDeal, pathname, router, searchParams]);

  return null;
}

export function StartDealProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  const openDeal = useCallback(() => {
    setOpen(true);
  }, []);

  return (
    <StartDealContext value={{ openDeal }}>
      {children}
      <Suspense fallback={null}>
        <StartDealQueryOpener openDeal={openDeal} />
      </Suspense>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DealComposeForm onSuccess={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </StartDealContext>
  );
}
