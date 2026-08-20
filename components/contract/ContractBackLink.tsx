'use client';

// components/contract/ContractBackLink.tsx
//
// Visible back-navigation for contract rooms on mobile. Desktop has the rail;
// mobile has nothing except the browser back button, which is invisible.

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { navigateWithType } from '@/lib/motion/navigate';
import { Button } from '@/components/ui/button';

export function ContractBackLink({ fallbackHref }: { fallbackHref: string }) {
  const router = useRouter();

  return (
    <Button
      variant="ghost"
      size="sm"
      className="mb-3 -ml-2 lg:hidden"
      onClick={() => navigateWithType(router, fallbackHref, 'nav-back')}
    >
      <ArrowLeft className="size-4" aria-hidden />
      Back
    </Button>
  );
}
