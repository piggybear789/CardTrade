// components/brand/DittoShieldMark.tsx
//
// Compact DittoShield emblem: the local Ditto mark with a shield badge overlaid.
// Used next to DittoShield copy — not the TCG card art.

import Image from 'next/image';
import { Shield } from 'lucide-react';

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
        className="size-full rounded-md object-contain"
      />
      <span className="absolute -bottom-[6%] -right-[6%] flex size-[42%] items-center justify-center rounded-full bg-background text-trust shadow-sm ring-1 ring-border">
        <Shield className="size-[58%]" strokeWidth={2.4} fill="currentColor" fillOpacity={0.12} />
      </span>
    </div>
  );
}
