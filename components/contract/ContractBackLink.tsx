'use client';

// components/contract/ContractBackLink.tsx
//
// Visible back-navigation for contract rooms on mobile. Desktop has the rail;
// mobile has nothing except the browser back button, which is invisible.

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ContractBackLink({ fallbackHref }: { fallbackHref: string }) {
  const router = useRouter();

  return (
    <Button
      variant="ghost"
      size="sm"
      className="mb-3 -ml-2 lg:hidden"
      onClick={() => {
        // If there's history, go back. Otherwise navigate to the fallback.
        if (window.history.length > 1) {
          router.back();
        } else {
          router.push(fallbackHref);
        }
      }}
    >
      <ArrowLeft className="size-4" aria-hidden />
      Back
    </Button>
  );
}
