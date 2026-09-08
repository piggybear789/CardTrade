// components/account/EmptyState.tsx
//
// Backwards-compatible account wrapper around the shared application empty
// state. Account sections keep their existing call sites while inheriting the
// same centering, spacing, and responsive action treatment as other routes.
//
// Every caller is a workspace hub whose list is empty — Purchases, Sales, Offers,
// Saved, My Listings — so `fill` is set here rather than repeated at five call
// sites. If this wrapper ever gains a caller that has content BELOW it on a phone,
// that caller wants the shared component directly, not a flag on this one.

import type { ReactNode } from 'react';
import { EmptyState as SharedEmptyState } from '@/components/ui/empty-state';

export function EmptyState({
  icon,
  title,
  description,
  ctaLabel,
  ctaHref,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  ctaLabel: string;
  ctaHref: string;
}) {
  return (
    <SharedEmptyState
      icon={icon}
      title={title}
      description={description}
      action={{ label: ctaLabel, href: ctaHref }}
      compact
      fill
    />
  );
}
