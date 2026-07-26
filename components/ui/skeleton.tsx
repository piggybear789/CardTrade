// components/ui/skeleton.tsx
//
// Shared shimmer placeholder for loading states. Uses the muted token so it
// reads as "content is coming" on both themes, and respects reduced motion
// (the pulse is disabled globally by the prefers-reduced-motion rule).

import { cn } from '@/lib/utils';

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-muted/70', className)}
      aria-hidden="true"
      {...props}
    />
  );
}
