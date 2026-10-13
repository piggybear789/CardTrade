// components/layout/BackToMarketplace.tsx
//
// The one "Back to marketplace" control. The listing page drew an outlined button with
// an arrow icon and the seller page drew a muted text link with a "←" glyph, for the
// same destination; both now render this.

import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons';

import { Button } from '@/components/ui/button';

export function BackToMarketplace({ className }: { className?: string }) {
  return (
    <Button asChild variant="outline" size="sm" className={className}>
      <Link href="/" transitionTypes={['nav-back']}>
        <HugeiconsIcon icon={ArrowLeft01Icon} aria-hidden="true" />
        Back to marketplace
      </Link>
    </Button>
  );
}
