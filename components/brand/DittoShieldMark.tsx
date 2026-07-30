// components/brand/DittoShieldMark.tsx
//
// Compact photo-Ditto emblem used next to DittoShield copy.

import Image from 'next/image';

import { cn } from '@/lib/utils';

const DITTO_MARK = '/brand/ditto.png';

export function DittoShieldMark({ className }: { className?: string }) {
  return (
    <div
      className={cn('relative size-14 shrink-0', className)}
      aria-hidden="true"
    >
      <Image
        src={DITTO_MARK}
        alt=""
        width={112}
        height={112}
        unoptimized
        className="size-full rounded-md object-contain"
      />
    </div>
  );
}
